import { App, TFile } from "obsidian";
import { ISearchProvider } from "../search-provider";
import { SearchResult } from "../search";

export class TitleContainsSearchProvider implements ISearchProvider {
	private app: App;
	private titles: Map<string, string> = new Map(); // path -> title

	constructor(app: App) {
		this.app = app;
	}

	async build() {
		this.titles.clear();
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			this.titles.set(file.path, file.basename);
		}
		console.log(
			`Clau (TitleContains): Index built with ${this.titles.size} documents.`,
		);
	}

	async add(file: TFile) {
		this.titles.set(file.path, file.basename);
	}

	async remove(file: TFile) {
		this.titles.delete(file.path);
	}

	async rename(file: TFile, oldPath: string) {
		this.titles.delete(oldPath);
		this.titles.set(file.path, file.basename);
	}

	async update(file: TFile) {
		// For titles, update is same as add/remove
		this.titles.set(file.path, file.basename);
	}

	async search(query: string): Promise<SearchResult[]> {
		if (query.length < 4) {
			return [];
		}

		const lowerQuery = query.toLowerCase();
		const results: SearchResult[] = [];

		for (const [path, title] of this.titles.entries()) {
			if (title.toLowerCase().includes(lowerQuery)) {
				const file = this.app.vault.getAbstractFileByPath(path);
				let context: string | undefined = undefined;
				if (file instanceof TFile) {
					const content = await this.app.vault.read(file);
					context = this.findContext(content, [lowerQuery]);
				}
				results.push({ title, path, context });
			}
		}
		return results;
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
		return this.titles.size;
	}
}
