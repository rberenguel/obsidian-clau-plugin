// main.ts
import { Plugin, TFile, Notice, normalizePath, Editor } from "obsidian";
import { SearchResult } from "./search/search";
import { MiniSearchProvider } from "./search/providers/minisearch-provider";
import { TitleContainsSearchProvider } from "./search/providers/title-contains-search-provider";
import { CombinedSearchProvider } from "./search/providers/combined-search-provider";
import { MultiSelectModal } from "./ui/multi-select-modal";
import { SemanticSearchProvider } from "./search/providers/semantic-search-provider";
import { getDocumentVector } from "./search/searcher";
import { ClauSettings, DEFAULT_SETTINGS, ClauSettingTab } from "./settings";
import {
	VAULT_VIZ_VIEW_TYPE,
	VaultVizView,
} from "./ui/vault-viz/vault-viz-view";

import { RecentFilesSearchProvider } from "./search/providers/recent-files-provider";

import { HeadingFilterManager } from "./ui/heading-filter";

import { registerCommands } from "./commands";
import { registerEvents } from "./events";
import { WordVectorMap } from "semantic/model";

export default class ClauPlugin extends Plugin {
	miniSearchProvider: MiniSearchProvider;
	titleContainsSearchProvider: TitleContainsSearchProvider;
	semanticSearchProvider: SemanticSearchProvider;
	combinedSearchProvider: CombinedSearchProvider;
	recentFilesSearchProvider: RecentFilesSearchProvider; // Added property
	headingFilterManager: HeadingFilterManager;
	settings: ClauSettings;
	reindexIntervalId: number | null = null;
	selectionMap: Map<string, SearchResult> = new Map();
	public lastMultiSelectQuery: string = "";
	public getDocumentVector: any;

	async onload() {
		this.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
		await this.loadSettings();

		this.headingFilterManager = new HeadingFilterManager(this.app);

		this.registerEditorExtension(HeadingFilterManager.pluginSpec);

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
		this.recentFilesSearchProvider = new RecentFilesSearchProvider(
			this.app,
		); // Instantiated

		await this.miniSearchProvider.build();
		this.setupReindexInterval();

		this.registerView(
			VAULT_VIZ_VIEW_TYPE,
			(leaf) => new VaultVizView(leaf, this),
		);

		registerCommands(this);
		registerEvents(this);

		this.addSettingTab(new ClauSettingTab(this.app, this));

		if (this.settings.loadVectorsOnStart) {
			this.app.workspace.onLayoutReady(() => {
				this.semanticSearchProvider.getVectors();
			});
		}

		this.getDocumentVector = (() => {
			return async (text: string) => {
				if (!this.semanticSearchProvider.vectorsLoaded())
					await this.semanticSearchProvider.getVectors();
				if (!this.semanticSearchProvider.vectorsLoaded()) {
					new Notice("Vectors not loaded!");
					return false;
				}
				return getDocumentVector(
					text,
					this.semanticSearchProvider.vectors as WordVectorMap,
				);
			};
		})();
	}

	onLayoutReady(): void {}

	async ensureVizData(): Promise<boolean> {
		const dirPath = `clau-viz`;
		const dataPath = `${dirPath}/visualization-data.json`;
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

		if (!(await this.app.vault.adapter.exists(normalizePath(dirPath)))) {
			await this.app.vault.adapter.mkdir(normalizePath(dirPath));
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
