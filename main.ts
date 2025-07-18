import { App, Plugin, SuggestModal, TFile } from "obsidian";
import { SearchIndex, SearchResult } from "./search";
import { ISearchProvider } from "./search-provider";
import { MiniSearchProvider } from "./minisearch-provider";

export default class QuickSwitcherPlusPlugin extends Plugin {
	customSearchIndex: SearchIndex;
	miniSearchProvider: MiniSearchProvider;

	async onload() {
		this.customSearchIndex = new SearchIndex(this.app.vault);
		this.miniSearchProvider = new MiniSearchProvider(this.app);

		// await this.customSearchIndex.build();
		// console.log(`Clau (Custom): Index built with ${this.customSearchIndex.getSize()} unique words.`);

		await this.miniSearchProvider.build();

		this.addCommand({
			id: "open-clau-minisearch",
			name: "Open Search",
			callback: () => {
				new ClauModal(
					this.app,
					this.miniSearchProvider,
					"Search... (prefix with '.' for fuzzy search)",
				).open();
			},
		});

		this.addCommand({
			id: "rebuild-clau-index",
			name: "Re-build index",
			callback: async () => {
				// await this.customSearchIndex.build();
				await this.miniSearchProvider.build();
				console.log(
					`Clau: MiniSearch index has been manually rebuilt.`,
				);
			},
		});

		/*
		this.addCommand({
			id: "open-clau-custom-search",
			name: "Open Clau (Custom Search - Legacy)",
			callback: () => {
				new ClauModal(this.app, this.customSearchIndex, "Search by file name or content (full words)...").open();
			},
		});
		*/

		// Register events for the active providers
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					// this.customSearchIndex.add(file);
					this.miniSearchProvider.add(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					// this.customSearchIndex.remove(file);
					this.miniSearchProvider.remove(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") {
					// this.customSearchIndex.update(file);
					this.miniSearchProvider.update(file);
				}
			}),
		);
	}
}

class ClauModal extends SuggestModal<SearchResult> {
	private searchProvider: ISearchProvider;
	private query: string = "";

	constructor(
		app: App,
		searchProvider: ISearchProvider,
		placeholder: string,
	) {
		super(app);
		this.searchProvider = searchProvider;
		this.setPlaceholder(placeholder);
	}

	getSuggestions(query: string): Promise<SearchResult[]> {
		this.query = query;
		return this.searchProvider.search(query);
	}

	renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.classList.add("clau-suggestion-item");
		el.empty();

		const titleEl = el.createDiv({ cls: "clau-suggestion-title" });
		this.highlightText(titleEl, result.title, this.query);

		el.createEl("small", {
			text: result.path,
			cls: "clau-suggestion-path",
		});

		if (result.context) {
			const contextEl = el.createDiv({ cls: "clau-suggestion-context" });
			this.highlightText(contextEl, result.context, this.query);
		}
	}

	private highlightText(element: HTMLElement, text: string, query: string) {
		const queryWords = query
			.toLowerCase()
			.split(" ")
			.filter((w) => w.length > 0);
		if (queryWords.length === 0) {
			element.setText(text);
			return;
		}

		const regex = new RegExp(`(${queryWords.join("|")})`, "ig");
		const parts = text.split(regex);

		for (const part of parts) {
			if (queryWords.some((word) => part.toLowerCase() === word)) {
				element.createSpan({
					text: part,
					cls: "clau-suggestion-highlight",
				});
			} else {
				element.appendText(part);
			}
		}
	}

	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
		this.app.workspace.openLinkText(result.path, "", false);
	}
}
