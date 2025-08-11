import { IndexedItem } from "./indexer";
import { WordVectorMap } from "./model";

export function getDocumentVector(
	text: string,
	vectors: WordVectorMap,
): number[] | null {
	const words = text.toLowerCase().match(/\b\w+\b/g) || [];
	const knownVectors = words
		.map((word) => vectors.get(word))
		.filter((v) => v) as number[][];

	if (knownVectors.length === 0) return null;

	const dimension = knownVectors[0].length;
	const sumVector = new Array(dimension).fill(0);

	for (const vec of knownVectors) {
		for (let i = 0; i < dimension; i++) {
			sumVector[i] += vec[i];
		}
	}

	return sumVector.map((val) => val / knownVectors.length);
}

// Add 'highlightWord' to the SearchResult type
export type SearchResult = IndexedItem & {
	score: number;
	highlightWord?: string;
};

function cosineSimilarity(vecA: number[], vecB: number[]): number {
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;
	for (let i = 0; i < vecA.length; i++) {
		dotProduct += vecA[i] * vecB[i];
		normA += vecA[i] * vecA[i];
		normB += vecB[i] * vecB[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
function findBestMatchingWord(
	chunkText: string,
	queryWords: string[],
	vectors: WordVectorMap,
): string | undefined {
	const chunkWords = chunkText.toLowerCase().match(/\b\w+\b/g) || [];
	if (chunkWords.length === 0) return undefined;

	const queryVectors = queryWords
		.map((word) => vectors.get(word))
		.filter((v) => v) as number[][];
	if (queryVectors.length === 0) return undefined;

	let bestWord = "";
	let maxSim = -1;

	for (const chunkWord of chunkWords) {
		const chunkVec = vectors.get(chunkWord);
		if (!chunkVec) continue;

		// Find the highest similarity of this chunk word to any of the query words
		for (const queryVec of queryVectors) {
			const sim = cosineSimilarity(chunkVec, queryVec);
			if (sim > maxSim) {
				maxSim = sim;
				bestWord = chunkWord;
			}
		}
	}
	// Only return a match if it's reasonably similar
	return maxSim > 0.5 ? bestWord : undefined;
}

// The function is no longer async and now requires the 'vectors' map
export const searchIndex = (
	query: string,
	index: IndexedItem[],
	vectors: WordVectorMap,
	topK = 10,
): SearchResult[] => {
	if (!index || index.length === 0 || !query) return [];

	const queryEmbedding = getDocumentVector(query, vectors);
	if (!queryEmbedding) return [];

	const results: SearchResult[] = [];
	for (const item of index) {
		const score = cosineSimilarity(queryEmbedding, item.embedding);
		results.push({ score, ...item });
	}

	results.sort((a, b) => b.score - a.score);
	const topResults = results.slice(0, topK);

	// --- NEW LOGIC ---
	// Now, find the best highlight word for each of the top results
	const queryWords = query.toLowerCase().match(/\b\w+\b/g) || [];
	for (const result of topResults) {
		result.highlightWord = findBestMatchingWord(
			result.text,
			queryWords,
			vectors,
		);
	}

	return topResults;
};
