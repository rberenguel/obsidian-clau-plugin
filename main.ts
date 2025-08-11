// main.ts
import { Plugin, TFile, Notice, normalizePath } from "obsidian";
import { SearchResult } from "./search";
import { MiniSearchProvider } from "./minisearch-provider";
import { TitleContainsSearchProvider } from "./title-contains-search-provider";
import { CombinedSearchProvider } from "./combined-search-provider";
import { MultiSelectModal } from "./multi-select-modal";
import { SemanticSearchProvider } from "./semantic-search-provider";
import { getDocumentVector } from "./searcher";
import { ClauSettings, DEFAULT_SETTINGS, ClauSettingTab } from "./settings";
import { VAULT_VIZ_VIEW_TYPE, VaultVizView } from "./vault-viz-view";
import { ClauModal } from "./search-modal";

export default class ClauPlugin extends Plugin {
	miniSearchProvider: MiniSearchProvider;
	titleContainsSearchProvider: TitleContainsSearchProvider;
	semanticSearchProvider: SemanticSearchProvider;
	combinedSearchProvider: CombinedSearchProvider;
	settings: ClauSettings;
	reindexIntervalId: number | null = null;
	selectionMap: Map<string, SearchResult> = new Map();
	public lastMultiSelectQuery: string = "";

	async onload() {
		this.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
		await this.loadSettings();

		this.miniSearchProvider = new MiniSearchProvider(
			this.app,
			this.settings,
		);
		this.titleContainsSearchProvider = new TitleContainsSearchProvider(
			this.app,
		);
		this.semanticSearchProvider = new SemanticSearchProvider(
			this.app,
			this.settings,
		);
		this.combinedSearchProvider = new CombinedSearchProvider(
			this.miniSearchProvider,
			this.titleContainsSearchProvider,
			this.semanticSearchProvider,
		);

		await this.miniSearchProvider.build();
		this.setupReindexInterval();

		this.registerView(
			VAULT_VIZ_VIEW_TYPE,
			(leaf) => new VaultVizView(leaf, this),
		);

		this.addCommand({
			id: "open-clau-minisearch",
			name: "Open Search",
			callback: () => {
				new ClauModal(
					this.app,
					this.combinedSearchProvider,
					this,
					"search? also: , for semantic, ? for private, ! to ignore privacy, space for title, . for fuzzy, -term, -/path",
					this.settings,
				).open();
			},
		});

		this.addCommand({
			id: "rebuild-clau-index",
			name: "Re-build index",
			callback: async () => {
				await this.combinedSearchProvider.build();
				this.settings.lastRebuildIndexTime = Date.now();
				await this.saveSettings();
				new Notice("MiniSearch index has been manually rebuilt.");
			},
		});

		this.addCommand({
			id: "open-clau-multi-select",
			name: "Select files to copy content",
			callback: () => {
				new MultiSelectModal(
					this.app,
					this,
					this.combinedSearchProvider,
					this.selectionMap,
				).open();
			},
		});

		this.addCommand({
			id: "open-clau-vault-viz",
			name: "Open Vault Visualization",
			callback: async () => {
				this.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
				const newLeaf = this.app.workspace.getLeaf("tab");
				await newLeaf.setViewState({
					type: VAULT_VIZ_VIEW_TYPE,
					active: true,
				});
				this.app.workspace.revealLeaf(newLeaf);
			},
		});

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile)
					this.combinedSearchProvider.add(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile)
					this.combinedSearchProvider.remove(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile)
					this.combinedSearchProvider.update(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile)
					this.combinedSearchProvider.rename(file, oldPath);
			}),
		);

		this.addSettingTab(new ClauSettingTab(this.app, this));
	}

	async ensureVizData(): Promise<boolean> {
		const dataPath = `clau-viz/visualization-data.json`;
		if (await this.app.vault.adapter.exists(normalizePath(dataPath)))
			return true;

		new Notice("Generating new visualization data...");
		const vectors = await this.semanticSearchProvider.getVectors();
		if (!vectors) {
			new Notice("Vectors not loaded!");
			return false;
		}

		const files = this.app.vault.getMarkdownFiles();
		const exportData = [];
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			const embedding = getDocumentVector(content, vectors);
			if (embedding)
				exportData.push({
					path: file.path,
					title: file.basename,
					embedding,
				});
		}
		await this.app.vault.adapter.write(
			normalizePath(dataPath),
			JSON.stringify(exportData),
		);
		new Notice(`Data for ${exportData.length} notes exported.`);
		return true;
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
		if (this.reindexIntervalId !== null)
			window.clearInterval(this.reindexIntervalId);
	}

	setupReindexInterval() {
		if (this.reindexIntervalId !== null)
			window.clearInterval(this.reindexIntervalId);
		if (this.settings.reindexInterval > 0) {
			this.reindexIntervalId = window.setInterval(
				async () => {
					console.log(`Clau: Performing periodic re-index.`);
					await this.miniSearchProvider.build();
				},
				this.settings.reindexInterval * 60 * 1000,
			);
			this.registerInterval(this.reindexIntervalId);
		}
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}
	async saveSettings() {
		await this.saveData(this.settings);
		await this.miniSearchProvider.build();
		this.setupReindexInterval();
	}
}
