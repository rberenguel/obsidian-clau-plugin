import {
	App,
	Plugin,
	SuggestModal,
	TFile,
	MarkdownRenderer,
	PluginSettingTab,
	Setting,
} from "obsidian";
import { SearchIndex, SearchResult } from "./search";
import { ISearchProvider } from "./search-provider";
import { MiniSearchProvider } from "./minisearch-provider";

interface ClauSettings {
	ignoredFolders: string;
	privateTags: string;
	privateFolders: string;
}

const DEFAULT_SETTINGS: ClauSettings = {
	ignoredFolders: "",
	privateTags: "",
	privateFolders: "",
};

export default class QuickSwitcherPlusPlugin extends Plugin {
	customSearchIndex: SearchIndex;
	miniSearchProvider: MiniSearchProvider;
	settings: ClauSettings;

	async onload() {
		await this.loadSettings();

		this.customSearchIndex = new SearchIndex(this.app.vault);
		this.miniSearchProvider = new MiniSearchProvider(
			this.app,
			this.settings,
		);

		await this.miniSearchProvider.build();

		this.addCommand({
			id: "open-clau-minisearch",
			name: "Open Search",
			callback: () => {
				new ClauModal(
					this.app,
					this.miniSearchProvider,
					this,
					"search? also: ? for private, ! to ignore privacy, space for title, . for fuzzy, -term, -/path",
					this.settings,
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

		this.addSettingTab(new ClauSettingTab(this.app, this));
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData(),
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Re-build index after saving settings
		await this.miniSearchProvider.build();
	}
}

class ClauSettingTab extends PluginSettingTab {
	plugin: QuickSwitcherPlusPlugin;

	constructor(app: App, plugin: QuickSwitcherPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl("h2", { text: "Clau Settings" });

		new Setting(containerEl)
			.setName("Ignored folders")
			.setDesc(
				"A comma-separated list of folder paths to ignore. Any file path starting with one of these will be excluded from the search.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. templates/,private/")
					.setValue(this.plugin.settings.ignoredFolders)
					.onChange(async (value) => {
						this.plugin.settings.ignoredFolders = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Private tags")
			.setDesc(
				"A comma-separated list of tags. Notes containing any of these tags will not show a preview in the search results. The tag should not include the '#'.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. private,secret")
					.setValue(this.plugin.settings.privateTags)
					.onChange(async (value) => {
						this.plugin.settings.privateTags = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Private folders")
			.setDesc(
				"A comma-separated list of folder paths. Notes in these folders will not show a preview.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. journals/,personal/")
					.setValue(this.plugin.settings.privateFolders)
					.onChange(async (value) => {
						this.plugin.settings.privateFolders = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}

class ClauModal extends SuggestModal<SearchResult> {
	private searchProvider: ISearchProvider;
	private query: string = "";
	private plugin: Plugin;
	private settings: ClauSettings;
	private isPrivateSearch: boolean = false;
	private ignorePrivacy: boolean = false;

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

	getSuggestions(query: string): Promise<SearchResult[]> {
		this.query = query;
		this.isPrivateSearch = false;
		this.ignorePrivacy = false;

		if (query.startsWith("?")) {
			this.isPrivateSearch = true;
			this.query = query.substring(1);
		} else if (query.startsWith("!")) {
			this.ignorePrivacy = true;
			this.query = query.substring(1);
		}

		return this.searchProvider.search(this.query);
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

		// Always show context if privacy is ignored
		if (this.ignorePrivacy) {
			if (result.context) {
				const contextEl = el.createDiv({
					cls: "clau-suggestion-context",
				});
				MarkdownRenderer.render(
					this.app,
					result.context,
					contextEl,
					result.path,
					this.plugin,
				);
				this.highlightRenderedHTML(contextEl, this.query);
			}
			return;
		}

		// Handle private search mode
		if (this.isPrivateSearch) {
			const wrapper = el.createDiv({
				cls: "clau-suggestion-context clau-private-context",
			});
			wrapper.createSpan({
				cls: "clau-private-block",
				text: "Context hidden",
			});
			wrapper.createSpan({
				text: " (private search)",
			});
			return;
		}

		// Default behavior: check settings
		const privateTags = this.settings.privateTags
			.split(",")
			.map((t) => t.trim())
			.filter((t) => t.length > 0);
		const privateFolders = this.settings.privateFolders
			.split(",")
			.map((f) => f.trim())
			.filter((f) => f.length > 0);

		const fileCache = this.app.metadataCache.getCache(result.path);
		const hasPrivateTag =
			fileCache?.tags?.some((t) =>
				privateTags.includes(t.tag.substring(1)),
			) ?? false;
		const inPrivateFolder = privateFolders.some((f) =>
			result.path.startsWith(f),
		);
		const privacyFrontmatter = fileCache?.frontmatter?.privacy;
		const hasRobaEstesaPrivacy =
			Array.isArray(privacyFrontmatter) && privacyFrontmatter.length > 0;

		if (result.context) {
			if (hasPrivateTag || inPrivateFolder || hasRobaEstesaPrivacy) {
				let reason = "private note";
				if (hasPrivateTag) {
					reason = "private tag";
				} else if (inPrivateFolder) {
					reason = "private folder";
				} else if (hasRobaEstesaPrivacy) {
					reason = "Roba Estesa privacy";
				}
				const wrapper = el.createDiv({
					cls: "clau-suggestion-context clau-private-context",
				});
				wrapper.createSpan({
					cls: "clau-private-block",
					text: "Context hidden",
				});
				wrapper.createSpan({
					text: ` (${reason})`,
				});
			} else {
				const contextEl = el.createDiv({
					cls: "clau-suggestion-context",
				});
				MarkdownRenderer.render(
					this.app,
					result.context,
					contextEl,
					result.path,
					this.plugin,
				);
				this.highlightRenderedHTML(contextEl, this.query);
			}
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
