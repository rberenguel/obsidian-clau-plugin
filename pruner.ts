import { App, Notice, TFile, normalizePath } from "obsidian";

// The settings interface the function expects
export interface MyPluginSettings {
	glovePathFormat: string;
	gloveFileCount: number;
	prunedGlovePath: string;
	similarityThreshold: number;
	maxVocabSize: number;
}

// Checkpoint data structure
interface PruningCheckpoint {
	processedVaultWords: string[];
	finalVocab: string[]; // This will now store all candidates before the final prune
}

const TOP_L_NEIGHBORS = 5;
const CHECKPOINT_INTERVAL = 1000; // This is to balance convenience and performance, since writing each checkpoint takes a while.
const CHECKPOINT_PATH = "pruning_checkpoint.json";

function cosineSimilarity(vecA: number[], vecB: number[]): number {
	let dotProduct = 0,
		normA = 0,
		normB = 0;
	for (let i = 0; i < vecA.length; i++) {
		dotProduct += vecA[i] * vecB[i];
		normA += vecA[i] * vecA[i];
		normB += vecB[i] * vecB[i];
	}
	if (normA === 0 || normB === 0) return 0;
	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Fisher-Yates shuffle for random pruning
function shuffleArray(array: any[]) {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[array[i], array[j]] = [array[j], array[i]];
	}
}

export async function buildEnhancedPrunedVectors(
	app: App,
	settings: MyPluginSettings,
) {
	const notice = new Notice("Starting enhanced vector file process...", 0);
	if (!settings || !settings.glovePathFormat || !settings.prunedGlovePath) {
		new Notice(
			"Semantic Search settings are not ready yet. Please try again in a moment.",
			5000,
		);
		console.error(
			"buildEnhancedPrunedVectors was called before settings were fully loaded.",
		);
		return; // Exit gracefully instead of crashing
	}
	const outputPath = normalizePath(settings.prunedGlovePath);

	let processedVaultWords = new Set<string>();
	let wordsWrittenToFile = new Set<string>();
	let finalVocab = new Set<string>();

	// --- Step 1: Load from Checkpoint if it exists ---
	if (await app.vault.adapter.exists(CHECKPOINT_PATH)) {
		try {
			const checkpointData: PruningCheckpoint = JSON.parse(
				await app.vault.adapter.read(CHECKPOINT_PATH),
			);
			processedVaultWords = new Set(checkpointData.processedVaultWords);
			// FIX 1: Correctly load finalVocab from the checkpoint
			finalVocab = new Set(checkpointData.finalVocab);

			// Re-populate wordsWrittenToFile by reading the existing output file once
			const existingOutputFile = 
				app.vault.getAbstractFileByPath(outputPath);
			if (existingOutputFile instanceof TFile) {
				const prunedContent = await app.vault.read(existingOutputFile);
				prunedContent
					.split("\n")
					.forEach((line) =>
						wordsWrittenToFile.add(line.split(" ")[0]),
					);
			}
			notice.setMessage(
				`Resuming from checkpoint. ${processedVaultWords.size} words processed.`, 
			);
			await new Promise((resolve) => setTimeout(resolve, 1000));
		} catch (e) {
			console.error("Could not read checkpoint file, starting fresh.", e);
		}
	}

	// --- Step 2: Get Vault Vocabulary & Determine Words to Process ---
	notice.setMessage("Step 1/5: Scanning vault for all unique words...");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const vaultVocab = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const content = await app.vault.cachedRead(file);
		const words = content.toLowerCase().match(/\b\w+\b/g) || [];
		words.forEach((word) => vaultVocab.add(word));
	}

	const wordsToProcess = [...vaultVocab].filter(
		(word) => !processedVaultWords.has(word),
	);
	if (wordsToProcess.length === 0) {
		notice.setMessage(
			"Vector file is already up-to-date with vault words!",
		);
		setTimeout(() => notice.hide(), 5000);
		return;
	}

	// --- Step 3: Load Full GloVe Model ---
	notice.setMessage("Step 2/5: Loading full GloVe model...");
	await new Promise((resolve) => setTimeout(resolve, 0));
	const fullGloveMap = new Map<string, number[]>();
	for (let i = 1; i <= settings.gloveFileCount; i++) {
		const path = settings.glovePathFormat.replace("{}", String(i));
		const file = app.vault.getAbstractFileByPath(
			normalizePath(path.trim()),
		);
		if (file instanceof TFile) {
			const content = await app.vault.read(file);
			for (const line of content.split("\n")) {
				const parts = line.split(" ");
				if (parts.length > 2)
					fullGloveMap.set(parts[0], parts.slice(1).map(Number));
			}
		}
	}
	if (fullGloveMap.size === 0) {
		notice.setMessage("Failed to load full GloVe model. Check settings.");
		setTimeout(() => notice.hide(), 5000);
		return;
	}

	// --- Step 4: Find Neighbors (Resumable) ---
	notice.setMessage(
		`Step 3/5: Finding neighbors for ${wordsToProcess.length} new words...`,
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	const allGloveWords = Array.from(fullGloveMap.keys());

	for (let i = 0; i < wordsToProcess.length; i++) {
		const word = wordsToProcess[i];
		finalVocab.add(word);
		const wordVec = fullGloveMap.get(word);
		if (wordVec) {
			const similarities: { word: string; score: number }[] = [];
			for (const gloveWord of allGloveWords) {
				const gloveVec = fullGloveMap.get(gloveWord)!;
				similarities.push({
					word: gloveWord,
					score: cosineSimilarity(wordVec, gloveVec),
				});
			}
			similarities.sort((a, b) => b.score - a.score);
			for (
				let j = 1;
				j < TOP_L_NEIGHBORS + 1 && j < similarities.length;
				j++
			) {
				if (similarities[j].score > settings.similarityThreshold) {
					finalVocab.add(similarities[j].word);
				}
			}
		}
		processedVaultWords.add(word);

		if (
			(i + 1) % CHECKPOINT_INTERVAL === 0 ||
			 i + 1 === wordsToProcess.length
		) {
			notice.setMessage(
				`Progress... ${i + 1}/${wordsToProcess.length}. Saving checkpoint.`, 
			);
			await new Promise((resolve) => setTimeout(resolve, 0));

			// --- Efficiently append to the output file ---
			let contentToAppend = "";
			const newlyWrittenWords = new Set<string>();

			for (const word of finalVocab) {
				if (!wordsWrittenToFile.has(word)) {
					const vector = fullGloveMap.get(word);
					if (vector) {
						contentToAppend += `${word} ${vector.join(" ")}\n`;
						newlyWrittenWords.add(word);
					}
				}
			}

			if (contentToAppend) {
				const existingOutputFile = 
					app.vault.getAbstractFileByPath(outputPath);
				if (existingOutputFile instanceof TFile) {
					await app.vault.append(existingOutputFile, contentToAppend);
				} else {
					const parentDir = outputPath.substring(
						0,
						outputPath.lastIndexOf("/"),
					);
					if (
						parentDir &&
						!(await app.vault.adapter.exists(parentDir))
					) {
						await app.vault.createFolder(parentDir);
					}
					await app.vault.create(outputPath, contentToAppend);
				}
				newlyWrittenWords.forEach((word) =>
					wordsWrittenToFile.add(word),
				);
			}

			// --- Update the checkpoint file ---
			const checkpointData: PruningCheckpoint = {
				processedVaultWords: Array.from(processedVaultWords),
				// FIX 2: Correctly include finalVocab in the saved checkpoint
				finalVocab: Array.from(finalVocab),
			};
			await app.vault.adapter.write(
				CHECKPOINT_PATH,
				JSON.stringify(checkpointData),
			);
		}
	}

	// --- Step 5: Prune to Max Size if Necessary ---
	notice.setMessage(
		`Step 4/5: Pruning vocabulary if it exceeds max size of ${settings.maxVocabSize}...`,
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	if (finalVocab.size > settings.maxVocabSize) {
		const neighborsOnly = new Set(
			[...finalVocab].filter((x) => !vaultVocab.has(x)),
		);
		const numToRemove = finalVocab.size - settings.maxVocabSize;

		if (numToRemove > 0) {
			const neighborsArray = Array.from(neighborsOnly);
			shuffleArray(neighborsArray);
			const keptNeighbors = new Set(neighborsArray.slice(numToRemove));
			finalVocab = new Set([...vaultVocab, ...keptNeighbors]);
		}
	}

	// --- Step 6: Write Final File & Cleanup ---
	notice.setMessage(
		`Step 5/5: Writing ${finalVocab.size} final vectors to file...`,
	);
	await new Promise((resolve) => setTimeout(resolve, 0));
	let outputContent = "";
	for (const [gloveWord, vector] of fullGloveMap.entries()) {
		if (finalVocab.has(gloveWord)) {
			outputContent += `${gloveWord} ${vector.join(" ")}\n`;
		}
	}
	const existingOutputFile = 
		app.vault.getAbstractFileByPath(outputPath);
	if (existingOutputFile instanceof TFile) {
		await app.vault.modify(existingOutputFile, outputContent);
	} else {
		await app.vault.create(outputPath, outputContent);
	}

	notice.setMessage("Enhanced vector file build complete!");
	if (await app.vault.adapter.exists(CHECKPOINT_PATH)) {
		await app.vault.adapter.remove(CHECKPOINT_PATH);
	}
	setTimeout(() => notice.hide(), 10000);
}
