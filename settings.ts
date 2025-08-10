// settings.ts
import { App, PluginSettingTab, Setting } from "obsidian";
import ClauPlugin from "./main";
import { buildEnhancedPrunedVectors } from "./pruner";
import { exportVaultVocabulary } from "./exporter";

export interface ClauSettings {
	ignoredFolders: string;
	privateTags: string;
	privateFolders: string;
	reindexInterval: number;
	enableSemanticSearch: boolean;
	glovePathFormat: string;
	gloveFileCount: number;
	prunedGlovePath: string;
	similarityThreshold: number;
	maxVocabSize: number;
	lastRebuildIndexTime: number | null;
	lastExportVocabularyTime: number | null;
	// New UMAP settings for visualization
	umapNNeighbors: number;
	umapMinDist: number;
}

export const DEFAULT_SETTINGS: ClauSettings = {
	ignoredFolders: "",
	privateTags: "",
	privateFolders: "",
	reindexInterval: 10,
	enableSemanticSearch: true,
	glovePathFormat: "embeddings/glove.6B.100d_part_{}.txt",
	gloveFileCount: 4,
	prunedGlovePath: "embeddings/enhanced_pruned_vectors.txt",
	similarityThreshold: 0,
	maxVocabSize: 100000,
	lastRebuildIndexTime: null,
	lastExportVocabularyTime: null,
	// New UMAP defaults
	umapNNeighbors: 15,
	umapMinDist: 0.03,
};

export class ClauSettingTab extends PluginSettingTab {
	plugin: ClauPlugin;

	constructor(app: App, plugin: ClauPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private formatTimestamp(timestamp: number | null): string {
		if (!timestamp) return "Never";
		return new Date(timestamp).toLocaleString();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Clau Settings" });

		// ... (Standard and Semantic Search settings remain here)
		// Standard Search Settings
		new Setting(containerEl)
			.setName("Ignored folders")
			.setDesc("Comma-separated list of folder paths to ignore.")
			.addText((text) =>
				text
					.setPlaceholder("e.g. templates/,private/")
					.setValue(this.plugin.settings.ignoredFolders)
					.onChange(async (value) => {
						this.plugin.settings.ignoredFolders = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Private tags")
			.setDesc(
				"A comma-separated list of tags. Notes containing any of these tags will not show a preview in the search results. The tag should not include the '#'.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. private,secret")
					.setValue(this.plugin.settings.privateTags)
					.onChange(async (value) => {
						this.plugin.settings.privateTags = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Private folders")
			.setDesc(
				"A comma-separated list of folder paths. Notes in these folders will not show a preview.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. journals/,personal/")
					.setValue(this.plugin.settings.privateFolders)
					.onChange(async (value) => {
						this.plugin.settings.privateFolders = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName("Re-index interval (minutes)")
			.setDesc(
				"The interval in minutes to automatically re-index the vault. Set to 0 to disable.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. 10")
					.setValue(String(this.plugin.settings.reindexInterval))
					.onChange(async (value) => {
						const interval = Number(value);
						if (!isNaN(interval) && interval >= 0) {
							this.plugin.settings.reindexInterval = interval;
							await this.plugin.saveSettings();
						}
					}),
			);

		// Semantic Search Settings
		containerEl.createEl("h2", { text: "Semantic Search" });
		new Setting(containerEl)
			.setName("Enable Semantic Search")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableSemanticSearch)
					.onChange(async (value) => {
						this.plugin.settings.enableSemanticSearch = value;
						await this.plugin.saveSettings();
						this.display();
					}),
			);
		const semanticSettingsEl = containerEl.createDiv();
		if (!this.plugin.settings.enableSemanticSearch) {
			semanticSettingsEl.style.opacity = "0.5";
			semanticSettingsEl.style.pointerEvents = "none";
		}
		semanticSettingsEl.createEl("h3", { text: "Desktop / Full Model" });
		new Setting(semanticSettingsEl)
			.setName("GloVe path format")
			.addText((text) =>
				text
					.setPlaceholder("e.g., embeddings/glove_part_{}.txt")
					.setValue(this.plugin.settings.glovePathFormat)
					.onChange(async (value) => {
						this.plugin.settings.glovePathFormat = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(semanticSettingsEl)
			.setName("Number of GloVe file parts")
			.addText((text) =>
				text
					.setPlaceholder("e.g., 4")
					.setValue(String(this.plugin.settings.gloveFileCount))
					.onChange(async (value) => {
						this.plugin.settings.gloveFileCount =
							parseInt(value, 10) || 0;
						await this.plugin.saveSettings();
					}),
			);
		semanticSettingsEl.createEl("h3", { text: "Mobile / Pruned Model" });
		new Setting(semanticSettingsEl)
			.setName("Pruned GloVe file path")
			.addText((text) =>
				text
					.setPlaceholder("e.g., embeddings/enhanced_pruned.txt")
					.setValue(this.plugin.settings.prunedGlovePath)
					.onChange(async (value) => {
						this.plugin.settings.prunedGlovePath = value;
						await this.plugin.saveSettings();
					}),
			);
		semanticSettingsEl.createEl("h3", {
			text: "Advanced Pruning Settings",
		});
		new Setting(semanticSettingsEl)
			.setName("Similarity threshold")
			.addText((text) =>
				text
					.setPlaceholder("e.g., 0.6")
					.setValue(String(this.plugin.settings.similarityThreshold))
					.onChange(async (value) => {
						this.plugin.settings.similarityThreshold =
							parseFloat(value) || 0;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(semanticSettingsEl)
			.setName("Max vocabulary size")
			.addText((text) =>
				text
					.setPlaceholder("e.g., 100000")
					.setValue(String(this.plugin.settings.maxVocabSize))
					.onChange(async (value) => {
						this.plugin.settings.maxVocabSize =
							parseInt(value, 10) || 100000;
						await this.plugin.saveSettings();
					}),
			);
		semanticSettingsEl.createEl("h3", { text: "Actions" });
		new Setting(semanticSettingsEl)
			.setName("Reload vector model")
			.addButton((button) =>
				button.setButtonText("Reload Now").onClick(() => {
					this.plugin.semanticSearchProvider["vectors"] = null;
					this.plugin.semanticSearchProvider.loadVectorModel();
				}),
			);
		new Setting(semanticSettingsEl)
			.setName("Re-build semantic index")
			.addButton((button) =>
				button
					.setButtonText("Re-build Now")
					.setWarning()
					.onClick(async () => {
						button.setDisabled(true);
						await this.plugin.semanticSearchProvider.buildIndex();
						this.plugin.settings.lastRebuildIndexTime = Date.now();
						await this.plugin.saveSettings();
						button.setDisabled(false);
						this.display();
					}),
			);
		new Setting(semanticSettingsEl)
			.setName("Last Re-build Semantic Index")
			.setDesc(
				this.formatTimestamp(this.plugin.settings.lastRebuildIndexTime),
			);
		new Setting(semanticSettingsEl)
			.setName("Export vault vocabulary")
			.addButton((button) =>
				button.setButtonText("Export Now").onClick(async () => {
					button.setDisabled(true);
					await exportVaultVocabulary(
						this.plugin.app,
						"embeddings/vault_vocab.txt",
					);
					this.plugin.settings.lastExportVocabularyTime = Date.now();
					await this.plugin.saveSettings();
					button.setDisabled(false);
					this.display();
				}),
			);
		new Setting(semanticSettingsEl)
			.setName("Last Export Vault Vocabulary / Pruned File Build")
			.setDesc(
				this.formatTimestamp(
					this.plugin.settings.lastExportVocabularyTime,
				),
			);
		new Setting(semanticSettingsEl)
			.setName("Build enhanced pruned file")
			.setDesc(
				"WARNING: A very slow, long-running process that freezes the app potentially for several hours. Only do this if you really, really, really want to avoid the go script that will take some minutes",
			)
			.addButton((button) =>
				button
					.setButtonText("Build Now")
					.setWarning()
					.onClick(async () => {
						await buildEnhancedPrunedVectors(
							this.plugin.app,
							this.plugin.settings,
						);
						this.plugin.settings.lastExportVocabularyTime =
							Date.now();
						await this.plugin.saveSettings();
						this.display();
					}),
			);

		// --- NEW: Visualization Settings ---
		containerEl.createEl("h2", { text: "Visualization Settings" });

		new Setting(containerEl)
			.setName("UMAP Neighbors")
			.setDesc(
				"The number of nearest neighbors for UMAP to consider (affects locality). Higher values capture more global structure.",
			)
			.addText((text) =>
				text
					.setPlaceholder("15")
					.setValue(String(this.plugin.settings.umapNNeighbors))
					.onChange(async (value) => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.umapNNeighbors = num;
							// No need to call saveSettings, it will be saved with the plugin
						}
					}),
			);

		new Setting(containerEl)
			.setName("UMAP Min Distance")
			.setDesc(
				"The minimum distance between embedded points. Lower values create tighter clusters.",
			)
			.addText((text) =>
				text
					.setPlaceholder("0.03")
					.setValue(String(this.plugin.settings.umapMinDist))
					.onChange(async (value) => {
						const num = parseFloat(value);
						if (!isNaN(num) && num >= 0) {
							this.plugin.settings.umapMinDist = num;
							// No need to call saveSettings, it will be saved with the plugin
						}
					}),
			);
	}
}
