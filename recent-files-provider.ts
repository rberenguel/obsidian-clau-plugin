
import { App, TFile } from "obsidian";
import { ISearchProvider } from "./search-provider";
import { SearchResult } from "./search";

export class RecentFilesSearchProvider implements ISearchProvider {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    async search(query: string): Promise<SearchResult[]> {
        const recentFiles = this.app.vault.getMarkdownFiles()
            .sort((a, b) => b.stat.mtime - a.stat.mtime)
            .slice(0, 5);

        const searchResults: SearchResult[] = recentFiles.map(file => ({
            title: file.basename,
            path: file.path,
        }));

        return searchResults;
    }
}
