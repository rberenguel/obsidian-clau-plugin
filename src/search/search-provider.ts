import { SearchResult } from "./search";

export interface ISearchProvider {
	search(query: string): Promise<SearchResult[]>;
}
