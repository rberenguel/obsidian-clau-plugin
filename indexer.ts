// src/indexer.ts
import { App } from "obsidian";
import { EmbeddingModel, getDocumentVector } from "./model";
import { WordVectorMap } from "./model";

// Chunking strategy: split by paragraphs
const chunkText = (text: string): string[] =>
	text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

export interface IndexedItem {
	file: string;
	text: string;
	embedding: number[];
}

export const buildIndex = async (
	app: App,
	vectors: WordVectorMap,
): Promise<IndexedItem[]> => {
	const index: IndexedItem[] = [];
	const files = app.vault.getMarkdownFiles();

	for (const file of files) {
		const content = await app.vault.cachedRead(file);
		const chunks = chunkText(content);
		for (const chunk of chunks) {
			// No need to load the model here, just use the vectors
			const embedding = getDocumentVector(chunk, vectors);
			if (embedding) {
				index.push({
					file: file.path,
					text: chunk,
					embedding: embedding,
				});
			}
		}
	}
	return index;
};
