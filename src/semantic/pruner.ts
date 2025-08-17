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

async function loadCheckpoint(app: App, outputPath: string): Promise<{ processedVaultWords: Set<string>, finalVocab: Set<string>, wordsWrittenToFile: Set<string> }> {
    let processedVaultWords = new Set<string>();
    let finalVocab = new Set<string>();
    let wordsWrittenToFile = new Set<string>();

    if (await app.vault.adapter.exists(CHECKPOINT_PATH)) {
        try {
            const checkpointData: PruningCheckpoint = JSON.parse(
                await app.vault.adapter.read(CHECKPOINT_PATH),
            );
            processedVaultWords = new Set(checkpointData.processedVaultWords);
            finalVocab = new Set(checkpointData.finalVocab);

            const existingOutputFile = app.vault.getAbstractFileByPath(outputPath);
            if (existingOutputFile instanceof TFile) {
                const prunedContent = await app.vault.read(existingOutputFile);
                prunedContent
                    .split("\n")
                    .forEach((line) =>
                        wordsWrittenToFile.add(line.split(" ")[0]),
                    );
            }
            new Notice(`Resuming from checkpoint. ${processedVaultWords.size} words processed.`);
            await new Promise((resolve) => setTimeout(resolve, 1000));
        } catch (e) {
            console.error("Could not read checkpoint file, starting fresh.", e);
        }
    }
    return { processedVaultWords, finalVocab, wordsWrittenToFile };
}

async function getWordsToProcess(app: App, processedVaultWords: Set<string>): Promise<string[]> {
    const vaultVocab = new Set<string>();
    for (const file of app.vault.getMarkdownFiles()) {
        const content = await app.vault.cachedRead(file);
        const words = content.toLowerCase().match(/\b\w+\b/g) || [];
        words.forEach((word) => vaultVocab.add(word));
    }
    return [...vaultVocab].filter((word) => !processedVaultWords.has(word));
}

async function loadGloveModel(app: App, settings: MyPluginSettings): Promise<Map<string, number[]>> {
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
    return fullGloveMap;
}

async function findAndWriteNeighbors(
    app: App,
    wordsToProcess: string[],
    fullGloveMap: Map<string, number[]>, 
    finalVocab: Set<string>,
    processedVaultWords: Set<string>,
    wordsWrittenToFile: Set<string>,
    settings: MyPluginSettings,
    outputPath: string,
    notice: Notice
) {
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

        if ((i + 1) % CHECKPOINT_INTERVAL === 0 || i + 1 === wordsToProcess.length) {
            notice.setMessage(`Progress... ${i + 1}/${wordsToProcess.length}. Saving checkpoint.`);
            await saveCheckpointAndAppend(app, finalVocab, processedVaultWords, wordsWrittenToFile, fullGloveMap, outputPath);
        }
    }
}

async function saveCheckpointAndAppend(
    app: App,
    finalVocab: Set<string>,
    processedVaultWords: Set<string>,
    wordsWrittenToFile: Set<string>,
    fullGloveMap: Map<string, number[]>,
    outputPath: string
) {
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
        const existingOutputFile = app.vault.getAbstractFileByPath(outputPath);
        if (existingOutputFile instanceof TFile) {
            await app.vault.append(existingOutputFile, contentToAppend);
        } else {
            const parentDir = outputPath.substring(0, outputPath.lastIndexOf("/"));
            if (parentDir && !(await app.vault.adapter.exists(parentDir))) {
                await app.vault.createFolder(parentDir);
            }
            await app.vault.create(outputPath, contentToAppend);
        }
        newlyWrittenWords.forEach((word) => wordsWrittenToFile.add(word));
    }

    const checkpointData: PruningCheckpoint = {
        processedVaultWords: Array.from(processedVaultWords),
        finalVocab: Array.from(finalVocab),
    };
    await app.vault.adapter.write(CHECKPOINT_PATH, JSON.stringify(checkpointData));
}

function pruneFinalVocab(finalVocab: Set<string>, vaultVocab: Set<string>, maxVocabSize: number): Set<string> {
    if (finalVocab.size > maxVocabSize) {
        const neighborsOnly = new Set([...finalVocab].filter((x) => !vaultVocab.has(x)));
        const numToRemove = finalVocab.size - maxVocabSize;

        if (numToRemove > 0) {
            const neighborsArray = Array.from(neighborsOnly);
            shuffleArray(neighborsArray);
            const keptNeighbors = new Set(neighborsArray.slice(numToRemove));
            return new Set([...vaultVocab, ...keptNeighbors]);
        }
    }
    return finalVocab;
}

async function writeFinalOutputFile(app: App, finalVocab: Set<string>, fullGloveMap: Map<string, number[]>, outputPath: string) {
    let outputContent = "";
    for (const [gloveWord, vector] of fullGloveMap.entries()) {
        if (finalVocab.has(gloveWord)) {
            outputContent += `${gloveWord} ${vector.join(" ")}\n`;
        }
    }
    const existingOutputFile = app.vault.getAbstractFileByPath(outputPath);
    if (existingOutputFile instanceof TFile) {
        await app.vault.modify(existingOutputFile, outputContent);
    } else {
        await app.vault.create(outputPath, outputContent);
    }
}

export async function buildEnhancedPrunedVectors(
	app: App,
	settings: MyPluginSettings,
) {
	const notice = new Notice("Starting enhanced vector file process...", 0);
	if (!settings || !settings.glovePathFormat || !settings.prunedGlovePath) {
		new Notice("Semantic Search settings are not ready yet. Please try again in a moment.", 5000);
		console.error("buildEnhancedPrunedVectors was called before settings were fully loaded.");
		return;
	}
	const outputPath = normalizePath(settings.prunedGlovePath);

    const { processedVaultWords, finalVocab, wordsWrittenToFile } = await loadCheckpoint(app, outputPath);

	notice.setMessage("Step 1/5: Scanning vault for all unique words...");
    const wordsToProcess = await getWordsToProcess(app, processedVaultWords);
	if (wordsToProcess.length === 0) {
		notice.setMessage("Vector file is already up-to-date with vault words!");
		setTimeout(() => notice.hide(), 5000);
		return;
	}

	notice.setMessage("Step 2/5: Loading full GloVe model...");
    const fullGloveMap = await loadGloveModel(app, settings);
	if (fullGloveMap.size === 0) {
		notice.setMessage("Failed to load full GloVe model. Check settings.");
		setTimeout(() => notice.hide(), 5000);
		return;
	}

	notice.setMessage(`Step 3/5: Finding neighbors for ${wordsToProcess.length} new words...`);
    await findAndWriteNeighbors(app, wordsToProcess, fullGloveMap, finalVocab, processedVaultWords, wordsWrittenToFile, settings, outputPath, notice);

	notice.setMessage(`Step 4/5: Pruning vocabulary if it exceeds max size of ${settings.maxVocabSize}...`);
    const vaultVocab = new Set(wordsToProcess.concat(Array.from(processedVaultWords)));
    const prunedVocab = pruneFinalVocab(finalVocab, vaultVocab, settings.maxVocabSize);

	notice.setMessage(`Step 5/5: Writing ${prunedVocab.size} final vectors to file...`);
    await writeFinalOutputFile(app, prunedVocab, fullGloveMap, outputPath);

	notice.setMessage("Enhanced vector file build complete!");
	if (await app.vault.adapter.exists(CHECKPOINT_PATH)) {
		await app.vault.adapter.remove(CHECKPOINT_PATH);
	}
	setTimeout(() => notice.hide(), 10000);
}
