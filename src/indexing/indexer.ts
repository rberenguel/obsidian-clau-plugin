// src/indexer.ts
import { App } from "obsidian";
import { WordVectorMap, SemanticIndexingStrategy } from "../model";
import { PCA } from "ml-pca";

// A common list of English stopwords
const STOPWORDS = new Set([
	"a",
	"about",
	"above",
	"after",
	"again",
	"against",
	"all",
	"am",
	"an",
	"and",
	"any",
	"are",
	"aren't",
	"as",
	"at",
	"be",
	"because",
	"been",
	"before",
	"being",
	"below",
	"between",
	"both",
	"but",
	"by",
	"can't",
	"cannot",
	"could",
	"couldn't",
	"did",
	"didn't",
	"do",
	"does",
	"doesn't",
	"doing",
	"don't",
	"down",
	"during",
	"each",
	"few",
	"for",
	"from",
	"further",
	"had",
	"hadn't",
	"has",
	"hasn't",
	"have",
	"haven't",
	"having",
	"he",
	"he'd",
	"he'll",
	"he's",
	"her",
	"here",
	"here's",
	"hers",
	"herself",
	"him",
	"himself",
	"his",
	"how",
	"how's",
	"i",
	"i'd",
	"i'll",
	"i'm",
	"i've",
	"if",
	"in",
	"into",
	"is",
	"isn't",
	"it",
	"it's",
	"its",
	"itself",
	"let's",
	"me",
	"more",
	"most",
	"mustn't",
	"my",
	"myself",
	"no",
	"nor",
	"not",
	"of",
	"off",
	"on",
	"once",
	"only",
	"or",
	"other",
	"ought",
	"our",
	"ours",
	"ourselves",
	"out",
	"over",
	"own",
	"same",
	"shan't",
	"she",
	"she'd",
	"she'll",
	"she's",
	"should",
	"shouldn't",
	"so",
	"some",
	"such",
	"than",
	"that",
	"that's",
	"the",
	"their",
	"theirs",
	"them",
	"themselves",
	"then",
	"there",
	"there's",
	"these",
	"they",
	"they'd",
	"they'll",
	"they're",
	"they've",
	"this",
	"those",
	"through",
	"to",
	"too",
	"under",
	"until",
	"up",
	"very",
	"was",
	"wasn't",
	"we",
	"we'd",
	"we'll",
	"we're",
	"we've",
	"were",
	"weren't",
	"what",
	"what's",
	"when",
	"when's",
	"where",
	"where's",
	"which",
	"while",
	"who",
	"who's",
	"whom",
	"why",
	"why's",
	"with",
	"won't",
	"would",
	"wouldn't",
	"you",
	"you'd",
	"you'll",
	"you're",
	"you've",
	"your",
	"yours",
	"yourself",
	"yourselves",
]);

// --- Vector Calculation ---

function getAverageVector(
	words: string[],
	vectors: WordVectorMap,
): number[] | null {
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

function getTfIdfVector(
	words: string[],
	vectors: WordVectorMap,
	tfIdfScores: Map<string, number>,
): number[] | null {
	const knownVectors = words
		.map((word) => ({ word, vec: vectors.get(word) }))
		.filter((item) => item.vec) as { word: string; vec: number[] }[];

	if (knownVectors.length === 0) return null;

	const dimension = knownVectors[0].vec.length;
	const sumVector = new Array(dimension).fill(0);
	let totalWeight = 0;

	for (const { word, vec } of knownVectors) {
		const tfIdf = tfIdfScores.get(word) || 0;
		for (let i = 0; i < dimension; i++) {
			sumVector[i] += vec[i] * tfIdf;
		}
		totalWeight += tfIdf;
	}

	if (totalWeight === 0) return null;
	return sumVector.map((val) => val / totalWeight);
}

function getSifVector(
	words: string[],
	vectors: WordVectorMap,
	wordProbs: Map<string, number>,
	smoothing: number,
): number[] | null {
	const knownVectors = words
		.map((word) => ({ word, vec: vectors.get(word) }))
		.filter((item) => item.vec) as { word: string; vec: number[] }[];

	if (knownVectors.length === 0) return null;

	const dimension = knownVectors[0].vec.length;
	const sumVector = new Array(dimension).fill(0);
	let totalWeight = 0;

	for (const { word, vec } of knownVectors) {
		const prob = wordProbs.get(word) || 0;
		const weight = smoothing / (smoothing + prob);
		for (let i = 0; i < dimension; i++) {
			sumVector[i] += vec[i] * weight;
		}
		totalWeight += weight;
	}

	if (totalWeight === 0) return null;
	return sumVector.map((val) => val / totalWeight);
}

// --- Chunking ---

const chunkText = (text: string): string[] =>
	text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);

// --- Indexing ---

export interface IndexedItem {
	file: string;
	text: string;
	embedding: number[];
}

export const buildIndex = async (
	app: App,
	vectors: WordVectorMap,
	strategy: SemanticIndexingStrategy,
	foldersToIgnore: string[],
): Promise<{ index: IndexedItem[]; principalComponent: number[] | null }> => {
	const index: IndexedItem[] = [];
	const allFiles = app.vault.getMarkdownFiles();
	const files = allFiles.filter(
		(file) =>
			!foldersToIgnore.some(
				(folder) =>
					folder.trim() !== "" && file.path.startsWith(folder.trim()),
			),
	);
	const documents: { file: string; content: string; words: string[] }[] = [];

	// First pass: collect all documents and words
	for (const file of files) {
		const content = await app.vault.cachedRead(file);
		const words = (content.toLowerCase().match(/\b\w+\b/g) || []).filter(
			(word) => !STOPWORDS.has(word),
		);
		documents.push({ file: file.path, content, words });
	}

	// --- Pre-calculation for strategies ---
	const idf = new Map<string, number>();
	const wordProbs = new Map<string, number>();
	let totalWords = 0;

	if (strategy === SemanticIndexingStrategy.TFIDF) {
		const docCount = documents.length;
		const docFreq = new Map<string, number>();
		for (const doc of documents) {
			const uniqueWords = new Set(doc.words);
			for (const word of uniqueWords) {
				docFreq.set(word, (docFreq.get(word) || 0) + 1);
			}
		}
		for (const [word, freq] of docFreq.entries()) {
			idf.set(word, Math.log(docCount / freq));
		}
	} else if (strategy === SemanticIndexingStrategy.SIF) {
		const wordCounts = new Map<string, number>();
		for (const doc of documents) {
			for (const word of doc.words) {
				wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
				totalWords++;
			}
		}
		for (const [word, count] of wordCounts.entries()) {
			wordProbs.set(word, count / totalWords);
		}
	}

	// Second pass: build the index based on the selected strategy
	const chunkEmbeddings: number[][] = [];
	const chunkInfos: { file: string; text: string }[] = [];

	for (const doc of documents) {
		const chunks = chunkText(doc.content);
		for (const chunk of chunks) {
			const chunkWords = (
				chunk.toLowerCase().match(/\b\w+\b/g) || []
			).filter((word) => !STOPWORDS.has(word));
			let embedding: number[] | null = null;

			switch (strategy) {
				case SemanticIndexingStrategy.Average:
					embedding = getAverageVector(chunkWords, vectors);
					break;
				case SemanticIndexingStrategy.TFIDF:
					const tf = new Map<string, number>();
					for (const word of chunkWords) {
						tf.set(word, (tf.get(word) || 0) + 1);
					}
					const tfIdfScores = new Map<string, number>();
					for (const [word, count] of tf.entries()) {
						tfIdfScores.set(
							word,
							(count / chunkWords.length) * (idf.get(word) || 0),
						);
					}
					embedding = getTfIdfVector(
						chunkWords,
						vectors,
						tfIdfScores,
					);
					break;
				case SemanticIndexingStrategy.SIF:
					embedding = getSifVector(
						chunkWords,
						vectors,
						wordProbs,
						1e-3,
					);
					break;
			}

			if (embedding) {
				chunkEmbeddings.push(embedding);
				chunkInfos.push({ file: doc.file, text: chunk });
			}
		}
	}

	// --- Post-processing for SIF ---
	let principalComponent: number[] | null = null;
	if (
		strategy === SemanticIndexingStrategy.SIF &&
		chunkEmbeddings.length > 0
	) {
		const pca = new PCA(chunkEmbeddings);
		principalComponent = pca.getEigenvectors().getColumn(0);

		for (let i = 0; i < chunkEmbeddings.length; i++) {
			const embedding = chunkEmbeddings[i];
			let dotProduct = 0;
			for (let j = 0; j < embedding.length; j++) {
				dotProduct += embedding[j] * principalComponent[j];
			}
			const projected = principalComponent.map((val) => val * dotProduct);
			chunkEmbeddings[i] = embedding.map((val, j) => val - projected[j]);
		}
	}

	// Final pass: create the index
	for (let i = 0; i < chunkEmbeddings.length; i++) {
		index.push({
			file: chunkInfos[i].file,
			text: chunkInfos[i].text,
			embedding: chunkEmbeddings[i],
		});
	}

	return { index, principalComponent };
};
