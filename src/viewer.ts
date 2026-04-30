import { App, FileView, Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import { defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import {
	drawSelection,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	lineNumbers,
} from "@codemirror/view";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { yaml } from "@codemirror/lang-yaml";
import { canFormatWithViewPlus, formatWithViewPlus } from "./formatter";
import {
	copyAbsolutePath,
	copyVaultRelativePath,
	formatBytesAsMb,
	getMaxTextFileSizeBytes,
	openWithSystemApp,
	revealInSystemExplorer,
} from "./file-utils";
import type { ViewPlusSettings } from "./settings";

export const FILE_VIEWER_VIEW_TYPE = "view-plus-file-viewer";
export const MEDIA_VIEWER_VIEW_TYPE = "view-plus-media-viewer";

const IMAGE_EXTS = new Set(["avif", "ico", "tiff", "tif"]);
const AUDIO_EXTS = new Set(["aac", "opus"]);
const VIDEO_EXTS = new Set(["mov", "avi", "mkv", "wmv", "m4v"]);
const JAVASCRIPT_EXTS = new Set(["js", "mjs", "cjs", "jsx"]);
const TYPESCRIPT_EXTS = new Set(["ts", "tsx"]);
const CPP_EXTS = new Set(["c", "h", "cpp", "hpp"]);
const CSS_EXTS = new Set(["css", "scss", "sass", "less"]);
const HTML_EXTS = new Set(["html", "htm"]);
const PYTHON_EXTS = new Set(["py"]);
const JSON_EXTS = new Set(["json", "jsonl", "ndjson"]);
const YAML_EXTS = new Set(["yaml", "yml"]);

const BASE_EDITOR_EXTENSIONS: Extension[] = [
	lineNumbers(),
	highlightActiveLineGutter(),
	drawSelection(),
	indentOnInput(),
	syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
	highlightActiveLine(),
	EditorView.lineWrapping,
	EditorView.theme({
		"&": {
			height: "100%",
			fontSize: "var(--font-text-size, 14px)",
		},
		".cm-scroller": {
			overflow: "auto",
			fontFamily: "var(--font-monospace)",
		},
		".cm-content": {
			padding: "var(--size-4-4)",
			caretColor: "var(--text-normal)",
		},
		".cm-gutters": {
			borderRight: "1px solid var(--background-modifier-border)",
			backgroundColor: "var(--background-secondary)",
		},
	}),
];

export interface ViewPlusViewContext {
	getSettings(): ViewPlusSettings;
}

export async function openInViewPlusText(
	app: App,
	file: TFile,
	leaf?: WorkspaceLeaf
): Promise<FileViewerView | null> {
	const targetLeaf = leaf ?? app.workspace.getLeaf(true);
	await targetLeaf.setViewState({
		type: FILE_VIEWER_VIEW_TYPE,
		active: true,
		state: { file: file.path },
	});
	await targetLeaf.loadIfDeferred();
	app.workspace.setActiveLeaf(targetLeaf, { focus: true });
	return targetLeaf.view instanceof FileViewerView ? targetLeaf.view : null;
}

export class FileViewerView extends TextFileView {
	private editorView: EditorView | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly context: ViewPlusViewContext
	) {
		super(leaf);
		this.addCommonActions();
		this.addAction("wand-2", "Format file", () => {
			void this.formatCurrentFile();
		});
		this.addAction("refresh-cw", "Reload from disk", () => {
			void this.reloadFromDisk();
		});
	}

	getViewType(): string {
		return FILE_VIEWER_VIEW_TYPE;
	}

	getIcon(): string {
		return "file-code";
	}

	getDisplayText(): string {
		return this.file?.name ?? "View Plus";
	}

	getViewData(): string {
		return this.editorView?.state.doc.toString() ?? this.data;
	}

	async onLoadFile(file: TFile): Promise<void> {
		await super.onLoadFile(file);
	}

	setViewData(data: string, clear: boolean): void {
		if (clear) {
			this.clear();
		}
		this.data = data;
		this.contentEl.empty();
		this.contentEl.removeClass("view-plus-media");
		this.contentEl.removeClass("view-plus-viewer");

		const maxBytes = getMaxTextFileSizeBytes(this.context.getSettings());
		const fileSize = this.file?.stat.size ?? new TextEncoder().encode(data).length;
		if (fileSize > maxBytes) {
			renderTextFileTooLarge(this.contentEl, this.app, this.file, fileSize, maxBytes);
			return;
		}

		this.contentEl.addClass("view-plus-viewer");
		const host = this.contentEl.createDiv({ cls: "view-plus-editor-host" });
		this.editorView = new EditorView({
			state: EditorState.create({
				doc: data,
				extensions: [
					...BASE_EDITOR_EXTENSIONS,
					...getLanguageExtensions(this.file),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged) return;
						this.data = update.state.doc.toString();
						this.requestSave();
					}),
				],
			}),
			parent: host,
		});
	}

	clear(): void {
		this.data = "";
		this.editorView?.destroy();
		this.editorView = null;
		this.contentEl.empty();
		this.contentEl.removeClass("view-plus-viewer");
	}

	async reloadFromDisk(): Promise<void> {
		if (!this.file) return;
		await this.onLoadFile(this.file);
		new Notice("View Plus: reloaded file from disk.");
	}

	async formatCurrentFile(): Promise<void> {
		if (!this.file || !this.editorView) return;
		if (!canFormatWithViewPlus(this.file)) {
			new Notice("View Plus: formatting is not available for this file type.");
			return;
		}

		try {
			const currentContent = this.editorView.state.doc.toString();
			const formattedContent = await formatWithViewPlus(this.file, currentContent);
			if (formattedContent === currentContent) {
				new Notice("View Plus: file is already formatted.");
				return;
			}

			this.editorView.dispatch({
				changes: {
					from: 0,
					to: this.editorView.state.doc.length,
					insert: formattedContent,
				},
			});
			new Notice("View Plus: formatted file.");
		} catch (error) {
			console.error("View Plus: format failed", {
				path: this.file.path,
				error,
			});
			const message = error instanceof Error ? error.message : "Could not format this file.";
			new Notice(`View Plus: ${message}`);
		}
	}

	private addCommonActions(): void {
		this.addAction("external-link", "Open with system app", () => {
			if (this.file) {
				openWithSystemApp(this.app, this.file);
			}
		});
		this.addAction("folder-open", "Reveal in system explorer", () => {
			if (this.file) {
				revealInSystemExplorer(this.app, this.file);
			}
		});
		this.addAction("copy", "Copy vault-relative path", () => {
			if (this.file) {
				copyVaultRelativePath(this.file);
			}
		});
		this.addAction("files", "Copy absolute path", () => {
			if (this.file) {
				copyAbsolutePath(this.app, this.file);
			}
		});
	}
}

export class MediaView extends FileView {
	constructor(
		leaf: WorkspaceLeaf,
		_context: ViewPlusViewContext
	) {
		super(leaf);
		this.addCommonActions();
	}

	getViewType(): string {
		return MEDIA_VIEWER_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.file?.name ?? "View Plus";
	}

	getIcon(): string {
		const ext = this.file?.extension?.toLowerCase() ?? "";
		if (AUDIO_EXTS.has(ext)) return "music";
		if (VIDEO_EXTS.has(ext)) return "film";
		return "image";
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("view-plus-media");

		const ext = file.extension.toLowerCase();
		const adapter = this.app.vault.adapter as {
			getResourcePath?: (path: string) => string;
		};
		if (typeof adapter.getResourcePath !== "function") {
			renderCannotPreview(this.contentEl, this.app, file);
			return;
		}
		const resourcePath = adapter.getResourcePath(file.path);

		if (IMAGE_EXTS.has(ext)) {
			const wrap = this.contentEl.createDiv({
				cls: "view-plus-media-image-wrap",
			});
			const img = wrap.createEl("img", {
				attr: { src: resourcePath },
				cls: "view-plus-media-image",
			}) as HTMLImageElement;
			img.addEventListener("error", () => renderCannotPreview(wrap, this.app, file));
			return;
		}

		if (AUDIO_EXTS.has(ext)) {
			const wrap = this.contentEl.createDiv({
				cls: "view-plus-media-audio-wrap",
			});
			wrap.createEl("p", {
				text: file.name,
				cls: "view-plus-media-label",
			});
			const audio = wrap.createEl("audio", {
				cls: "view-plus-media-audio",
			}) as HTMLAudioElement;
			audio.src = resourcePath;
			audio.controls = true;
			audio.addEventListener("error", () => renderCannotPreview(wrap, this.app, file));
			return;
		}

		if (VIDEO_EXTS.has(ext)) {
			const wrap = this.contentEl.createDiv({
				cls: "view-plus-media-video-wrap",
			});
			const video = wrap.createEl("video", {
				cls: "view-plus-media-video",
			}) as HTMLVideoElement;
			video.src = resourcePath;
			video.controls = true;
			video.addEventListener("error", () => renderCannotPreview(wrap, this.app, file));
			return;
		}

		renderCannotPreview(this.contentEl, this.app, file);
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		this.contentEl.empty();
	}

	private addCommonActions(): void {
		this.addAction("external-link", "Open with system app", () => {
			if (this.file) {
				openWithSystemApp(this.app, this.file);
			}
		});
		this.addAction("folder-open", "Reveal in system explorer", () => {
			if (this.file) {
				revealInSystemExplorer(this.app, this.file);
			}
		});
		this.addAction("copy", "Copy vault-relative path", () => {
			if (this.file) {
				copyVaultRelativePath(this.file);
			}
		});
		this.addAction("files", "Copy absolute path", () => {
			if (this.file) {
				copyAbsolutePath(this.app, this.file);
			}
		});
	}
}

function renderTextFileTooLarge(
	container: HTMLElement,
	app: App,
	file: TFile | null,
	fileSize: number,
	maxBytes: number
): void {
	container.empty();
	const panel = container.createDiv({ cls: "view-plus-message-card" });
	panel.createEl("h3", {
		text: "Cannot open this file as text",
		cls: "view-plus-message-title",
	});
	panel.createEl("p", {
		cls: "view-plus-message-body",
		text: `This file is ${formatBytesAsMb(fileSize)} MB, which exceeds the View Plus text limit of ${formatBytesAsMb(maxBytes)} MB.`,
	});
	panel.createEl("p", {
		cls: "view-plus-message-body",
		text: "Recommended next step: open it with the system app, or reveal it in the system explorer.",
	});
	if (file) {
		renderActionButtons(panel, app, file, false);
	}
}

function renderCannotPreview(container: HTMLElement, app: App, file: TFile): void {
	container.empty();
	const panel = container.createDiv({ cls: "view-plus-message-card" });
	panel.createEl("h3", {
		cls: "view-plus-message-title",
		text: "Cannot preview this file in Obsidian",
	});
	panel.createEl("p", {
		cls: "view-plus-message-body",
		text: "Recommended next step: open it with the system app, reveal it in the system explorer, or copy its path for another tool.",
	});
	renderActionButtons(panel, app, file, true);
}

function renderActionButtons(
	container: HTMLElement,
	app: App,
	file: TFile,
	includeCopyActions: boolean
): void {
	const actionRow = container.createDiv({ cls: "view-plus-message-actions" });
	createActionButton(actionRow, "Open with system app", () => openWithSystemApp(app, file));
	createActionButton(actionRow, "Reveal in system explorer", () => revealInSystemExplorer(app, file));
	if (includeCopyActions) {
		createActionButton(actionRow, "Copy vault-relative path", () => copyVaultRelativePath(file));
		createActionButton(actionRow, "Copy absolute path", () => copyAbsolutePath(app, file));
	}
}

function createActionButton(
	container: HTMLElement,
	label: string,
	onClick: () => void
): void {
	const button = container.createEl("button", {
		cls: "mod-cta view-plus-action-button",
		text: label,
	});
	button.addEventListener("click", onClick);
}

function getLanguageExtensions(file: TFile | null): Extension[] {
	if (!file) return [];
	const extension = file.extension.toLowerCase();

	if (JAVASCRIPT_EXTS.has(extension)) {
		return [javascript({ jsx: extension === "jsx" })];
	}
	if (TYPESCRIPT_EXTS.has(extension)) {
		return [javascript({ typescript: true, jsx: extension === "tsx" })];
	}
	if (CPP_EXTS.has(extension)) {
		return [cpp()];
	}
	if (CSS_EXTS.has(extension)) {
		return [css()];
	}
	if (HTML_EXTS.has(extension)) {
		return [html()];
	}
	if (JSON_EXTS.has(extension)) {
		return [json()];
	}
	if (PYTHON_EXTS.has(extension)) {
		return [python()];
	}
	if (YAML_EXTS.has(extension)) {
		return [yaml()];
	}

	return [];
}
