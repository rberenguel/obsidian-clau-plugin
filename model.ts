// src/model.ts
import { App, TFile, Notice, normalizePath } from "obsidian";

export enum SemanticIndexingStrategy {
    Average = "Average",
    TFIDF = "TF-IDF",
    SIF = "SIF",
}

export type WordVectorMap = Map<string, number[]>;

export interface CustomVector {
    word: string;
    vector: number[];
    createdAt: string; // ISO 8601 timestamp
    baseModel: string; // The path format of the GloVe model used
    dimension: number;
}

export class EmbeddingModel {
	private static instance: WordVectorMap | null = null;

	// Updated signature to accept the new settings
	public static async getInstance(
		app: App,
		filePaths: string[],
	): Promise<WordVectorMap> {
		// We pass true to force a reload, ensuring we load the correct set
		this.instance = await this.loadAndParseVectors(app, filePaths);
		return this.instance;
	}

	private static async loadAndParseVectors(
		app: App,
		filePaths: string[],
	): Promise<WordVectorMap> {
		if (!filePaths || filePaths.length === 0) {
			// This notice is a good catch-all
			new Notice("No vector file paths provided to load.");
			return new Map();
		}

		const vectors: WordVectorMap = new Map();
		new Notice(`Loading ${filePaths.length} word vector file(s)...`);

		for (const path of filePaths) {
			const normalizedPath = normalizePath(path.trim());
			if (!normalizedPath) continue;

			const file = app.vault.getAbstractFileByPath(normalizedPath);

			if (file instanceof TFile) {
				const content = await app.vault.read(file);
				const lines = content.split("\n");
				for (const line of lines) {
					const parts = line.split(" ");
					const word = parts[0];
					if (!word || parts.length <= 2) continue;
					vectors.set(word, parts.slice(1).map(Number));
				}
			} else {
				new Notice(`Could not find vector file: ${path}`, 4000);
			}
		}

		if (vectors.size > 0) {
			new Notice(`Successfully parsed ${vectors.size} word vectors.`);
		}
		return vectors;
	}
}


