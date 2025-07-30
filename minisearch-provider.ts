import { App, TFile } from "obsidian";
import MiniSearch from "minisearch";
import { ISearchProvider } from "./search-provider";
import { SearchResult } from "./search";

interface ClauSettings {
	ignoredFolders: string;
	privateTags: string;
}

export class MiniSearchProvider implements ISearchProvider {
	private app: App;
	private minisearch: MiniSearch;
	private settings: ClauSettings;
	private isBuilding: boolean = false;

	constructor(app: App, settings: ClauSettings) {
		this.app = app;
		this.settings = settings;
		this.minisearch = new MiniSearch({
			fields: ["title", "content"],
			storeFields: ["title", "path"],
			idField: "path",
			processTerm: (term) => term.toLowerCase(),
		});
	}

	private isPathIgnored(path: string): boolean {
		if (!this.settings || !this.settings.ignoredFolders) return false;
		const ignoredFolders = this.settings.ignoredFolders
			.split(",")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);
		return ignoredFolders.some((folder) => path.startsWith(folder));
	}

	async build() {
		if (this.isBuilding) {
			console.log(
				"Clau (MiniSearch): Build already in progress. Skipping.",
			);
			return;
		}

		this.isBuilding = true;
		try {
			this.minisearch.removeAll();

			const files = this.app.vault
				.getMarkdownFiles()
				.filter((file) => !this.isPathIgnored(file.path));

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
				`Clau (MiniSearch): Index rebuilt with ${this.minisearch.documentCount} documents.`,
			);
		} catch (error) {
			console.error("Clau (MiniSearch): Error building index:", error);
		} finally {
			this.isBuilding = false;
		}
	}

	async add(file: TFile) {
		if (this.isPathIgnored(file.path)) return;
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

	async rename(file: TFile, oldPath: string) {
		if (this.minisearch.has(oldPath)) {
			await this.minisearch.remove({ path: oldPath } as any);
		}
		if (!this.isPathIgnored(file.path)) {
			await this.add(file);
		}
	}

	async update(file: TFile) {
		if (this.isPathIgnored(file.path)) {
			await this.remove(file);
			return;
		}
		await this.remove(file);
		await this.add(file);
	}

	async search(query: string): Promise<SearchResult[]> {
		if (!query) return [];

		let isFuzzy = false;
		let isTitleOnly = false;
		let searchTerms = query;

		if (query.startsWith(".")) {
			isFuzzy = true;
			searchTerms = query.substring(1);
		}

		if (searchTerms.startsWith(" ")) {
			isTitleOnly = true;
			searchTerms = searchTerms.trim();
		}

		if (!searchTerms) return [];

		const allTerms = searchTerms.split(" ").filter((t) => t.length > 0);

		const pathExcludeTerms = allTerms
			.filter((t) => t.startsWith("-/"))
			.map((t) => t.substring(2));

		const nonPathTerms = allTerms.filter((t) => !t.startsWith("-/"));

		const includeTerms = nonPathTerms.filter((t) => !t.startsWith("-"));
		const excludeTerms = nonPathTerms
			.filter((t) => t.startsWith("-"))
			.map((t) => t.substring(1));

		if (includeTerms.length === 0) return [];

		let searchQuery: any = {
			combineWith: "OR",
			queries: includeTerms,
		};

		if (excludeTerms.length > 0) {
			searchQuery = {
				combineWith: "AND_NOT",
				queries: [
					searchQuery,
					{
						combineWith: "OR",
						queries: excludeTerms,
					},
				],
			};
		}

		const searchOptions: any = {
			prefix: true,
			fuzzy: isFuzzy ? 0.2 : 0,
			boost: { title: 2 },
		};

		if (isTitleOnly) {
			searchOptions.fields = ["title"];
		}

		let results = this.minisearch.search(searchQuery, searchOptions);

		if (pathExcludeTerms.length > 0) {
			results = results.filter(
				(result) =>
					!pathExcludeTerms.some((exclude) =>
						result.path.startsWith(exclude),
					),
			);
		}

		const resultsWithContext = await Promise.all(
			results.slice(0, 10).map(async (result) => {
				const file = this.app.vault.getAbstractFileByPath(result.path);
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					const queryWords = includeTerms
						.join(" ")
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