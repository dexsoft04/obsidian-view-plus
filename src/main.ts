import { Menu, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import {
	copyAbsolutePath,
	copyVaultRelativePath,
	getMaxTextFileSizeBytes,
	isNonMarkdownFile,
	MEDIA_EXTENSIONS,
	openWithSystemApp,
	revealInSystemExplorer,
	shouldOfferOpenInViewPlusText,
	TEXT_EXTENSIONS,
	ViewPlusFileClassifier,
} from "./file-utils";
import { canFormatWithViewPlus } from "./formatter";
import { DEFAULT_SETTINGS, type DoubleClickBehavior, type ViewPlusSettings } from "./settings";
import {
	FILE_VIEWER_VIEW_TYPE,
	FileViewerView,
	MEDIA_VIEWER_VIEW_TYPE,
	MediaView,
	openInViewPlusText,
} from "./viewer";

export default class ViewPlusPlugin extends Plugin {
	settings: ViewPlusSettings = DEFAULT_SETTINGS;
	classifier!: ViewPlusFileClassifier;
	private fileExplorerObserver: MutationObserver | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.classifier = new ViewPlusFileClassifier(this.app, () => this.settings);

		this.registerView(FILE_VIEWER_VIEW_TYPE, (leaf) =>
			new FileViewerView(leaf, { getSettings: () => this.settings })
		);
		safeRegisterExtensions(this, TEXT_EXTENSIONS, FILE_VIEWER_VIEW_TYPE);

		this.registerView(MEDIA_VIEWER_VIEW_TYPE, (leaf) =>
			new MediaView(leaf, { getSettings: () => this.settings })
		);
		safeRegisterExtensions(this, MEDIA_EXTENSIONS, MEDIA_VIEWER_VIEW_TYPE);

		this.addSettingTab(new ViewPlusSettingTab(this.app, this));
		this.registerCommands();
		this.registerMenuHandlers();
		this.registerVaultCacheHandlers();
		this.registerExtensionlessTextOpenHandler();
		this.registerExtensionlessTextFileExplorerHandler();
		this.registerDoubleClickHandler();
	}

	async loadSettings(): Promise<void> {
		const saved = await this.loadData();
		this.settings = { ...DEFAULT_SETTINGS, ...saved };
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.classifier.clear();
		this.updateExtensionlessTextFileExplorerItems();
	}

	async openFileInTextView(file: TFile): Promise<void> {
		const classification = await this.classifier.classify(file);
		if (!classification.textOpenEligible || classification.kind !== "text") {
			new Notice("View Plus: this file is not recognized as text-readable.");
			return;
		}
		await openInViewPlusText(this.app, file);
	}

	async formatFileInTextView(file: TFile): Promise<void> {
		const classification = await this.classifier.classify(file);
		if (!classification.textOpenEligible || classification.kind !== "text") {
			new Notice("View Plus: this file is not recognized as text-readable.");
			return;
		}
		if (!canFormatWithViewPlus(file)) {
			new Notice("View Plus: formatting is not available for this file type.");
			return;
		}

		const view = await openInViewPlusText(this.app, file);
		if (!view) {
			new Notice("View Plus: could not open a text view for formatting.");
			return;
		}
		await view.formatCurrentFile();
	}

	async reloadActiveTextView(): Promise<void> {
		const activeView = this.app.workspace.getActiveViewOfType(FileViewerView);
		if (!activeView) {
			new Notice("View Plus: the active view is not a View Plus text view.");
			return;
		}
		await activeView.reloadFromDisk();
	}

	private registerCommands(): void {
		this.addCommand({
			id: "open-with-system-app",
			name: "Open with system app",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isNonMarkdownFile(file)) return false;
				if (!checking) {
					openWithSystemApp(this.app, file);
				}
				return true;
			},
		});

		this.addCommand({
			id: "reveal-in-system-explorer",
			name: "Reveal in system explorer",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isNonMarkdownFile(file)) return false;
				if (!checking) {
					revealInSystemExplorer(this.app, file);
				}
				return true;
			},
		});

		this.addCommand({
			id: "copy-vault-relative-path",
			name: "Copy vault-relative path",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isNonMarkdownFile(file)) return false;
				if (!checking) {
					copyVaultRelativePath(file);
				}
				return true;
			},
		});

		this.addCommand({
			id: "copy-absolute-path",
			name: "Copy absolute path",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isNonMarkdownFile(file)) return false;
				if (!checking) {
					copyAbsolutePath(this.app, file);
				}
				return true;
			},
		});

		this.addCommand({
			id: "open-in-view-plus-text",
			name: "Open in View Plus as text",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isNonMarkdownFile(file)) return false;
				const classification = this.classifier.peek(file);
				if (!shouldOfferOpenInViewPlusText(file, classification)) {
					return false;
				}
				if (!checking) {
					void this.openFileInTextView(file);
				}
				return true;
			},
		});

		this.addCommand({
			id: "reload-file-from-disk",
			name: "Reload file from disk",
			checkCallback: (checking) => {
				const activeView = this.app.workspace.getActiveViewOfType(FileViewerView);
				if (!activeView?.file) return false;
				if (!checking) {
					void this.reloadActiveTextView();
				}
				return true;
			},
		});

		this.addCommand({
			id: "format-file",
			name: "Format file",
			checkCallback: (checking) => {
				const activeView = this.app.workspace.getActiveViewOfType(FileViewerView);
				if (!activeView?.file || !canFormatWithViewPlus(activeView.file)) return false;
				if (!checking) {
					void activeView.formatCurrentFile();
				}
				return true;
			},
		});
	}

	private registerMenuHandlers(): void {
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!isNonMarkdownFile(file)) return;
				this.addCommonFileMenuItems(menu, file);
			})
		);
	}

	private registerVaultCacheHandlers(): void {
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) {
					this.classifier.invalidate(file.path);
					this.scheduleExtensionlessTextFileExplorerUpdate();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					this.classifier.invalidate(file.path);
					this.scheduleExtensionlessTextFileExplorerUpdate();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) {
					this.classifier.invalidate(file.path);
					this.scheduleExtensionlessTextFileExplorerUpdate();
				}
			})
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.classifier.invalidate(oldPath);
					this.classifier.invalidate(file.path);
					this.scheduleExtensionlessTextFileExplorerUpdate();
				}
			})
		);
	}

	private registerExtensionlessTextOpenHandler(): void {
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				if (!(file instanceof TFile)) return;
				if (file.extension.length > 0) return;
				void this.openExtensionlessTextFile(file);
			})
		);
	}

	private async openExtensionlessTextFile(file: TFile): Promise<void> {
		if (file.stat.size > getMaxTextFileSizeBytes(this.settings)) {
			return;
		}

		const activeLeaf = this.app.workspace.getLeaf(false);
		if (activeLeaf.view instanceof FileViewerView && activeLeaf.view.file?.path === file.path) {
			return;
		}

		const classification = await this.classifier.classify(file);
		if (classification.kind !== "text" || !classification.textOpenEligible) {
			return;
		}

		await openInViewPlusText(this.app, file, activeLeaf);
	}

	private registerExtensionlessTextFileExplorerHandler(): void {
		this.updateExtensionlessTextFileExplorerItems();
		this.fileExplorerObserver = new MutationObserver(() => {
			this.updateExtensionlessTextFileExplorerItems();
		});
		this.fileExplorerObserver.observe(document.body, {
			childList: true,
			subtree: true,
		});
		this.register(() => {
			this.fileExplorerObserver?.disconnect();
			this.fileExplorerObserver = null;
		});
		this.registerDomEvent(
			document,
			"click",
			(event: MouseEvent) => {
				if (event.button !== 0) return;
				const file = this.getExtensionlessFileFromNavEvent(event);
				if (!file) return;
				if (!this.canOpenExtensionlessTextFileSync(file)) return;

				event.preventDefault();
				event.stopPropagation();
				void this.openExtensionlessTextFile(file);
			},
			{ capture: true }
		);
	}

	private getExtensionlessFileFromNavEvent(event: MouseEvent): TFile | null {
		const navTitle = (event.target as HTMLElement | null)?.closest<HTMLElement>(
			".nav-file-title[data-path]"
		);
		const filePath = navTitle?.getAttribute("data-path");
		if (!filePath) return null;

		const file = this.app.vault.getFileByPath(filePath);
		if (!(file instanceof TFile)) return null;
		if (file.extension.length > 0) return null;
		return file;
	}

	private canOpenExtensionlessTextFileSync(file: TFile): boolean {
		if (file.stat.size > getMaxTextFileSizeBytes(this.settings)) {
			return false;
		}
		const classification = this.classifier.peek(file);
		return classification.kind === "text" && classification.textOpenEligible;
	}

	private scheduleExtensionlessTextFileExplorerUpdate(): void {
		window.requestAnimationFrame(() => this.updateExtensionlessTextFileExplorerItems());
	}

	private updateExtensionlessTextFileExplorerItems(): void {
		const navTitles = Array.from(document.querySelectorAll<HTMLElement>(
			".nav-file-title.is-unsupported[data-path]"
		));
		for (const navTitle of navTitles) {
			const filePath = navTitle.getAttribute("data-path");
			const file = filePath ? this.app.vault.getFileByPath(filePath) : null;
			if (file instanceof TFile && file.extension.length === 0 && this.canOpenExtensionlessTextFileSync(file)) {
				navTitle.addClass("view-plus-extensionless-text-file");
			} else {
				navTitle.removeClass("view-plus-extensionless-text-file");
			}
		}
	}

	private registerDoubleClickHandler(): void {
		this.registerDomEvent(document, "dblclick", (event: MouseEvent) => {
			if (!this.shouldHandleDoubleClick(event)) return;
			const navTitle = (event.target as HTMLElement | null)?.closest<HTMLElement>(
				".nav-file-title"
			);
			if (!navTitle) return;
			const filePath = navTitle.getAttribute("data-path");
			if (!filePath) return;
			const file = this.app.vault.getFileByPath(filePath);
			if (!isNonMarkdownFile(file)) return;
			openWithSystemApp(this.app, file);
		});
	}

	private shouldHandleDoubleClick(event: MouseEvent): boolean {
		switch (this.settings.doubleClickBehavior) {
			case "off":
				return false;
			case "plain-double-click":
				return true;
			case "alt-double-click":
				return event.altKey;
			default:
				return false;
		}
	}

	private addCommonFileMenuItems(menu: Menu, file: TFile): void {
		menu.addItem((item) =>
			item
				.setTitle("Open with system app")
				.setIcon("external-link")
				.onClick(() => openWithSystemApp(this.app, file))
		);
		menu.addItem((item) =>
			item
				.setTitle("Reveal in system explorer")
				.setIcon("folder-open")
				.onClick(() => revealInSystemExplorer(this.app, file))
		);
		menu.addItem((item) =>
			item
				.setTitle("Copy vault-relative path")
				.setIcon("copy")
				.onClick(() => copyVaultRelativePath(file))
		);
		menu.addItem((item) =>
			item
				.setTitle("Copy absolute path")
				.setIcon("files")
				.onClick(() => copyAbsolutePath(this.app, file))
		);

		const cachedClassification = this.classifier.peek(file);
		if (shouldOfferOpenInViewPlusText(file, cachedClassification)) {
			menu.addItem((item) =>
				item
					.setTitle("Open in View Plus as text")
					.setIcon("file-code")
					.onClick(() => {
						void this.openFileInTextView(file);
					})
			);
		}
		if (canFormatWithViewPlus(file) && cachedClassification.kind === "text" && cachedClassification.textOpenEligible) {
			menu.addItem((item) =>
				item
					.setTitle("Format with View Plus")
					.setIcon("wand-2")
					.onClick(() => {
						void this.formatFileInTextView(file);
					})
			);
		}

		if (this.hasOpenTextView(file)) {
			menu.addItem((item) =>
				item
					.setTitle("Reload file from disk")
					.setIcon("refresh-cw")
					.onClick(() => {
						void this.reloadOpenTextViewsForFile(file);
					})
			);
		}
	}

	private hasOpenTextView(file: TFile): boolean {
		return this.app.workspace
			.getLeavesOfType(FILE_VIEWER_VIEW_TYPE)
			.some((leaf) => leaf.view instanceof FileViewerView && leaf.view.file?.path === file.path);
	}

	private async reloadOpenTextViewsForFile(file: TFile): Promise<void> {
		const views = this.app.workspace
			.getLeavesOfType(FILE_VIEWER_VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter(
				(view): view is FileViewerView =>
					view instanceof FileViewerView && view.file?.path === file.path
			);
		if (views.length === 0) {
			new Notice("View Plus: this file is not open in a View Plus text view.");
			return;
		}
		await Promise.all(views.map((view) => view.reloadFromDisk()));
	}
}

function safeRegisterExtensions(
	plugin: ViewPlusPlugin,
	extensions: string[],
	viewType: string
): void {
	const skippedExtensions: string[] = [];
	for (const extension of extensions) {
		try {
			plugin.registerExtensions([extension], viewType);
		} catch {
			skippedExtensions.push(extension);
		}
	}
	if (skippedExtensions.length > 0) {
		console.info("View Plus: skipped already-registered extensions", {
			viewType,
			extensions: skippedExtensions,
		});
	}
}

class ViewPlusSettingTab extends PluginSettingTab {
	constructor(app: Plugin["app"], private readonly plugin: ViewPlusPlugin) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Double-click external open")
			.setDesc("Choose how file explorer double-click should open the system app for non-Markdown files.")
			.addDropdown((dropdown) => {
				dropdown
					.addOption("alt-double-click", "Alt + double-click")
					.addOption("plain-double-click", "Plain double-click")
					.addOption("off", "Off")
					.setValue(this.plugin.settings.doubleClickBehavior)
					.onChange(async (value: DoubleClickBehavior) => {
						this.plugin.settings.doubleClickBehavior = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Max text file size (MB)")
			.setDesc("Block oversized text files from opening in the editor and recommend external actions instead.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "0.5";
				text.inputEl.step = "0.5";
				text.setValue(String(this.plugin.settings.maxTextFileSizeMb)).onChange(async (value) => {
					const parsed = Number.parseFloat(value);
					if (!Number.isFinite(parsed) || parsed < 0.5) {
						return;
					}
					this.plugin.settings.maxTextFileSizeMb = parsed;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName("Enable compound text patterns")
			.setDesc("Recognize high-value text file names such as go.mod and .env.example.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableCompoundTextPatterns)
					.onChange(async (value) => {
						this.plugin.settings.enableCompoundTextPatterns = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Enable extensionless text sniff")
			.setDesc("Sniff small files without an extension so config and log files can open in View Plus as text.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableExtensionlessTextSniff)
					.onChange(async (value) => {
						this.plugin.settings.enableExtensionlessTextSniff = value;
						await this.plugin.saveSettings();
					});
			});
	}
}
