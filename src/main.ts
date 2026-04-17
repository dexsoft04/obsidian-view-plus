import { Notice, Plugin, TFile } from "obsidian";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import type { Dirent } from "fs";
import {
	DEFAULT_SETTINGS,
	ViewPlusSettingTab,
	type ViewPlusSettings,
} from "./settings";
import {
	FILE_VIEWER_VIEW_TYPE,
	FileViewerView,
	MEDIA_VIEWER_VIEW_TYPE,
	MediaView,
	MEDIA_EXTENSIONS,
	TEXT_EXTENSIONS,
	openWithSystemApp,
} from "./viewer";

interface InternalFileSystemAdapter {
	reconcileDeletion(normalizedPath: string, isFolder: boolean): Promise<void>;
	reconcileFile(
		normalizedPath: string,
		isFolder: boolean,
		...rest: unknown[]
	): Promise<void>;
	getBasePath(): string;
}

export default class ViewPlusPlugin extends Plugin {
	settings!: ViewPlusSettings;

	private patchApplied = false;
	private originalReconcileDeletion:
		| InternalFileSystemAdapter["reconcileDeletion"]
		| undefined;
	private discoveryController: AbortController | undefined;
	// Compiled once and reused across all exclude-pattern checks in this session.
	private compiledExcludePatterns: CompiledPattern[] = [];

	async onload(): Promise<void> {
		await this.loadSettings();
		this.addSettingTab(new ViewPlusSettingTab(this.app, this));

		// Register built-in file viewer for text/code files
		this.registerView(FILE_VIEWER_VIEW_TYPE, (leaf) => new FileViewerView(leaf));
		this.registerExtensions(TEXT_EXTENSIONS, FILE_VIEWER_VIEW_TYPE);

		// Register media viewer for image/audio/video formats not handled by Obsidian natively
		this.registerView(MEDIA_VIEWER_VIEW_TYPE, (leaf) => new MediaView(leaf));
		this.registerExtensions(MEDIA_EXTENSIONS, MEDIA_VIEWER_VIEW_TYPE);

		// Right-click menu: add "Open with system app" for all non-Markdown files
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!(file instanceof TFile) || file.extension === "md") return;
				menu.addItem((item) =>
					item
						.setTitle("Open with system app")
						.setIcon("external-link")
						.onClick(() => openWithSystemApp(this.app, file))
				);
			})
		);

		// Command: open active file with system default app (bindable hotkey)
		this.addCommand({
			id: "open-with-system-app",
			name: "Open with system app",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension === "md") return false;
				if (!checking) openWithSystemApp(this.app, file);
				return true;
			},
		});

		// Double-click a file in the explorer to open it with the system app
		this.registerDomEvent(document, "dblclick", (evt: MouseEvent) => {
			const navTitle = (evt.target as HTMLElement).closest<HTMLElement>(
				".nav-file-title"
			);
			if (!navTitle) return;
			const filePath = navTitle.getAttribute("data-path");
			if (!filePath) return;
			const file = this.app.vault.getFileByPath(filePath);
			if (!file || file.extension === "md") return;
			openWithSystemApp(this.app, file);
		});

		// Wait for Obsidian's initial vault scan to complete before applying patches,
		// otherwise we interfere with the startup file indexing process.
		this.app.workspace.onLayoutReady(() => {
			this.applyUnsupportedFilesSetting(this.settings.showUnsupportedFiles);
			if (this.settings.showHiddenFiles) {
				this.applyHiddenFilesPatch();
			}
		});
	}

	onunload(): void {
		this.removeHiddenFilesPatch();
		this.applyUnsupportedFilesSetting(false);
	}

	applyUnsupportedFilesSetting(enabled: boolean): void {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(this.app.vault as any).setConfig("showUnsupportedFiles", enabled);
	}

	applyHiddenFilesPatch(): void {
		if (this.patchApplied) return;

		const adapter = this.app.vault
			.adapter as unknown as InternalFileSystemAdapter;

		if (
			typeof adapter.reconcileDeletion !== "function" ||
			typeof adapter.reconcileFile !== "function" ||
			typeof adapter.getBasePath !== "function"
		) {
			new Notice(
				"View Plus: 'Show hidden files' is only supported on desktop. " +
					"This feature will be disabled."
			);
			return;
		}

		this.originalReconcileDeletion = adapter.reconcileDeletion.bind(adapter);

		const plugin = this;

		adapter.reconcileDeletion = async function (
			this: InternalFileSystemAdapter,
			normalizedPath: string,
			isFolder: boolean
		): Promise<void> {
			if (
				plugin.settings.showHiddenFiles &&
				isDotName(normalizedPath) &&
				!isExcluded(normalizedPath, plugin.compiledExcludePatterns)
			) {
				try {
					await this.reconcileFile(normalizedPath, isFolder);
				} catch {
					await plugin.originalReconcileDeletion!.call(
						this,
						normalizedPath,
						isFolder
					);
				}
				return;
			}
			await plugin.originalReconcileDeletion!.call(
				this,
				normalizedPath,
				isFolder
			);
		};

		this.patchApplied = true;

		// Use fs.readdir to enumerate files directly from the filesystem,
		// bypassing any Obsidian-level filtering that would hide dotfiles.
		this.discoveryController?.abort();
		this.discoveryController = new AbortController();
		this.discoverHiddenFiles("", this.discoveryController.signal).catch((e) => {
			console.error("View Plus: discoverHiddenFiles failed", e);
		});
	}

	private async discoverHiddenFiles(
		relPath: string,
		signal: AbortSignal,
		depth = 0,
		inSymlinkedTree = false,
		compiled?: CompiledPattern[]
	): Promise<void> {
		// Depth limit guards against circular symlinks.
		if (depth > 25 || signal.aborted) return;

		// Reuse already-compiled patterns; the root call passes undefined so we
		// fall back to the instance cache compiled at load/save time.
		const patterns = compiled ?? this.compiledExcludePatterns;

		const adapter = this.app.vault.adapter as unknown as InternalFileSystemAdapter;
		const basePath = adapter.getBasePath();
		const absPath = relPath ? join(basePath, relPath) : basePath;

		let entries: Dirent[];
		try {
			entries = await readdir(absPath, { withFileTypes: true });
		} catch {
			return;
		}

		if (signal.aborted) return;

		const regularDirs: string[] = [];
		const symlinkDirs: string[] = [];

		// Process entries with bounded concurrency to avoid overwhelming the vault
		// index with thousands of simultaneous reconcileFile / stat calls.
		await runBounded(entries, DISCOVERY_CONCURRENCY, async (entry) => {
			if (signal.aborted) return;

			const childRelPath = relPath ? `${relPath}/${entry.name}` : entry.name;
			let isDir = entry.isDirectory();
			const isSymlink = entry.isSymbolicLink();

			if (isSymlink) {
				// Resolve the symlink to find out if it points to a directory.
				try {
					isDir = (await stat(join(basePath, childRelPath))).isDirectory();
				} catch {
					return; // dangling symlink, skip
				}
			}

			if (isExcluded(childRelPath, patterns)) return;

			// Register when:
			//   - inside a symlinked subtree (Obsidian never scanned it), or
			//   - the entry itself is a symlink (Obsidian skips symlinks), or
			//   - the name starts with "." (hidden file/folder)
			if (inSymlinkedTree || isSymlink || entry.name.startsWith(".")) {
				try {
					await adapter.reconcileFile(childRelPath, isDir);
				} catch {
					// skip files Obsidian cannot register
				}
			}

			if (isDir) {
				if (isSymlink) {
					symlinkDirs.push(childRelPath);
				} else {
					regularDirs.push(childRelPath);
				}
			}
		});

		// Regular subdirs: recurse at same depth, propagate inSymlinkedTree flag.
		for (const dir of regularDirs) {
			if (signal.aborted) return;
			await this.discoverHiddenFiles(dir, signal, depth, inSymlinkedTree, patterns);
		}

		// Symlinked dirs: increment depth to track nesting, mark tree as symlinked.
		for (const dir of symlinkDirs) {
			if (signal.aborted) return;
			await this.discoverHiddenFiles(dir, signal, depth + 1, true, patterns);
		}
	}

	removeHiddenFilesPatch(): void {
		this.discoveryController?.abort();
		this.discoveryController = undefined;

		if (!this.patchApplied || !this.originalReconcileDeletion) return;

		const adapter = this.app.vault
			.adapter as unknown as InternalFileSystemAdapter;
		adapter.reconcileDeletion = this.originalReconcileDeletion;

		this.patchApplied = false;
		this.originalReconcileDeletion = undefined;
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		if (!Array.isArray(this.settings.excludePatterns)) {
			this.settings.excludePatterns = DEFAULT_SETTINGS.excludePatterns;
		}
		this.compiledExcludePatterns = compilePatterns(this.settings.excludePatterns);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.compiledExcludePatterns = compilePatterns(this.settings.excludePatterns);
	}
}

// Maximum number of entries processed concurrently during hidden-file discovery.
// Keeps stat() + reconcileFile() I/O at a predictable rate for large vaults.
const DISCOVERY_CONCURRENCY = 20;

// Run fn over every item in items, with at most `limit` concurrent calls at once.
// Workers pull from a shared index so the queue drains naturally.
async function runBounded<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>
): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < items.length) {
			const item = items[next++];
			await fn(item);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, items.length) }, worker)
	);
}

// Check if the last segment (filename) starts with "."
function isDotName(normalizedPath: string): boolean {
	const segments = normalizedPath.split("/");
	const name = segments[segments.length - 1];
	return name.startsWith(".") && name !== "." && name !== "..";
}

// A glob pattern compiled to a RegExp, ready for repeated matching.
interface CompiledPattern {
	negate: boolean;
	re: RegExp;
	// When false the pattern has no slash and matches against each path segment
	// individually (gitignore basename semantics).
	anchored: boolean;
}

// Compile raw glob strings to CompiledPattern once per discovery run.
function compilePatterns(rawPatterns: string[]): CompiledPattern[] {
	return rawPatterns.map((raw) => {
		const negate = raw.startsWith("!");
		const pattern = negate ? raw.slice(1) : raw;
		const anchored = pattern.includes("/");
		const re = new RegExp(`^${globToRegexSrc(pattern)}$`);
		return { negate, re, anchored };
	});
}

// Supports "!" prefix for negation (like .gitignore).
// Patterns are evaluated in order: last match wins.
// Example: [".git/**", "!.git/config"] → exclude all of .git except config.
function isExcluded(normalizedPath: string, patterns: CompiledPattern[]): boolean {
	let excluded = false;
	for (const { negate, re, anchored } of patterns) {
		const matches = anchored
			? re.test(normalizedPath)
			: normalizedPath.split("/").some((seg) => re.test(seg));
		if (matches) excluded = !negate;
	}
	return excluded;
}

// Convert a glob pattern to a RegExp source string.
//   *   matches any characters within one path segment (no /)
//   **  matches any characters across segments (including /)
//   **/  at the start → zero or more leading segments
//   /**  at the end   → the directory itself or any descendant
function globToRegexSrc(pattern: string): string {
	return pattern
		.replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials (not *)
		.replace(/\*\*/g, "\x00")              // protect **
		.replace(/\*/g, "[^/]*")               // * → within-segment wildcard
		.replace(/\x00\//g, "(?:[^/]+/)*")     // **/ → zero-or-more segments prefix
		.replace(/\/\x00/g, "(?:/.*)?")        // /** → optional subtree suffix
		.replace(/\x00/g, ".*");               // bare ** → anything
}
