import { TFile, Vault } from "obsidian";

import { ISearchProvider } from "./search-provider";

export interface SearchResult {
	title: string;
	path: string;
	context?: string;
	highlightWord?: string; // For semantic search highlighting
}

export class SearchIndex implements ISearchProvider {
	private index: Map<string, SearchResult[]> = new Map();
	private vault: Vault;

	constructor(vault: Vault) {
		this.vault = vault;
	}

	async build() {
		this.index.clear();
		const files = this.vault.getMarkdownFiles();
		for (const file of files) {
			await this.add(file);
		}
	}

	async add(file: TFile) {
		const content = await this.vault.cachedRead(file);
		const note: SearchResult = { title: file.basename, path: file.path };
		const words = this.getWords(content + " " + note.title);

		for (const word of words) {
			const notes = this.index.get(word) || [];
			if (!notes.some((n) => n.path === file.path)) {
				notes.push(note);
			}
			this.index.set(word, notes);
		}
	}

	remove(file: TFile) {
		const wordsToRemove: string[] = [];
		for (const [word, notes] of this.index.entries()) {
			const newNotes = notes.filter((n) => n.path !== file.path);
			if (newNotes.length === 0) {
				wordsToRemove.push(word);
			} else {
				this.index.set(word, newNotes);
			}
		}
		for (const word of wordsToRemove) {
			this.index.delete(word);
		}
	}

	async update(file: TFile) {
		this.remove(file);
		await this.add(file);
	}

	async search(query: string): Promise<SearchResult[]> {
		const queryWords = this.getWords(query);
		if (queryWords.size === 0) {
			return this.getAllNotes();
		}

		let resultNotes: SearchResult[] | null = null;

		for (const word of queryWords) {
			const notesForWord = this.index.get(word.toLowerCase());
			if (!notesForWord) {
				return []; // Word not found, so no intersection is possible
			}
			if (resultNotes === null) {
				resultNotes = notesForWord;
			} else {
				const currentPaths = new Set(notesForWord.map((n) => n.path));
				resultNotes = resultNotes.filter((r) =>
					currentPaths.has(r.path),
				);
			}
		}

		const results = resultNotes || [];

		const resultsWithContext = await Promise.all(
			results.slice(0, 10).map(async (note) => {
				const file = this.vault.getAbstractFileByPath(note.path);
				if (file instanceof TFile) {
					const content = await this.vault.read(file);
					const context = this.findContext(
						content,
						Array.from(queryWords),
					);
					return { ...note, context };
				}
				return note;
			}),
		);

		return [...resultsWithContext, ...results.slice(10)];
	}

	private findContext(
		content: string,
		queryWords: string[],
	): string | undefined {
		const lines = content.split("\n");
		for (const line of lines) {
			const lowerLine = line.toLowerCase();
			const firstMatch = queryWords.find((word) =>
				lowerLine.includes(word),
			);

			if (firstMatch) {
				const words = line.trim().split(/\s+/);
				const lowerWords = words.map((w) => w.toLowerCase());
				const matchIndex = lowerWords.findIndex((word) =>
					word.includes(firstMatch),
				);

				if (matchIndex !== -1) {
					const windowSize = 5;
					const startIndex = Math.max(0, matchIndex - windowSize);
					const endIndex = Math.min(
						words.length,
						matchIndex + windowSize + 1,
					);

					let snippet = words.slice(startIndex, endIndex).join(" ");
					if (startIndex > 0) {
						snippet = "... " + snippet;
					}
					if (endIndex < words.length) {
						snippet = snippet + " ...";
					}
					return snippet;
				}
			}
		}
		return undefined;
	}

	private getAllNotes(): SearchResult[] {
		const allNotesSet = new Set<SearchResult>();
		for (const notes of this.index.values()) {
			for (const note of notes) {
				allNotesSet.add(note);
			}
		}
		return Array.from(allNotesSet);
	}

	private getWords(text: string): Set<string> {
		const words = text
			.toLowerCase()
			.split(/[\s\n\r\t.,;:"'()\[\]{}!@#$%^&*\-+=<>?~`]/)
			.filter((word) => word.length > 2);
		return new Set(words);
	}

	getSize(): number {
		return this.index.size;
	}
}
