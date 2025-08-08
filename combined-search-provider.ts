import { ISearchProvider } from "./search-provider";
import { SearchResult } from "./search";
import { MiniSearchProvider } from "./minisearch-provider";
import { TitleContainsSearchProvider } from "./title-contains-search-provider";
import { TFile } from "obsidian";

export class CombinedSearchProvider implements ISearchProvider {
	private miniSearchProvider: MiniSearchProvider;
	private titleContainsSearchProvider: TitleContainsSearchProvider;

	constructor(
		miniSearchProvider: MiniSearchProvider,
		titleContainsSearchProvider: TitleContainsSearchProvider,
	) {
		this.miniSearchProvider = miniSearchProvider;
		this.titleContainsSearchProvider = titleContainsSearchProvider;
	}

	async build() {
		await this.miniSearchProvider.build();
		await this.titleContainsSearchProvider.build();
	}

	async add(file: TFile) {
		await this.miniSearchProvider.add(file);
		await this.titleContainsSearchProvider.add(file);
	}

	async remove(file: TFile) {
		await this.miniSearchProvider.remove(file);
		await this.titleContainsSearchProvider.remove(file);
	}

	async rename(file: TFile, oldPath: string) {
		await this.miniSearchProvider.rename(file, oldPath);
		await this.titleContainsSearchProvider.rename(file, oldPath);
	}

	async update(file: TFile) {
		await this.miniSearchProvider.update(file);
		await this.titleContainsSearchProvider.update(file);
	}

	async search(query: string): Promise<SearchResult[]> {
		const [miniSearchResults, titleContainsResults] = await Promise.all([
			this.miniSearchProvider.search(query),
			this.titleContainsSearchProvider.search(query),
		]);

		const combinedResults: SearchResult[] = [];
		const seenPaths = new Set<string>();

		// Add MiniSearch results first
		for (const result of miniSearchResults) {
			if (!seenPaths.has(result.path)) {
				combinedResults.push(result);
				seenPaths.add(result.path);
			}
		}

		// Add TitleContains results, avoiding duplicates
		for (const result of titleContainsResults) {
			if (!seenPaths.has(result.path)) {
				combinedResults.push(result);
				seenPaths.add(result.path);
			}
		}

		return combinedResults;
	}

	getSize(): number {
		return (
			this.miniSearchProvider.getSize() +
			this.titleContainsSearchProvider.getSize()
		);
	}
}
