import { Plugin, TFile } from "obsidian";
import {
	FILE_VIEWER_VIEW_TYPE,
	FileViewerView,
	MEDIA_EXTENSIONS,
	MEDIA_VIEWER_VIEW_TYPE,
	MediaView,
	TEXT_EXTENSIONS,
	openWithSystemApp,
} from "./viewer";

export default class ViewPlusPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(FILE_VIEWER_VIEW_TYPE, (leaf) => new FileViewerView(leaf));
		safeRegisterExtensions(this, TEXT_EXTENSIONS, FILE_VIEWER_VIEW_TYPE);

		this.registerView(MEDIA_VIEWER_VIEW_TYPE, (leaf) => new MediaView(leaf));
		safeRegisterExtensions(this, MEDIA_EXTENSIONS, MEDIA_VIEWER_VIEW_TYPE);

		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!isExternallyOpenableFile(file)) return;
				menu.addItem((item) =>
					item
						.setTitle("Open with system app")
						.setIcon("external-link")
						.onClick(() => openWithSystemApp(this.app, file))
				);
			})
		);

		this.addCommand({
			id: "open-with-system-app",
			name: "Open with system app",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!isExternallyOpenableFile(file)) return false;
				if (!checking) {
					openWithSystemApp(this.app, file);
				}
				return true;
			},
		});

		this.registerDomEvent(document, "dblclick", (evt: MouseEvent) => {
			const navTitle = (evt.target as HTMLElement).closest<HTMLElement>(
				".nav-file-title"
			);
			if (!navTitle) return;
			const filePath = navTitle.getAttribute("data-path");
			if (!filePath) return;
			const file = this.app.vault.getFileByPath(filePath);
			if (!isExternallyOpenableFile(file)) return;
			openWithSystemApp(this.app, file);
		});
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

function isExternallyOpenableFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension.toLowerCase() !== "md";
}
