// search-modal.ts
import { App, MarkdownRenderer, Plugin, SuggestModal, TFile } from "obsidian";
import { SearchResult } from "./search";
import { ISearchProvider } from "./search-provider";
import { ClauSettings } from "./settings";

export class ClauModal extends SuggestModal<SearchResult> {
	private searchProvider: ISearchProvider;
	private query: string = "";
	private plugin: Plugin;
	private settings: ClauSettings;
	private isPrivateSearch: boolean = false;
	private ignorePrivacy: boolean = false;
	private isLoading: boolean = false;

	constructor(
		app: App,
		searchProvider: ISearchProvider,
		plugin: Plugin,
		placeholder: string,
		settings: ClauSettings,
	) {
		super(app);
		this.searchProvider = searchProvider;
		this.setPlaceholder(placeholder);
		this.plugin = plugin;
		this.settings = settings;
	}

	async getSuggestions(query: string): Promise<SearchResult[]> {
		if (this.isLoading) {
			return [];
		}

		this.isLoading = true;
		try {
			this.query = query;
			this.isPrivateSearch = query.startsWith("?");
			this.ignorePrivacy = query.startsWith("!");
			if (this.isPrivateSearch || this.ignorePrivacy) {
				this.query = query.substring(1);
			}
			const results = await this.searchProvider.search(this.query);
			return results;
		} finally {
			this.isLoading = false;
		}
	}

	async renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.classList.add("clau-suggestion-item");
		el.empty();
		const highlightQuery = result.highlightWord || this.query;
		const titleEl = el.createDiv({
			cls: "clau-suggestion-title",
			text: result.title,
		});
		this.highlightRenderedHTML(titleEl, highlightQuery);
		el.createEl("small", {
			text: result.path,
			cls: "clau-suggestion-path",
		});

		const fileCache = this.app.metadataCache.getCache(result.path);
		const privateTags = this.settings.privateTags
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t);
		const privateFolders = this.settings.privateFolders
			.split(",")
			.map((f) => f.trim())
			.filter((f) => f);
		const hasPrivateTag =
			fileCache?.tags?.some((t) =>
				privateTags.includes(t.tag.substring(1)),
			) ?? false;
		const inPrivateFolder = privateFolders.some((f) =>
			result.path.startsWith(f),
		);
		const hasRobaEstesaPrivacy =
			Array.isArray(fileCache?.frontmatter?.privacy) &&
			fileCache?.frontmatter?.privacy &&
			fileCache?.frontmatter?.privacy?.length > 0;
		const isPrivate =
			hasPrivateTag || inPrivateFolder || hasRobaEstesaPrivacy;

		const reason = hasPrivateTag
			? "private tag"
			: inPrivateFolder
				? "private folder"
				: hasRobaEstesaPrivacy
					? "Roba Estesa privacy"
					: "private note";

		if (
			(result.context && !isPrivate && !this.isPrivateSearch) ||
			this.ignorePrivacy
		) {
			const contextEl = el.createDiv({ cls: "clau-suggestion-context" });
			await MarkdownRenderer.render(
				this.app,
				result.context ?? "No context available",
				contextEl,
				result.path,
				this.plugin,
			);
			this.highlightRenderedHTML(contextEl, highlightQuery);
		} else if ((isPrivate && !this.ignorePrivacy) || this.isPrivateSearch) {
			const wrapper = el.createDiv({
				cls: "clau-suggestion-context clau-private-context",
			});
			wrapper.createSpan({
				cls: "clau-private-block",
				text: "Context hidden",
			});
			wrapper.createSpan({
				text: ` (${this.isPrivateSearch ? "private search" : reason})`,
			});
		}
	}

	private highlightRenderedHTML(container: HTMLElement, query: string) {
		const queryWords = query
			.toLowerCase()
			.split(" ")
			.filter((w) => w.length > 0);
		if (queryWords.length === 0) return;
		const regex = new RegExp(`\\b(${queryWords.join("|")})\\w*`, "ig");
		const walker = document.createTreeWalker(
			container,
			NodeFilter.SHOW_TEXT,
			null,
		);
		const nodesToReplace: { original: Node; replacements: Node[] }[] = [];
		let node;
		while ((node = walker.nextNode())) {
			const text = node.nodeValue || "";
			if (!regex.test(text)) continue;
			regex.lastIndex = 0;
			const fragment = document.createDocumentFragment();
			let lastIndex = 0;
			let match;
			while ((match = regex.exec(text)) !== null) {
				if (match.index > lastIndex)
					fragment.appendChild(
						document.createTextNode(
							text.substring(lastIndex, match.index),
						),
					);
				fragment.appendChild(
					createEl("mark", {
						text: match[0],
						cls: "clau-suggestion-highlight",
					}),
				);
				lastIndex = regex.lastIndex;
			}
			if (lastIndex < text.length)
				fragment.appendChild(
					document.createTextNode(text.substring(lastIndex)),
				);
			if (fragment.hasChildNodes())
				nodesToReplace.push({
					original: node,
					replacements: Array.from(fragment.childNodes),
				});
		}
		for (const { original, replacements } of nodesToReplace) {
			(original as ChildNode).replaceWith(...replacements);
		}
	}

	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
		this.app.workspace.openLinkText(result.path, "", false);
	}
}
