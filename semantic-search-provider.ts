import { App, Notice, TFile, normalizePath } from "obsidian";
import { ISearchProvider } from "./search-provider";
import { SearchResult } from "./search";
import { WordVectorMap, EmbeddingModel, CustomVector } from "./model";
import { IndexedItem, buildIndex as buildSemanticIndex } from "./indexer";
import { searchIndex } from "./searcher";
import { ClauSettings } from "settings";

const INDEX_PATH = ".obsidian/plugins/clau/semantic-index.json";
const CUSTOM_VECTORS_PATH = ".obsidian/plugins/clau/custom-vectors.json";
const PCA_PATH = ".obsidian/plugins/clau/semantic-index-pca.json";

function createContextSnippet(
	text: string,
	highlightWord: string | undefined,
): string {
	if (!highlightWord) {
		return text.length > 150 ? text.substring(0, 147) + "..." : text;
	}

	const index = text.toLowerCase().indexOf(highlightWord.toLowerCase());
	if (index === -1) {
		return text.length > 150 ? text.substring(0, 147) + "..." : text;
	}

	const start = Math.max(0, index - 50);
	const end = Math.min(text.length, index + highlightWord.length + 50);

	let snippet = text.substring(start, end);
	if (start > 0) snippet = "..." + snippet;
	if (end < text.length) snippet = snippet + "...";

	return snippet;
}

export class SemanticSearchProvider implements ISearchProvider {
	private app: App;
	settings: ClauSettings;
	private vectors: WordVectorMap | null = null;
	private index: IndexedItem[] | null = null;
	private sifPrincipalComponent: number[] | null = null;

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

		const semanticResults = searchIndex(
			query,
			index,
			vectors,
			topK,
			this.sifPrincipalComponent,
		);

		return semanticResults.map((item) => {
			const file = this.app.vault.getAbstractFileByPath(item.file);
			return {
				title: file ? file.name.replace(/\.md$/, "") : item.file,
				path: item.file,
				context: createContextSnippet(item.text, item.highlightWord),
				highlightWord: item.highlightWord,
			};
		});
	}

	async getVectors(): Promise<WordVectorMap | null> {
		if (this.vectors) return this.vectors;
		return await this.loadVectorModel();
	}

	async getSearchIndex(): Promise<IndexedItem[] | null> {
		if (this.index) return this.index;
		this.index = await this.loadSearchIndexFromFile();
		if (this.settings.semanticIndexingStrategy === "SIF") {
			this.sifPrincipalComponent = await this.loadPcaFromFile();
		}
		return this.index;
	}

	async loadVectorModel(): Promise<WordVectorMap | null> {
		const { glovePathFormat, gloveFileCount, prunedGlovePath } =
			this.settings;
		const isMobile =
			Math.min(window.innerWidth, window.innerHeight) < 768;
		let pathsToLoad: string[] = [];
		let modelIdentifier = "";

		if (isMobile) {
			if (prunedGlovePath) {
				pathsToLoad.push(prunedGlovePath);
				modelIdentifier = prunedGlovePath;
			}
		} else {
			if (glovePathFormat && gloveFileCount > 0) {
				for (let i = 1; i <= gloveFileCount; i++) {
					pathsToLoad.push(glovePathFormat.replace("{}", String(i)));
				}
				modelIdentifier = glovePathFormat;
			}
		}

		if (pathsToLoad.length > 0) {
			this.vectors = await EmbeddingModel.getInstance(
				this.app,
				pathsToLoad,
			);
			await this.loadCustomVectors(modelIdentifier);
			return this.vectors;
		} else {
			new Notice("Vector file path not configured for this device type.");
			return null;
		}
	}

	async loadCustomVectors(baseModelIdentifier: string) {
		if (
			!this.vectors ||
			!(await this.app.vault.adapter.exists(CUSTOM_VECTORS_PATH))
		) {
			return;
		}

		try {
			const data = await this.app.vault.adapter.read(
				CUSTOM_VECTORS_PATH,
			);
			const customVectors: CustomVector[] = JSON.parse(data);
			const firstVector = this.vectors.values().next().value;
			if (!firstVector) return;
			const dimension = firstVector.length;

			for (const customVector of customVectors) {
				if (
					customVector.baseModel === baseModelIdentifier &&
					customVector.dimension === dimension
				) {
					this.vectors.set(customVector.word, customVector.vector);
				} else {
					new Notice(
						`Skipping custom vector for "${customVector.word}" due to model/dimension mismatch.`,
					);
					console.warn("Custom vector mismatch:", {
						word: customVector.word,
						expectedModel: baseModelIdentifier,
						actualModel: customVector.baseModel,
						expectedDim: dimension,
						actualDim: customVector.dimension,
					});
				}
			}
		} catch (e) {
			console.error("Failed to load custom vectors:", e);
		}
	}

	async saveCustomVector(word: string, vector: number[]) {
		let customVectors: CustomVector[] = [];
		if (await this.app.vault.adapter.exists(CUSTOM_VECTORS_PATH)) {
			try {
				const data = await this.app.vault.adapter.read(
					CUSTOM_VECTORS_PATH,
				);
				customVectors = JSON.parse(data);
			} catch (e) {
				console.error("Failed to read custom vectors file:", e);
			}
		}

		const newCustomVector: CustomVector = {
			word: word.toLowerCase(),
			vector: vector,
			createdAt: new Date().toISOString(),
			baseModel: this.settings.glovePathFormat,
			dimension: vector.length,
		};

		const existingIndex = customVectors.findIndex(
			(v) => v.word === newCustomVector.word,
		);
		if (existingIndex > -1) {
			customVectors[existingIndex] = newCustomVector;
		} else {
			customVectors.push(newCustomVector);
		}

		await this.app.vault.adapter.write(
			CUSTOM_VECTORS_PATH,
			JSON.stringify(customVectors, null, 2),
		);
		this.vectors?.set(newCustomVector.word, newCustomVector.vector);
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

	async loadPcaFromFile(): Promise<number[] | null> {
		if (!(await this.app.vault.adapter.exists(PCA_PATH))) return null;
		try {
			const data = await this.app.vault.adapter.read(PCA_PATH);
			return JSON.parse(data);
		} catch (e) {
			console.error("Failed to load PCA component:", e);
			return null;
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

	async savePcaToFile() {
		if (this.sifPrincipalComponent) {
			await this.app.vault.adapter.write(
				PCA_PATH,
				JSON.stringify(this.sifPrincipalComponent),
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
		new Notice(
			`Building semantic index using ${this.settings.semanticIndexingStrategy} strategy...`,
		);
		const { index, principalComponent } = await buildSemanticIndex(
			this.app,
			vectors,
			this.settings.semanticIndexingStrategy,
		);
		this.index = index;
		this.sifPrincipalComponent = principalComponent;

		await this.saveSearchIndexToFile();
		if (this.settings.semanticIndexingStrategy === "SIF") {
			await this.savePcaToFile();
		}
		new Notice(`Index built with ${this.index.length} items.`);
	}

	async build() {}
	async add(file: TFile) {}
	async remove(file: TFile) {}
	async rename(file: TFile, oldPath: string) {}
	async update(file: TFile) {}
	getSize(): number {
		return this.index?.length || 0;
	}
}
