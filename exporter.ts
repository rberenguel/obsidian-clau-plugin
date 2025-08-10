// src/exporter.ts or at the bottom of main.ts
import { App, Notice, TFile, normalizePath } from "obsidian";

export async function exportVaultVocabulary(app: App, outputPath: string) {
	const notice = new Notice("Scanning vault for vocabulary...", 0);
	const vocabulary = new Set<string>();

	// Scan all markdown files and collect unique words
	for (const file of app.vault.getMarkdownFiles()) {
		const content = await app.vault.cachedRead(file);
		const words = content.toLowerCase().match(/\b\w+\b/g) || [];
		words.forEach((word) => vocabulary.add(word));
	}

	notice.setMessage(`Found ${vocabulary.size} unique words. Exporting...`);

	// Sort the words alphabetically and join them into a single string
	const sortedVocab = Array.from(vocabulary).sort();
	const outputContent = sortedVocab.join("\n");

	const normalizedPath = normalizePath(outputPath);

	// Ensure the parent folder exists
	const parentDir = normalizedPath.substring(
		0,
		normalizedPath.lastIndexOf("/"),
	);
	if (parentDir && !(await app.vault.adapter.exists(parentDir))) {
		await app.vault.createFolder(parentDir);
	}

	// Write the vocabulary file
	const existingFile = app.vault.getAbstractFileByPath(normalizedPath);
	if (existingFile instanceof TFile) {
		await app.vault.modify(existingFile, outputContent);
	} else {
		await app.vault.create(normalizedPath, outputContent);
	}

	notice.setMessage(
		`Successfully exported ${vocabulary.size} words to ${outputPath}.`,
	);
	setTimeout(() => notice.hide(), 10000);
}
