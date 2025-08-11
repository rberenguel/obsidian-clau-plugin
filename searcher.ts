import { IndexedItem } from "./indexer";
import { WordVectorMap } from "./model";

// Re-using the same stopword list from indexer.ts
const STOPWORDS = new Set([
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
    "any", "are", "aren't", "as", "at", "be", "because", "been", "before", "being",
    "below", "between", "both", "but", "by", "can't", "cannot", "could", "couldn't",
    "did", "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during",
    "each", "few", "for", "from", "further", "had", "hadn't", "has", "hasn't",
    "have", "haven't", "having", "he", "he'd", "he'll", "he's", "her", "here",
    "here's", "hers", "herself", "him", "himself", "his", "how", "how's", "i",
    "i'd", "i'll", "i'm", "i've", "if", "in", "into", "is", "isn't", "it", "it's",
    "its", "itself", "let's", "me", "more", "most", "mustn't", "my", "myself",
    "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
    "our", "ours", "ourselves", "out", "over", "own", "same", "shan't", "she",
    "she'd", "she'll", "she's", "should", "shouldn't", "so", "some", "such",
    "than", "that", "that's", "the", "their", "theirs", "them", "themselves",
    "then", "there", "there's", "these", "they", "they'd", "they'll", "they're",
    "they've", "this", "those", "through", "to", "too", "under", "until", "up",
    "very", "was", "wasn't", "we", "we'd", "we'll", "we're", "we've", "were",
    "weren't", "what", "what's", "when", "when's", "where", "where's", "which",
    "while", "who", "who's", "whom", "why", "why's", "with", "won't", "would",
    "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
    "yourself", "yourselves"
]);


export function getDocumentVector(
	text: string,
	vectors: WordVectorMap,
): number[] | null {
	const words = (text.toLowerCase().match(/\b\w+\b/g) || []).filter(word => !STOPWORDS.has(word));
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
		normB += vecB[i] * vecB[i];
		normA += vecA[i] * vecA[i];
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

		for (const queryVec of queryVectors) {
			const sim = cosineSimilarity(chunkVec, queryVec);
			if (sim > maxSim) {
				maxSim = sim;
				bestWord = chunkWord;
			}
		}
	}
	return maxSim > 0.5 ? bestWord : undefined;
}

export const searchIndex = (
	query: string,
	index: IndexedItem[],
	vectors: WordVectorMap,
	topK = 10,
): SearchResult[] => {
	if (!index || index.length === 0 || !query) return [];

	const queryEmbedding = getDocumentVector(query, vectors);
	if (!queryEmbedding) return [];

    console.log(`Query: "${query}"`);
    console.log("Query Vector (first 5 dims):", queryEmbedding.slice(0, 5));

	const results: SearchResult[] = [];
	for (const item of index) {
		const score = cosineSimilarity(queryEmbedding, item.embedding);
		results.push({ score, ...item });
	}

	results.sort((a, b) => b.score - a.score);
	const topResults = results.slice(0, topK);

    console.log("--- Top 5 Search Results ---");
    topResults.slice(0, 5).forEach(result => {
        console.log(`File: ${result.file}, Score: ${result.score.toFixed(4)}`);
        console.log("Doc Vector (first 5 dims):", result.embedding.slice(0, 5));
    });


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