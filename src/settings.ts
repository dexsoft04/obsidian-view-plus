import { App, Notice, PluginSettingTab, Setting, TextAreaComponent } from "obsidian";
import type ViewPlusPlugin from "./main";

export interface ViewPlusSettings {
	showHiddenFiles: boolean;
	showUnsupportedFiles: boolean;
	excludePatterns: string[];
}

export const DEFAULT_SETTINGS: ViewPlusSettings = {
	showHiddenFiles: true,
	showUnsupportedFiles: true,
	excludePatterns: [".git/**", "!.git/config"],
};

export class ViewPlusSettingTab extends PluginSettingTab {
	plugin: ViewPlusPlugin;
	private excludeDebounceTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(app: App, plugin: ViewPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "View Plus Settings" });

		new Setting(containerEl)
			.setName("Show hidden files and folders")
			.setDesc(
				"Display dotfiles and dotfolders (e.g. .gitignore, .env, .github/) " +
					"in the file explorer. Requires plugin reload to fully take effect. " +
					"Large dot-folders (e.g. .git) may cause a temporary freeze on first scan."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showHiddenFiles)
					.onChange(async (value) => {
						this.plugin.settings.showHiddenFiles = value;
						await this.plugin.saveSettings();
						if (value) {
							this.plugin.applyHiddenFilesPatch();
						} else {
							this.plugin.removeHiddenFilesPatch();
							new Notice(
								"View Plus: Hidden files hidden. " +
									"Restart Obsidian to remove them from the file explorer."
							);
						}
					})
			);

		new Setting(containerEl)
			.setName("Show unsupported file types")
			.setDesc(
				"Display files with extensions Obsidian doesn't natively support " +
					"(e.g. .py, .js, .json, .csv, .zip). Uses Obsidian's built-in " +
					"'showUnsupportedFiles' vault config setting."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showUnsupportedFiles)
					.onChange(async (value) => {
						this.plugin.settings.showUnsupportedFiles = value;
						await this.plugin.saveSettings();
						this.plugin.applyUnsupportedFilesSetting(value);
					})
			);

		new Setting(containerEl)
			.setName("Exclude patterns")
			.setDesc(
				"One pattern per line. Supports * (within a segment) and ** (across segments). " +
					"Use ! prefix to negate. Patterns without / match the filename at any depth. " +
					"Examples: *.log  .env*  .git/**  !.git/config  **/vendor"
			)
			.addTextArea((text: TextAreaComponent) => {
				text
					.setPlaceholder(".git/**\n!.git/config")
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange((value) => {
						clearTimeout(this.excludeDebounceTimer);
						this.excludeDebounceTimer = setTimeout(async () => {
							this.plugin.settings.excludePatterns = value
								.split("\n")
								.map((line) => line.trim())
								.filter((line) => line.length > 0);
							await this.plugin.saveSettings();
						}, 300);
					});
				text.inputEl.rows = 8;
				text.inputEl.cols = 40;
				text.inputEl.style.width = "100%";
				text.inputEl.style.fontFamily = "var(--font-monospace)";
			});
	}
}
