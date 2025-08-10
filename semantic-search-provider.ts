import { App, Notice, TFile } from "obsidian";
import { ISearchProvider } from "./search-provider";
import { SearchResult } from "./search";
import { WordVectorMap, EmbeddingModel } from "./model";
import { IndexedItem, buildIndex as buildSemanticIndex } from "./indexer";
import { searchIndex } from "./searcher";
import { ClauSettings } from "settings";

const INDEX_PATH = ".obsidian/plugins/clau/semantic-index.json";

export class SemanticSearchProvider implements ISearchProvider {
	private app: App;
	settings: ClauSettings;
	private vectors: WordVectorMap | null = null;
	private index: IndexedItem[] | null = null;

	constructor(app: App, settings: ClauSettings) {
		this.app = app;
		this.settings = settings;
	}

	async search(query: string, topK: number = 10): Promise<SearchResult[]> {
		if (!this.settings.enableSemanticSearch) {
			return [];
		}

		const vectors = await this.getVectors();
		const index = await this.getSearchIndex();

		if (!vectors || !index || index.length === 0) {
			new Notice(
				"Semantic model or index not ready. Build index from settings.",
				5000,
			);
			return [];
		}

		// Pass the topK parameter to searchIndex
		const semanticResults = searchIndex(query, index, vectors, topK);

		// Adapt results to the common SearchResult format
		return semanticResults.map((item) => {
			const file = this.app.vault.getAbstractFileByPath(item.file);
			return {
				title: file ? file.name.replace(/\.md$/, "") : item.file,
				path: item.file,
				context: item.text, // The chunk of text is the context
				highlightWord: item.highlightWord,
			};
		});
	}

	// --- Lazy Loaders for Model and Index ---
	async getVectors(): Promise<WordVectorMap | null> {
		if (this.vectors) return this.vectors;
		return await this.loadVectorModel();
	}

	async getSearchIndex(): Promise<IndexedItem[] | null> {
		if (this.index) return this.index;
		this.index = await this.loadSearchIndexFromFile();
		return this.index;
	}

	// --- Methods for Building/Loading Data ---
	async loadVectorModel(): Promise<WordVectorMap | null> {
		const { glovePathFormat, gloveFileCount, prunedGlovePath } =
			this.settings;
		// In Obsidian, window.innerWidth is a reasonable proxy for device type
		const isMobile = Math.min(window.innerWidth, window.innerHeight) < 768;
		let pathsToLoad: string[] = [];

		if (isMobile) {
			if (prunedGlovePath) pathsToLoad.push(prunedGlovePath);
		} else {
			if (glovePathFormat && gloveFileCount > 0) {
				for (let i = 1; i <= gloveFileCount; i++) {
					pathsToLoad.push(glovePathFormat.replace("{}", String(i)));
				}
			}
		}

		if (pathsToLoad.length > 0) {
			this.vectors = await EmbeddingModel.getInstance(
				this.app,
				pathsToLoad,
			);
			return this.vectors;
		} else {
			new Notice("Vector file path not configured for this device type.");
			return null;
		}
	}

	async loadSearchIndexFromFile(): Promise<IndexedItem[]> {
		if (!(await this.app.vault.adapter.exists(INDEX_PATH))) return [];
		try {
			const data = await this.app.vault.adapter.read(INDEX_PATH);
			return JSON.parse(data);
		} catch (e) {
			console.error("Failed to load semantic search index:", e);
			return [];
		}
	}

	async saveSearchIndexToFile() {
		if (this.index) {
			await this.app.vault.adapter.write(
				INDEX_PATH,
				JSON.stringify(this.index),
			);
		}
	}

	public async buildIndex() {
		const vectors = await this.getVectors();
		if (!vectors) {
			new Notice(
				"Vector model could not be loaded. Check settings.",
				5000,
			);
			return;
		}
		new Notice("Building semantic index...");
		this.index = await buildSemanticIndex(this.app, vectors);
		await this.saveSearchIndexToFile();
		new Notice(`Index built with ${this.index.length} items.`);
	}

	// --- ISearchProvider stubs for file events (not used by semantic search) ---
	async build() {
		/* No-op, handled by buildIndex from settings */
	}
	async add(file: TFile) {
		/* No-op */
	}
	async remove(file: TFile) {
		/* No-op */
	}
	async rename(file: TFile, oldPath: string) {
		/* No-op */
	}
	async update(file: TFile) {
		/* No-op */
	}
	getSize(): number {
		return this.index?.length || 0;
	}
}
