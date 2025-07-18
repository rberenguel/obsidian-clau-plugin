import { App, Plugin, SuggestModal, TFile, MarkdownRenderer } from "obsidian";
import { SearchIndex, SearchResult } from "./search";
import { ISearchProvider } from "./search-provider";
import { MiniSearchProvider } from "./minisearch-provider";

export default class QuickSwitcherPlusPlugin extends Plugin {
	customSearchIndex: SearchIndex;
	miniSearchProvider: MiniSearchProvider;

	async onload() {
		this.customSearchIndex = new SearchIndex(this.app.vault);
		this.miniSearchProvider = new MiniSearchProvider(this.app);

		await this.miniSearchProvider.build();

		this.addCommand({
			id: "open-clau-minisearch",
			name: "Open Search",
			callback: () => {
				new ClauModal(
					this.app,
					this.miniSearchProvider,
					this,
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
	private plugin: Plugin;

	constructor(
		app: App,
		searchProvider: ISearchProvider,
		plugin: Plugin,
		placeholder: string,
	) {
		super(app);
		this.searchProvider = searchProvider;
		this.setPlaceholder(placeholder);
		this.plugin = plugin;
	}

	getSuggestions(query: string): Promise<SearchResult[]> {
		this.query = query;
		return this.searchProvider.search(query);
	}

	renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.classList.add("clau-suggestion-item");
		el.empty();

		const titleEl = el.createDiv({ cls: "clau-suggestion-title" });
		titleEl.setText(result.title);
		this.highlightRenderedHTML(titleEl, this.query);

		el.createEl("small", {
			text: result.path,
			cls: "clau-suggestion-path",
		});

		if (result.context) {
			const contextEl = el.createDiv({ cls: "clau-suggestion-context" });
			// 1. Render clean markdown first
			MarkdownRenderer.render(
				this.app,
				result.context,
				contextEl,
				result.path,
				this.plugin,
			);
			// 2. Highlight the resulting HTML
			this.highlightRenderedHTML(contextEl, this.query);
		}
	}

	private highlightRenderedHTML(container: HTMLElement, query: string) {
		const queryWords = query
			.toLowerCase()
			.split(" ")
			.filter((w) => w.length > 0);
		if (queryWords.length === 0) return;

		// Regex to find whole words that start with any of the query words.
		const regex = new RegExp(`\\b(${queryWords.join("|")})\\w*`, "ig");

		const walker = document.createTreeWalker(
			container,
			NodeFilter.SHOW_TEXT,
			{
				acceptNode: (node) =>
					node.parentElement?.tagName !== "SCRIPT" &&
					node.parentElement?.tagName !== "STYLE"
						? NodeFilter.FILTER_ACCEPT
						: NodeFilter.FILTER_REJECT,
			},
		);

		const nodesToReplace: { original: Node; replacements: Node[] }[] = [];

		let node;
		while ((node = walker.nextNode())) {
			const text = node.nodeValue || "";
			regex.lastIndex = 0; // Reset regex state
			if (!regex.test(text)) continue;

			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let match;
			regex.lastIndex = 0;

			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex) {
					fragment.appendChild(
						document.createTextNode(
							text.substring(lastIndex, match.index),
						),
					);
				}
				const mark = createEl("mark", {
					text: match[0],
					cls: "clau-suggestion-highlight",
				});
				fragment.appendChild(mark);
				lastIndex = regex.lastIndex;
			}

			if (lastIndex < text.length) {
				fragment.appendChild(
					document.createTextNode(text.substring(lastIndex)),
				);
			}

			if (fragment.hasChildNodes()) {
				nodesToReplace.push({
					original: node,
					replacements: Array.from(fragment.childNodes),
				});
			}
		}

		for (const { original, replacements } of nodesToReplace) {
			(original as ChildNode).replaceWith(...replacements);
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
