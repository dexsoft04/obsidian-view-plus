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
import { join } from "path";

export const FILE_VIEWER_VIEW_TYPE = "view-plus-file-viewer";
export const MEDIA_VIEWER_VIEW_TYPE = "view-plus-media-viewer";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

const IMAGE_EXTS = new Set(["avif", "ico", "tiff", "tif"]);
const AUDIO_EXTS = new Set(["aac", "opus"]);
const VIDEO_EXTS = new Set(["mov", "avi", "mkv", "wmv", "m4v"]);
const JAVASCRIPT_EXTS = new Set(["js", "mjs", "cjs", "jsx"]);
const TYPESCRIPT_EXTS = new Set(["ts", "tsx"]);
const CPP_EXTS = new Set(["c", "h", "cpp", "hpp"]);
const CSS_EXTS = new Set(["css", "scss", "sass", "less"]);
const HTML_EXTS = new Set(["html", "htm"]);
const PYTHON_EXTS = new Set(["py"]);
const JSON_EXTS = new Set(["json"]);
const YAML_EXTS = new Set(["yaml", "yml"]);

export const MEDIA_EXTENSIONS = [...IMAGE_EXTS, ...AUDIO_EXTS, ...VIDEO_EXTS];

export const TEXT_EXTENSIONS = [
	"js", "mjs", "cjs", "ts", "jsx", "tsx",
	"py", "rb", "php", "go", "rs",
	"c", "h", "cpp", "hpp", "java", "kt", "swift",
	"json", "yaml", "yml", "toml",
	"ini", "cfg", "conf", "properties", "env",
	"gitignore", "gitconfig", "gitattributes", "editorconfig",
	"dockerignore", "lock",
	"css", "scss", "sass", "less",
	"html", "htm", "xml",
	"sh", "bash", "zsh", "fish", "ps1",
	"sql", "csv", "tsv",
	"txt", "log", "diff", "patch",
];

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

export function openWithSystemApp(app: App, file: TFile): void {
	const adapter = app.vault.adapter as { getBasePath?: () => string };
	if (typeof adapter.getBasePath !== "function") {
		new Notice("View Plus: system app opening is only available on desktop.");
		return;
	}
	const absPath = join(adapter.getBasePath(), file.path);
	// @ts-ignore electron is available in the Obsidian desktop environment
	const { shell } = require("electron");
	shell.openPath(absPath).then((err: string) => {
		if (err) {
			console.error("View Plus: openPath failed", err);
			new Notice(`View Plus: could not open file - ${err}`);
		}
	});
}

export class FileViewerView extends TextFileView {
	private editorView: EditorView | null = null;

	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.addAction("external-link", "Open with system app", () => {
			if (this.file) {
				openWithSystemApp(this.app, this.file);
			}
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

	setViewData(data: string, clear: boolean): void {
		if (clear) {
			this.clear();
		}
		this.data = data;
		this.contentEl.empty();
		this.contentEl.removeClass("view-plus-media");

		if (data.length > MAX_FILE_SIZE) {
			this.contentEl.createEl("p", {
				cls: "view-plus-too-large",
				text: `File too large to open in editor (${(data.length / (1024 * 1024)).toFixed(1)} MB). Use the system app action instead.`,
			});
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
}

export class MediaView extends FileView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
		this.addAction("external-link", "Open with system app", () => {
			if (this.file) {
				openWithSystemApp(this.app, this.file);
			}
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
		const adapter = this.app.vault.adapter as {
			getResourcePath?: (path: string) => string;
		};
		if (typeof adapter.getResourcePath !== "function") {
			renderCannotPreview(this.contentEl);
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
			img.addEventListener("error", () => renderCannotPreview(wrap));
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
			audio.addEventListener("error", () => renderCannotPreview(wrap));
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
			video.addEventListener("error", () => renderCannotPreview(wrap));
			return;
		}

		renderCannotPreview(this.contentEl);
	}

	async onUnloadFile(_file: TFile): Promise<void> {
		this.contentEl.empty();
	}
}

function renderCannotPreview(container: HTMLElement): void {
	container.empty();
	container.createEl("p", {
		cls: "view-plus-cannot-preview",
		text: 'Cannot preview this file in Obsidian. Use the "Open with system app" action instead.',
	});
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
