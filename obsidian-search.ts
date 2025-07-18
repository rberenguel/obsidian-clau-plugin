import { App, TFile } from "obsidian";
import { ISearchProvider } from "./search-provider";
import { SearchResult } from "./search";

// A wrapper around Obsidian's internal search functionality
export class ObsidianSearchProvider implements ISearchProvider {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	async search(query: string): Promise<SearchResult[]> {
		if (!query) {
			return [];
		}

		// Access the internal search plugin using the 'global-search' ID.
		const searchPlugin = this.app.internalPlugins.plugins["global-search"];

		// This is an undocumented API, so we must be very defensive.
		if (
			!searchPlugin ||
			!searchPlugin.instance ||
			typeof searchPlugin.instance.search !== "function"
		) {
			console.error(
				"Clau: Could not access Obsidian's internal search API. Please make sure the core 'Search' plugin is enabled.",
			);
			return [];
		}

		const search = searchPlugin.instance;

		// The search function in the API is synchronous and takes a callback
		let searchResults: any[] = [];
		try {
			// This is a trick to synchronously get the results from the async-style callback
			const originalSearch = search.search.bind(search);
			originalSearch(query, (results: any) => {
				searchResults = results;
			});
		} catch (e) {
			console.error("Clau: Error executing Obsidian search:", e);
			return [];
		}

		const files = searchResults.map((result) => result.file);

		return files.map((file: TFile) => ({
			title: file.basename,
			path: file.path,
			// We don't get context from the native API, so we leave it undefined
		}));
	}
}
