import {
	App,
	Plugin,
	SuggestModal,
	TFile
} from "obsidian";
import { SearchIndex, SearchResult } from "./search";

export default class QuickSwitcherPlusPlugin extends Plugin {
	searchIndex: SearchIndex;

	async onload() {
		this.searchIndex = new SearchIndex(this.app.vault);

		await this.searchIndex.build();
		console.log(`Clau: Index built with ${this.searchIndex.getSize()} unique words.`);

		this.addCommand({
			id: "open-clau-switcher",
			name: "Open Clau Quick Switcher",
			callback: () => {
				new ClauModal(this.app, this.searchIndex).open();
			},
		});

		this.addCommand({
			id: "rebuild-clau-index",
			name: "Re-build Clau search index",
			callback: async () => {
				await this.searchIndex.build();
				console.log(`Clau: Index has been manually rebuilt with ${this.searchIndex.getSize()} unique words.`);
			}
		});

		this.registerEvent(this.app.vault.on('create', (file) => {
			if (file instanceof TFile) {
				this.searchIndex.add(file);
			}
		}));

		this.registerEvent(this.app.vault.on('delete', (file) => {
			if (file instanceof TFile) {
				this.searchIndex.remove(file);
			}
		}));

		this.registerEvent(this.app.vault.on('modify', (file) => {
			if (file instanceof TFile) {
				this.searchIndex.update(file);
			}
		}));
	}
}

class ClauModal extends SuggestModal<SearchResult> {
	private searchIndex: SearchIndex;
	private query: string = "";

	constructor(app: App, searchIndex: SearchIndex) {
		super(app);
		this.searchIndex = searchIndex;
		this.setPlaceholder("Search by file name or content (full words)...");
	}

	getSuggestions(query: string): Promise<SearchResult[]> {
		this.query = query;
		return this.searchIndex.search(query);
	}

	renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.empty(); // Clear previous content

		const titleEl = el.createDiv({ cls: "clau-suggestion-title" });
		this.highlightText(titleEl, result.title, this.query);

		el.createEl("small", { text: result.path, cls: "clau-suggestion-path" });

		if (result.context) {
			el.createEl("hr", { cls: "clau-suggestion-hr" });
			const contextEl = el.createDiv({ cls: "clau-suggestion-context" });
			this.highlightText(contextEl, result.context, this.query);
		}
	}

	private highlightText(element: HTMLElement, text: string, query: string) {
		const queryWords = query.toLowerCase().split(" ").filter(w => w.length > 0);
		if (queryWords.length === 0) {
			element.setText(text);
			return;
		}

		const regex = new RegExp(`(${queryWords.join("|")})`, "ig");
		const parts = text.split(regex);

		for (const part of parts) {
			if (queryWords.some(word => part.toLowerCase() === word)) {
				element.createSpan({ text: part, cls: "clau-suggestion-highlight" });
			} else {
				element.appendText(part);
			}
		}
	}

	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
		this.app.workspace.openLinkText(result.path, "", false);
	}
}