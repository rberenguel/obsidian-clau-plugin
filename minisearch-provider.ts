import { App, TFile } from "obsidian";
import MiniSearch from "minisearch";
import { ISearchProvider } from "./search-provider";
import { SearchResult } from "./search";

export class MiniSearchProvider implements ISearchProvider {
	private app: App;
	private minisearch: MiniSearch;

	constructor(app: App) {
		this.app = app;
		this.minisearch = new MiniSearch({
			fields: ["title", "content"],
			storeFields: ["title", "path"],
			idField: "path",
			processTerm: (term) => term.toLowerCase(),
		});
	}

	async build() {
		const files = this.app.vault.getMarkdownFiles();
		const documents = await Promise.all(
			files.map(async (file) => {
				const content = await this.app.vault.cachedRead(file);
				return {
					path: file.path,
					title: file.basename,
					content: content,
				};
			}),
		);

		await this.minisearch.addAllAsync(documents);
		console.log(
			`Clau (MiniSearch): Index built with ${this.minisearch.documentCount} documents.`,
		);
	}

	async add(file: TFile) {
		const content = await this.app.vault.cachedRead(file);
		await this.minisearch.add({
			path: file.path,
			title: file.basename,
			content: content,
		});
	}

	async remove(file: TFile) {
		if (this.minisearch.has(file.path)) {
			await this.minisearch.remove({ path: file.path } as any);
		}
	}

	async update(file: TFile) {
		await this.remove(file);
		await this.add(file);
	}

	async search(query: string): Promise<SearchResult[]> {
		if (!query) return [];

		let isFuzzy = false;
		let searchTerms = query;

		if (query.startsWith(".")) {
			isFuzzy = true;
			searchTerms = query.substring(1);
		}

		if (!searchTerms) return [];

		const results = this.minisearch.search(searchTerms, {
			prefix: true,
			fuzzy: isFuzzy ? 0.2 : 0,
			boost: { title: 2 },
		});

		const resultsWithContext = await Promise.all(
			results.slice(0, 10).map(async (result) => {
				const file = this.app.vault.getAbstractFileByPath(result.path);
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					const queryWords = searchTerms
						.toLowerCase()
						.split(" ")
						.filter((w) => w.length > 0);
					const context = this.findContext(content, queryWords);
					return { ...result, context } as unknown as SearchResult;
				}
				return result as unknown as SearchResult;
			}),
		);

		return [
			...resultsWithContext,
			...results.slice(10).map((r) => r as unknown as SearchResult),
		];
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
					if (startIndex > 0) snippet = "... " + snippet;
					if (endIndex < words.length) snippet = snippet + " ...";
					return snippet;
				}
			}
		}
		return undefined;
	}

	getSize(): number {
		return this.minisearch.documentCount;
	}
}
