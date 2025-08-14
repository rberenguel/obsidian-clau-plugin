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

	const regex = new RegExp(`\b${highlightWord}\b`, "i");
	const match = text.match(regex);

	if (!match || typeof match.index === "undefined") {
		return text.length > 150 ? text.substring(0, 147) + "..." : text;
	}

	const index = match.index;
	const start = Math.max(0, index - 40);
	const end = Math.min(text.length, index + highlightWord.length + 40);

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

		// 1. Fetch a larger number of chunk candidates to ensure a good selection pool.
		const CHUNK_CANDIDATE_COUNT = 100;
		const semanticResults = searchIndex(
			query,
			index,
			vectors,
			CHUNK_CANDIDATE_COUNT,
			this.sifPrincipalComponent,
		);

		// 2. De-duplicate the results to get only the highest-scoring chunk per file.
		const topResultsByFile = new Map<string, any>();
		for (const result of semanticResults) {
			// The searchIndex results are sorted by score, so the first time we
			// encounter a file path, it's guaranteed to be the highest-scoring chunk.
			if (!topResultsByFile.has(result.file)) {
				topResultsByFile.set(result.file, result);
			}
		}

		// 3. Convert the map of unique files back to an array and slice to the desired count.
		const finalResults = Array.from(topResultsByFile.values()).slice(
			0,
			topK,
		);

		// 4. Map the final, de-duplicated results to the display format.
		return finalResults.map((item) => {
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
	// In semantic-search-provider.ts, add this new method to the SemanticSearchProvider class

	async generateVectorsFromFileContent(content: string) {
		const vectors = await this.getVectors();
		if (!vectors) {
			new Notice("Vector model not loaded. Cannot generate vectors.");
			return;
		}

		// 1. Parse headings and their content
		const newWords = new Map<string, string>();
		const headingRegex =
			/(?:^|\n)#{1,6}\s+(.+?)\n([\s\S]*?)(?=\n#{1,6}\s+|$)/g;
		let match;
		while ((match = headingRegex.exec(content)) !== null) {
			const word = match[1].trim().toLowerCase();
			const contextText = match[2].trim();
			if (word && contextText) {
				newWords.set(word, contextText);
			}
		}

		if (newWords.size === 0) {
			new Notice(
				"No words defined in the current file. Use headings for new words.",
			);
			return;
		}

		// 2. Iteratively generate vectors
		const ITERATIONS = 5;
		const newVectors = new Map<string, number[]>();
		for (let i = 0; i < ITERATIONS; i++) {
			let wordsUpdatedInPass = 0;
			for (const [word, contextText] of newWords.entries()) {
				const combinedVectors = new Map([...vectors, ...newVectors]);
				const contextWords =
					contextText.toLowerCase().match(/\b\w+\b/g) || [];
				const knownVectors = contextWords
					.map((w) => combinedVectors.get(w))
					.filter((v): v is number[] => !!v);

				if (knownVectors.length === 0) continue;

				const dimension = knownVectors[0].length;
				const sumVector = new Array(dimension).fill(0);
				for (const vec of knownVectors) {
					for (let j = 0; j < dimension; j++) {
						sumVector[j] += vec[j];
					}
				}
				const newVector = sumVector.map(
					(val) => val / knownVectors.length,
				);
				newVectors.set(word, newVector);
				wordsUpdatedInPass++;
			}
			if (wordsUpdatedInPass === 0 && i > 0) break;
		}

		if (newVectors.size === 0) {
			new Notice(
				"Could not generate any vectors. Check if context words exist in the model.",
			);
			return;
		}

		// 3. Batch save all generated vectors
		let customVectors: CustomVector[] = [];
		if (await this.app.vault.adapter.exists(CUSTOM_VECTORS_PATH)) {
			try {
				const data =
					await this.app.vault.adapter.read(CUSTOM_VECTORS_PATH);
				customVectors = JSON.parse(data);
			} catch (e) {
				console.error(
					"Failed to read custom vectors file for batch update:",
					e,
				);
			}
		}

		for (const [word, rawVector] of newVectors.entries()) {
			let finalVector = rawVector;
			if (
				this.settings.semanticIndexingStrategy === "SIF" &&
				this.sifPrincipalComponent
			) {
				let dotProduct = 0;
				for (let j = 0; j < finalVector.length; j++) {
					dotProduct +=
						finalVector[j] * this.sifPrincipalComponent[j];
				}
				const projected = this.sifPrincipalComponent.map(
					(val) => val * dotProduct,
				);
				finalVector = finalVector.map((val, j) => val - projected[j]);
			}

			const newCustomVector: CustomVector = {
				word: word,
				vector: finalVector,
				createdAt: new Date().toISOString(),
				baseModel: this.settings.glovePathFormat,
				dimension: finalVector.length,
			};

			const existingIndex = customVectors.findIndex(
				(v) => v.word === newCustomVector.word,
			);
			if (existingIndex > -1) {
				customVectors[existingIndex] = newCustomVector;
			} else {
				customVectors.push(newCustomVector);
			}
			this.vectors?.set(newCustomVector.word, newCustomVector.vector);
		}

		await this.app.vault.adapter.write(
			CUSTOM_VECTORS_PATH,
			JSON.stringify(customVectors, null, 2),
		);

		// 4. Rebuild the index ONCE at the very end
		new Notice(
			`Successfully saved ${newVectors.size} custom vectors. Re-building index...`,
		);
		await this.buildIndex();
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
		const isMobile = Math.min(window.innerWidth, window.innerHeight) < 768;
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
			const data = await this.app.vault.adapter.read(CUSTOM_VECTORS_PATH);
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

	async saveCustomVector(word: string, rawVector: number[]) {
		let finalVector = rawVector;
		if (this.settings.semanticIndexingStrategy === "SIF") {
			if (this.sifPrincipalComponent) {
				// Apply the PCA correction
				let dotProduct = 0;
				for (let j = 0; j < finalVector.length; j++) {
					dotProduct +=
						finalVector[j] * this.sifPrincipalComponent[j];
				}
				const projected = this.sifPrincipalComponent.map(
					(val) => val * dotProduct,
				);
				finalVector = finalVector.map((val, j) => val - projected[j]);
			}
		}

		let customVectors: CustomVector[] = [];
		if (await this.app.vault.adapter.exists(CUSTOM_VECTORS_PATH)) {
			try {
				const data =
					await this.app.vault.adapter.read(CUSTOM_VECTORS_PATH);
				customVectors = JSON.parse(data);
			} catch (e) {
				console.error("Failed to read custom vectors file:", e);
			}
		}

		const newCustomVector: CustomVector = {
			word: word.toLowerCase(),
			vector: finalVector,
			createdAt: new Date().toISOString(),
			baseModel: this.settings.glovePathFormat,
			dimension: finalVector.length,
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
		new Notice(
			`Custom vector for "${word}" has been saved. Re-building index...`,
		);
		await this.buildIndex();
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
		const foldersToIgnore = this.settings.ignoredFolders
			.split(",")
			.filter((f) => f.trim());

		const { index, principalComponent } = await buildSemanticIndex(
			this.app,
			vectors,
			this.settings.semanticIndexingStrategy,
			foldersToIgnore, // <-- Pass the folders to the indexer
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
