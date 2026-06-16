import { App, FileView, Notice, setIcon, TFile, TextFileView, WorkspaceLeaf } from "obsidian";
import {
	bracketMatching,
	defaultHighlightStyle,
	foldGutter,
	foldKeymap,
	indentOnInput,
	StreamLanguage,
	syntaxHighlighting,
} from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
	closeSearchPanel,
	findNext,
	findPrevious,
	getSearchQuery,
	highlightSelectionMatches,
	openSearchPanel,
	replaceAll,
	replaceNext,
	search,
	searchKeymap,
	SearchQuery,
	searchPanelOpen,
	selectMatches,
	setSearchQuery,
} from "@codemirror/search";
import {
	crosshairCursor,
	drawSelection,
	dropCursor,
	EditorView,
	highlightActiveLine,
	highlightActiveLineGutter,
	highlightSpecialChars,
	keymap,
	type KeyBinding,
	lineNumbers,
	type Panel,
	rectangularSelection,
	type ViewUpdate,
} from "@codemirror/view";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { toml } from "@codemirror/legacy-modes/mode/toml";
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
const GO_EXTS = new Set(["go"]);
const JAVA_EXTS = new Set(["java", "kt"]);
const PYTHON_EXTS = new Set(["py"]);
const JSON_EXTS = new Set(["json", "jsonl", "ndjson"]);
const YAML_EXTS = new Set(["yaml", "yml"]);
const XML_EXTS = new Set(["xml"]);
const SQL_EXTS = new Set(["sql"]);
const SHELL_EXTS = new Set(["sh", "bash", "zsh", "fish"]);
const POWERSHELL_EXTS = new Set(["ps1"]);
const PROPERTIES_EXTS = new Set(["ini", "cfg", "conf", "properties", "env"]);
const DIFF_EXTS = new Set(["diff", "patch"]);
const RUBY_EXTS = new Set(["rb"]);
const RUST_EXTS = new Set(["rs"]);
const SWIFT_EXTS = new Set(["swift"]);
const VIEW_PLUS_SEARCH_KEYMAP: readonly KeyBinding[] = [
	{ key: "Mod-f", run: openSearchPanel },
	{ key: "Mod-h", run: openReplaceSearchPanel },
	{
		key: "Escape",
		run: (view) => {
			if (!searchPanelOpen(view.state)) return false;
			closeSearchPanel(view);
			return true;
		},
	},
];

const BASE_EDITOR_EXTENSIONS: Extension[] = [
	highlightSpecialChars(),
	history(),
	foldGutter(),
	lineNumbers(),
	highlightActiveLineGutter(),
	drawSelection(),
	dropCursor(),
	indentOnInput(),
	syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
	bracketMatching(),
	closeBrackets(),
	rectangularSelection(),
	crosshairCursor(),
	highlightActiveLine(),
	search({ top: true, createPanel: createViewPlusSearchPanel }),
	highlightSelectionMatches({
		highlightWordAroundCursor: true,
		minSelectionLength: 2,
	}),
	EditorView.lineWrapping,
	keymap.of([
		...VIEW_PLUS_SEARCH_KEYMAP,
		...searchKeymap,
		...closeBracketsKeymap,
		...historyKeymap,
		...foldKeymap,
		...defaultKeymap,
		indentWithTab,
	]),
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
		".cm-panels": {
			color: "var(--text-normal)",
			backgroundColor: "var(--background-primary)",
			borderColor: "var(--background-modifier-border)",
		},
		".cm-searchMatch": {
			backgroundColor: "var(--text-highlight-bg)",
			outline: "1px solid var(--text-accent)",
		},
		".cm-searchMatch-selected": {
			backgroundColor: "var(--text-selection)",
			outline: "1px solid var(--text-accent-hover)",
		},
		".cm-selectionMatch": {
			backgroundColor: "var(--background-modifier-hover)",
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
		this.addAction("search", "Find and replace", () => {
			this.openSearchPanel();
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

	openSearchPanel(): void {
		if (!this.editorView) return;
		openSearchPanel(this.editorView);
		this.editorView.focus();
	}

	openReplacePanel(): void {
		if (!this.editorView) return;
		openReplaceSearchPanel(this.editorView);
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

function createViewPlusSearchPanel(view: EditorView): Panel {
	const dom = document.createElement("div");
	dom.addClass("view-plus-search-panel");

	const searchGroup = dom.createDiv({ cls: "view-plus-search-group view-plus-search-main-group" });
	const searchField = createInputField(searchGroup, "search", "Find", "Find");
	searchField.input.setAttribute("main-field", "true");

	const navGroup = searchGroup.createDiv({ cls: "view-plus-search-control-group" });
	createIconButton(navGroup, "chevron-up", "Previous match (Shift+Enter)", () => findPrevious(view));
	createIconButton(navGroup, "chevron-down", "Next match (Enter)", () => findNext(view));
	createIconButton(navGroup, "list-checks", "Select all matches (Ctrl/Cmd+Enter)", () => selectMatches(view));

	const statusEl = searchGroup.createDiv({ cls: "view-plus-search-status" });

	const optionsGroup = dom.createDiv({ cls: "view-plus-search-group view-plus-search-options-group" });
	const caseButton = createTextToggle(optionsGroup, "Aa", "Match case");
	const regexpButton = createTextToggle(optionsGroup, ".*", "Regular expression");
	const wholeWordButton = createTextToggle(optionsGroup, "Word", "Whole word");

	const replaceGroup = dom.createDiv({ cls: "view-plus-search-group view-plus-search-replace-group" });
	const replaceField = createInputField(replaceGroup, "replace", "Replace", "Replace");
	createIconButton(replaceGroup, "replace", "Replace next (Enter)", () => replaceNext(view));
	createIconButton(replaceGroup, "replace-all", "Replace all (Alt+Enter)", () => replaceAll(view));
	createIconButton(dom, "x", "Close search", () => closeSearchPanel(view), "view-plus-search-close");

	const syncQueryFromInputs = (): void => {
		const currentQuery = getSearchQuery(view.state);
		const nextQuery = new SearchQuery({
			search: searchField.input.value,
			caseSensitive: caseButton.isPressed(),
			regexp: regexpButton.isPressed(),
			wholeWord: wholeWordButton.isPressed(),
			replace: replaceField.input.value,
			literal: currentQuery.literal,
		});
		view.dispatch({ effects: setSearchQuery.of(nextQuery) });
		updateStatus(view, statusEl);
	};

	searchField.input.addEventListener("input", syncQueryFromInputs);
	replaceField.input.addEventListener("input", syncQueryFromInputs);
	for (const toggle of [caseButton, regexpButton, wholeWordButton]) {
		toggle.button.addEventListener("click", () => {
			toggle.setPressed(!toggle.isPressed());
			syncQueryFromInputs();
		});
	}

	searchField.input.addEventListener("keydown", (event) => {
		if (handlePanelShortcut(event, view, searchField.input, replaceField.input)) return;
		if (event.key !== "Enter") return;
		event.preventDefault();
		if (event.shiftKey) {
			findPrevious(view);
		} else {
			findNext(view);
		}
	});
	replaceField.input.addEventListener("keydown", (event) => {
		if (handlePanelShortcut(event, view, searchField.input, replaceField.input)) return;
		if (event.key !== "Enter") return;
		event.preventDefault();
		if (event.altKey) {
			replaceAll(view);
		} else {
			replaceNext(view);
		}
	});
	dom.addEventListener("keydown", (event) => {
		handlePanelShortcut(event, view, searchField.input, replaceField.input);
	}, { capture: true });

	const syncInputsFromQuery = (targetView: EditorView): void => {
		const query = getSearchQuery(targetView.state);
		if (document.activeElement !== searchField.input) {
			searchField.input.value = query.search;
		}
		if (document.activeElement !== replaceField.input) {
			replaceField.input.value = query.replace;
		}
		caseButton.setPressed(query.caseSensitive);
		regexpButton.setPressed(query.regexp);
		wholeWordButton.setPressed(query.wholeWord);
		updateStatus(targetView, statusEl);
	};

	syncInputsFromQuery(view);

	return {
		dom,
		top: true,
		mount() {
			searchField.input.focus();
			searchField.input.select();
		},
		update(update: ViewUpdate) {
			if (update.docChanged || update.selectionSet || update.transactions.length > 0) {
				syncInputsFromQuery(update.view);
			}
		},
	};
}

function openReplaceSearchPanel(view: EditorView): boolean {
	openSearchPanel(view);
	window.requestAnimationFrame(() => {
		const replaceInput = view.dom.querySelector<HTMLInputElement>(
			".view-plus-search-panel input[name='replace']"
		);
		replaceInput?.focus();
		replaceInput?.select();
	});
	return true;
}

function handlePanelShortcut(
	event: KeyboardEvent,
	view: EditorView,
	searchInput: HTMLInputElement,
	replaceInput: HTMLInputElement
): boolean {
	const isModKey = event.metaKey || event.ctrlKey;
	if (event.key === "Escape") {
		event.preventDefault();
		event.stopPropagation();
		closeSearchPanel(view);
		view.focus();
		return true;
	}
	if (isModKey && event.key.toLowerCase() === "f") {
		event.preventDefault();
		event.stopPropagation();
		searchInput.focus();
		searchInput.select();
		return true;
	}
	if (isModKey && event.key.toLowerCase() === "h") {
		event.preventDefault();
		event.stopPropagation();
		replaceInput.focus();
		replaceInput.select();
		return true;
	}
	if (isModKey && event.key === "Enter") {
		event.preventDefault();
		event.stopPropagation();
		selectMatches(view);
		return true;
	}
	return false;
}

function createInputField(
	container: HTMLElement,
	name: string,
	placeholder: string,
	label: string
): { input: HTMLInputElement; root: HTMLElement } {
	const root = container.createDiv({ cls: "view-plus-search-input" });
	setIcon(root.createSpan({ cls: "view-plus-search-input-icon" }), name === "search" ? "search" : "replace");
	const input = root.createEl("input", {
		attr: {
			name,
			type: "text",
			placeholder,
			"aria-label": label,
			spellcheck: "false",
			autocomplete: "off",
		},
	});
	return { input, root };
}

function createIconButton(
	container: HTMLElement,
	icon: string,
	label: string,
	onClick: () => void,
	extraClass?: string
): HTMLButtonElement {
	const button = container.createEl("button", {
		cls: `view-plus-search-button view-plus-search-icon-button${extraClass ? ` ${extraClass}` : ""}`,
		attr: {
			type: "button",
			"aria-label": label,
			title: label,
		},
	});
	setIcon(button, icon);
	button.addEventListener("click", () => onClick());
	return button;
}

function createTextToggle(
	container: HTMLElement,
	text: string,
	label: string
): {
	button: HTMLButtonElement;
	isPressed(): boolean;
	setPressed(pressed: boolean): void;
} {
	const button = container.createEl("button", {
		text,
		cls: "view-plus-search-button view-plus-search-toggle",
		attr: {
			type: "button",
			"aria-label": label,
			title: label,
			"aria-pressed": "false",
		},
	});
	return {
		button,
		isPressed() {
			return button.getAttribute("aria-pressed") === "true";
		},
		setPressed(pressed: boolean) {
			button.setAttribute("aria-pressed", String(pressed));
			button.toggleClass("is-active", pressed);
		},
	};
}

function updateStatus(view: EditorView, statusEl: HTMLElement): void {
	const query = getSearchQuery(view.state);
	if (!query.search) {
		statusEl.setText("");
		statusEl.toggleClass("is-empty", true);
		return;
	}
	if (!query.valid) {
		statusEl.setText("Invalid");
		statusEl.toggleClass("is-empty", false);
		return;
	}

	const matchCount = countSearchMatches(view, query);
	statusEl.setText(matchCount >= 1000 ? "999+" : String(matchCount));
	statusEl.toggleClass("is-empty", false);
	statusEl.toggleClass("is-zero", matchCount === 0);
}

function countSearchMatches(view: EditorView, query: SearchQuery): number {
	const cursor = query.getCursor(view.state);
	let count = 0;
	while (!cursor.next().done) {
		count += 1;
		if (count >= 1000) break;
	}
	return count;
}

function getLanguageExtensions(file: TFile | null): Extension[] {
	if (!file) return [];
	const extension = file.extension.toLowerCase();
	const name = file.name.toLowerCase();

	const namedLanguage = getLanguageByFileName(name);
	if (namedLanguage) {
		return [namedLanguage];
	}

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
	if (GO_EXTS.has(extension)) {
		return [go()];
	}
	if (JAVA_EXTS.has(extension)) {
		return [java()];
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
	if (XML_EXTS.has(extension)) {
		return [xml()];
	}
	if (SQL_EXTS.has(extension)) {
		return [sql()];
	}
	if (SHELL_EXTS.has(extension)) {
		return [StreamLanguage.define(shell)];
	}
	if (POWERSHELL_EXTS.has(extension)) {
		return [StreamLanguage.define(powerShell)];
	}
	if (PROPERTIES_EXTS.has(extension)) {
		return [StreamLanguage.define(properties)];
	}
	if (extension === "toml") {
		return [StreamLanguage.define(toml)];
	}
	if (DIFF_EXTS.has(extension)) {
		return [StreamLanguage.define(diff)];
	}
	if (RUBY_EXTS.has(extension)) {
		return [StreamLanguage.define(ruby)];
	}
	if (RUST_EXTS.has(extension)) {
		return [StreamLanguage.define(rust)];
	}
	if (SWIFT_EXTS.has(extension)) {
		return [StreamLanguage.define(swift)];
	}

	return [];
}

function getLanguageByFileName(name: string): Extension | null {
	if (name === "dockerfile" || name.endsWith(".dockerfile")) {
		return StreamLanguage.define(dockerFile);
	}
	if (name === "makefile" || name === "justfile" || name === "procfile") {
		return StreamLanguage.define(shell);
	}
	if (name === "go.mod" || name === "go.sum") {
		return StreamLanguage.define(toml);
	}
	if (name === "cmakelists.txt") {
		return StreamLanguage.define(cmake);
	}
	if (name === ".env" || name.startsWith(".env.")) {
		return StreamLanguage.define(properties);
	}
	if (
		name === ".gitignore" ||
		name === ".dockerignore" ||
		name === ".editorconfig" ||
		name === ".gitattributes" ||
		name === ".gitconfig"
	) {
		return StreamLanguage.define(properties);
	}
	return null;
}
