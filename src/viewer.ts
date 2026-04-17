import { App, FileView, MarkdownRenderer, Notice, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import { join } from "path";

export const FILE_VIEWER_VIEW_TYPE = "view-plus-file-viewer";
export const MEDIA_VIEWER_VIEW_TYPE = "view-plus-media-viewer";

const MAX_FILE_SIZE = 500 * 1024; // 500 KB
const MAX_TABLE_ROWS = 5000;

// Media extensions NOT natively supported by Obsidian (avoids overriding built-in viewers)
const IMAGE_EXTS = new Set(["avif", "ico", "tiff", "tif"]);
const AUDIO_EXTS = new Set(["aac", "opus"]);
const VIDEO_EXTS = new Set(["mov", "avi", "mkv", "wmv", "m4v"]);

export const MEDIA_EXTENSIONS = [
	...IMAGE_EXTS,
	...AUDIO_EXTS,
	...VIDEO_EXTS,
];

// Open a vault file with the OS default application.
export function openWithSystemApp(app: App, file: TFile): void {
	const basePath = (app.vault.adapter as any).getBasePath() as string;
	const absPath = join(basePath, file.path);
	// @ts-ignore – electron is available in the Obsidian desktop environment
	const { shell } = require("electron");
	shell.openPath(absPath).then((err: string) => {
		if (err) {
			console.error("View Plus: openPath failed", err);
			new Notice(`View Plus: could not open file — ${err}`);
		}
	});
}

// ─── Text / code file viewer ────────────────────────────────────────────────

export class FileViewerView extends TextFileView {
	private renderSeq = 0;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.addAction("external-link", "Open with system app", () => {
			if (this.file) openWithSystemApp(this.app, this.file);
		});
	}

	getViewType(): string {
		return FILE_VIEWER_VIEW_TYPE;
	}

	getIcon(): string {
		const ext = this.file?.extension?.toLowerCase() ?? "";
		if (ext === "csv" || ext === "tsv") return "table";
		return "file-code";
	}

	getDisplayText(): string {
		return this.file?.name ?? "View Plus";
	}

	getViewData(): string {
		return this.data;
	}

	setViewData(data: string, _clear: boolean): void {
		this.data = data;
		this.renderContent(data).catch((e) => {
			console.error("View Plus: renderContent failed", e);
			this.contentEl.empty();
			this.contentEl.createEl("p", {
				cls: "view-plus-too-large",
				text: `Render error: ${e instanceof Error ? e.message : String(e)}`,
			});
		});
	}

	clear(): void {
		this.renderSeq++;
		this.data = "";
		this.contentEl.empty();
		this.contentEl.removeClass("view-plus-viewer");
	}

	private async renderContent(content: string): Promise<void> {
		const seq = ++this.renderSeq;
		this.contentEl.empty();
		this.contentEl.removeClass("view-plus-viewer");

		const ext = this.file?.extension?.toLowerCase() ?? "";

		// CSV / TSV → render as a scrollable table (table-wrap handles its own layout)
		if (ext === "csv" || ext === "tsv") {
			// Strip UTF-8 BOM that Excel commonly prepends to CSV exports.
			const normalized = content.startsWith("\uFEFF") ? content.slice(1) : content;
			renderCsvTable(this.contentEl, normalized, ext === "tsv" ? "\t" : ",");
			return;
		}

		this.contentEl.addClass("view-plus-viewer");

		if (content.length > MAX_FILE_SIZE) {
			this.contentEl.createEl("p", {
				cls: "view-plus-too-large",
				text: `File too large to preview (${Math.round(content.length / 1024)} KB).`,
			});
			return;
		}

		const lang = extensionToLanguage(ext);
		const markdown = "```" + lang + "\n" + content + "\n```";

		// Render into an off-screen element so a superseding render cannot clear
		// our result after it has already committed its own.
		const temp = document.createElement("div");
		await MarkdownRenderer.render(
			this.app,
			markdown,
			temp,
			this.file?.path ?? "",
			this
		);

		if (seq !== this.renderSeq) return;

		this.contentEl.empty();
		this.contentEl.append(...Array.from(temp.childNodes));
	}
}

// ─── Media viewer (images / audio / video not natively supported by Obsidian) ─

export class MediaView extends FileView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.addAction("external-link", "Open with system app", () => {
			if (this.file) openWithSystemApp(this.app, this.file);
		});
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
		const resourcePath = (this.app.vault.adapter as any).getResourcePath(
			file.path
		) as string;

		if (IMAGE_EXTS.has(ext)) {
			const wrap = this.contentEl.createDiv({ cls: "view-plus-media-image-wrap" });
			const img = wrap.createEl("img", {
				attr: { src: resourcePath },
				cls: "view-plus-media-image",
			}) as HTMLImageElement;
			img.addEventListener("error", () => renderCannotPreview(wrap));
		} else if (AUDIO_EXTS.has(ext)) {
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
			audio.addEventListener("error", () =>
				renderCannotPreview(wrap)
			);
		} else if (VIDEO_EXTS.has(ext)) {
			const wrap = this.contentEl.createDiv({
				cls: "view-plus-media-video-wrap",
			});
			const video = wrap.createEl("video", {
				cls: "view-plus-media-video",
			}) as HTMLVideoElement;
			video.src = resourcePath;
			video.controls = true;
			video.addEventListener("error", () =>
				renderCannotPreview(wrap)
			);
		}
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		this.contentEl.empty();
	}
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function renderCannotPreview(container: HTMLElement): void {
	container.empty();
	container.createEl("p", {
		cls: "view-plus-cannot-preview",
		text: 'Cannot preview this file in Obsidian. Use the "Open with system app" button above.',
	});
}

function renderCsvTable(
	containerEl: HTMLElement,
	content: string,
	delimiter: string
): void {
	// +1 to detect truncation: if we get MAX_TABLE_ROWS+1 data rows back the
	// file has more rows than we want to show.
	const { rows, truncated } = parseCsv(content, delimiter, MAX_TABLE_ROWS + 1);
	if (rows.length === 0) {
		containerEl.createEl("p", {
			text: "Empty file.",
			cls: "view-plus-too-large",
		});
		return;
	}

	const displayRows = truncated ? rows.slice(0, MAX_TABLE_ROWS + 1) : rows;
	const colCount = Math.max(...displayRows.map((r) => r.length));

	const outer = containerEl.createDiv({ cls: "view-plus-csv-container" });
	const wrap = outer.createDiv({ cls: "view-plus-table-wrap" });
	const table = wrap.createEl("table", { cls: "view-plus-table" });

	const thead = table.createEl("thead");
	const headerRow = thead.createEl("tr");
	for (let i = 0; i < colCount; i++) {
		headerRow.createEl("th", { text: displayRows[0][i] ?? "" });
	}

	const tbody = table.createEl("tbody");
	for (const row of displayRows.slice(1)) {
		const tr = tbody.createEl("tr");
		for (let i = 0; i < colCount; i++) {
			tr.createEl("td", { text: row[i] ?? "" });
		}
	}

	if (truncated) {
		outer.createEl("p", {
			cls: "view-plus-table-truncated",
			text: `Showing first ${MAX_TABLE_ROWS.toLocaleString()} rows (file has more).`,
		});
	}
}

// RFC-4180 CSV parser: handles quoted fields and "" escaping.
// maxRows: stop collecting data rows (excluding header) once this limit is
// reached — avoids loading the entire file into memory for large CSVs.
// Returns { rows, truncated } where truncated=true means the file had more rows.
function parseCsv(
	content: string,
	delimiter: string,
	maxRows = Infinity
): { rows: string[][]; truncated: boolean } {
	const rows: string[][] = [];
	let current: string[] = [];
	let field = "";
	let inQuotes = false;
	let i = 0;
	let truncated = false;

	while (i < content.length) {
		const ch = content[i];

		if (inQuotes) {
			if (ch === '"') {
				if (content[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
			} else {
				field += ch;
			}
		} else if (ch === '"') {
			inQuotes = true;
		} else if (ch === delimiter) {
			current.push(field);
			field = "";
		} else if (ch === "\n") {
			current.push(field);
			field = "";
			rows.push(current);
			current = [];
			// rows[0] is the header; data rows start at index 1.
			if (rows.length > maxRows) {
				truncated = true;
				return { rows: rows.slice(0, maxRows), truncated };
			}
		} else if (ch !== "\r") {
			field += ch;
		}

		i++;
	}

	// Flush final field/row
	if (current.length > 0 || field !== "") {
		current.push(field);
		if (current.some((f) => f !== "")) rows.push(current);
	}

	return { rows, truncated };
}

// ─── Extension → syntax highlight language ──────────────────────────────────

export const TEXT_EXTENSIONS = [
	// Web / scripting
	"js", "mjs", "cjs", "ts", "jsx", "tsx",
	"py", "rb", "php", "go", "rs",
	"c", "h", "cpp", "hpp", "java", "kt", "swift",
	// Config / data
	"json", "yaml", "yml", "toml",
	"ini", "cfg", "conf", "properties", "env",
	"gitignore", "gitconfig", "gitattributes", "editorconfig",
	"dockerignore", "lock",
	// Styles / markup
	"css", "scss", "sass", "less",
	"html", "htm", "xml",
	// Shell
	"sh", "bash", "zsh", "fish", "ps1",
	// Query / data
	"sql", "csv", "tsv",
	// Misc text
	"txt", "log", "diff", "patch",
];

function extensionToLanguage(ext: string): string {
	const map: Record<string, string> = {
		js: "javascript", mjs: "javascript", cjs: "javascript",
		ts: "typescript",
		jsx: "javascript", tsx: "typescript",
		py: "python",
		rb: "ruby", php: "php",
		go: "go", rs: "rust",
		c: "c", h: "c", cpp: "cpp", hpp: "cpp",
		java: "java", kt: "kotlin", swift: "swift",
		json: "json",
		yaml: "yaml", yml: "yaml",
		toml: "toml",
		ini: "ini", cfg: "ini", conf: "ini", properties: "ini",
		env: "bash",
		gitignore: "bash", gitattributes: "ini", gitconfig: "ini",
		editorconfig: "ini", dockerignore: "bash",
		css: "css", scss: "scss", sass: "sass", less: "less",
		html: "html", htm: "html", xml: "xml",
		sh: "bash", bash: "bash", zsh: "bash", fish: "fish", ps1: "powershell",
		sql: "sql",
		diff: "diff", patch: "diff",
		lock: "yaml",
		log: "", txt: "",
	};
	return map[ext.toLowerCase()] ?? ext;
}
