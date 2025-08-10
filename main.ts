import {
	App,
	Plugin,
	SuggestModal,
	TFile,
	MarkdownRenderer,
	PluginSettingTab,
	Setting,
	Notice,
} from "obsidian";
import { SearchResult } from "./search";
import { ISearchProvider } from "./search-provider";
import { MiniSearchProvider } from "./minisearch-provider";
import { TitleContainsSearchProvider } from "./title-contains-search-provider";
import { CombinedSearchProvider } from "./combined-search-provider";
import { MultiSelectModal } from "./multi-select-modal";
import { SemanticSearchProvider } from "./semantic-search-provider";
import { buildEnhancedPrunedVectors } from "./pruner";
import { exportVaultVocabulary } from "./exporter";

export interface ClauSettings {
	ignoredFolders: string;
	privateTags: string;
	privateFolders: string;
	reindexInterval: number;
	// Semantic Search Settings
	enableSemanticSearch: boolean;
	glovePathFormat: string;
	gloveFileCount: number;
	prunedGlovePath: string;
	similarityThreshold: number;
	maxVocabSize: number;
	lastRebuildIndexTime: number | null;
	lastExportVocabularyTime: number | null;
}

const DEFAULT_SETTINGS: ClauSettings = {
	ignoredFolders: "",
	privateTags: "",
	privateFolders: "",
	reindexInterval: 10,
	// Semantic Search Defaults
	enableSemanticSearch: true,
	glovePathFormat: "embeddings/glove.6B.100d_part_{}.txt",
	gloveFileCount: 4,
	prunedGlovePath: "embeddings/enhanced_pruned_vectors.txt",
	similarityThreshold: 0,
	maxVocabSize: 100000,
	lastRebuildIndexTime: null,
	lastExportVocabularyTime: null,
};

export default class QuickSwitcherPlusPlugin extends Plugin {
	miniSearchProvider: MiniSearchProvider;
	titleContainsSearchProvider: TitleContainsSearchProvider;
	semanticSearchProvider: SemanticSearchProvider;
	combinedSearchProvider: CombinedSearchProvider;
	settings: ClauSettings;
	reindexIntervalId: number | null = null;
	selectionMap: Map<string, SearchResult> = new Map();
	public lastMultiSelectQuery: string = "";

	async onload() {
		await this.loadSettings();

		this.miniSearchProvider = new MiniSearchProvider(
			this.app,
			this.settings,
		);
		this.titleContainsSearchProvider = new TitleContainsSearchProvider(
			this.app,
		);
		this.semanticSearchProvider = new SemanticSearchProvider(
			this.app,
			this.settings,
		);

		this.combinedSearchProvider = new CombinedSearchProvider(
			this.miniSearchProvider,
			this.titleContainsSearchProvider,
			this.semanticSearchProvider,
		);

		await this.miniSearchProvider.build();
		this.setupReindexInterval();

		this.addCommand({
			id: "open-clau-minisearch",
			name: "Open Search",
			callback: () => {
				new ClauModal(
					this.app,
					this.combinedSearchProvider,
					this,
					"search? also: , for semantic, ? for private, ! to ignore privacy, space for title, . for fuzzy, -term, -/path",
					this.settings,
				).open();
			},
		});

		this.addCommand({
			id: "rebuild-clau-index",
			name: "Re-build index",
			callback: async () => {
				await this.combinedSearchProvider.build();
				this.settings.lastRebuildIndexTime = Date.now();
				await this.saveSettings();
				new Notice("MiniSearch index has been manually rebuilt.");
			},
		});

		this.addCommand({
			id: "open-clau-multi-select",
			name: "Select files to copy content",
			callback: () => {
				new MultiSelectModal(
					this.app,
					this,
					this.combinedSearchProvider,
					this.selectionMap,
				).open();
			},
		});

		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) {
					this.combinedSearchProvider.add(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) {
					this.combinedSearchProvider.remove(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					this.combinedSearchProvider.update(file);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile) {
					this.combinedSearchProvider.rename(file, oldPath);
				}
			}),
		);

		this.addSettingTab(new ClauSettingTab(this.app, this));
	}

	onunload() {
		if (this.reindexIntervalId !== null) {
			window.clearInterval(this.reindexIntervalId);
		}
	}

	setupReindexInterval() {
		if (this.reindexIntervalId !== null) {
			window.clearInterval(this.reindexIntervalId);
		}

		if (this.settings.reindexInterval > 0) {
			this.reindexIntervalId = window.setInterval(
				async () => {
					console.log(`Clau: Performing periodic re-index.`);
					await this.miniSearchProvider.build();
				},
				this.settings.reindexInterval * 60 * 1000,
			);
			this.registerInterval(this.reindexIntervalId);
		}
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
		// Re-build minisearch index on settings change, semantic is manual
		await this.miniSearchProvider.build();
		this.setupReindexInterval();
	}
}

class ClauSettingTab extends PluginSettingTab {
	plugin: QuickSwitcherPlusPlugin;

	constructor(app: App, plugin: QuickSwitcherPlusPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	private formatTimestamp(timestamp: number | null): string {
		if (!timestamp) {
			return "Never";
		}
		return new Date(timestamp).toLocaleString();
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.createEl("h2", { text: "Clau Settings" });

		// --- Standard Search Settings ---
		new Setting(containerEl)
			.setName("Ignored folders")
			.setDesc("Comma-separated list of folder paths to ignore.")
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

		new Setting(containerEl)
			.setName("Re-index interval (minutes)")
			.setDesc(
				"The interval in minutes to automatically re-index the vault. Set to 0 to disable.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g. 10")
					.setValue(String(this.plugin.settings.reindexInterval))
					.onChange(async (value) => {
						const interval = Number(value);
						if (!isNaN(interval) && interval >= 0) {
							this.plugin.settings.reindexInterval = interval;
							await this.plugin.saveSettings();
						}
					}),
			);

		// --- Semantic Search Settings ---
		containerEl.createEl("h2", { text: "Semantic Search" });

		new Setting(containerEl)
			.setName("Enable Semantic Search")
			.setDesc("Enable or disable the semantic search functionality.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableSemanticSearch)
					.onChange(async (value) => {
						this.plugin.settings.enableSemanticSearch = value;
						await this.plugin.saveSettings();
						this.display(); // Re-render the settings tab
					}),
			);

		const semanticSettingsEl = containerEl.createDiv();
		if (!this.plugin.settings.enableSemanticSearch) {
			semanticSettingsEl.style.opacity = "0.5";
			semanticSettingsEl.style.pointerEvents = "none";
		}

		semanticSettingsEl.createEl("h3", { text: "Desktop / Full Model" });
		new Setting(semanticSettingsEl)
			.setName("GloVe path format")
			.setDesc(
				"Path to GloVe parts, using {} as a placeholder for the number.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g., embeddings/glove_part_{}.txt")
					.setValue(this.plugin.settings.glovePathFormat)
					.onChange(async (value) => {
						this.plugin.settings.glovePathFormat = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(semanticSettingsEl)
			.setName("Number of GloVe file parts")
			.addText((text) =>
				text
					.setPlaceholder("e.g., 4")
					.setValue(String(this.plugin.settings.gloveFileCount))
					.onChange(async (value) => {
						this.plugin.settings.gloveFileCount =
							parseInt(value, 10) || 0;
						await this.plugin.saveSettings();
					}),
			);

		semanticSettingsEl.createEl("h3", { text: "Mobile / Pruned Model" });
		new Setting(semanticSettingsEl)
			.setName("Pruned GloVe file path")
			.setDesc(
				"Path to the single, smaller, pruned vector file for mobile.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g., embeddings/enhanced_pruned.txt")
					.setValue(this.plugin.settings.prunedGlovePath)
					.onChange(async (value) => {
						this.plugin.settings.prunedGlovePath = value;
						await this.plugin.saveSettings();
					}),
			);

		semanticSettingsEl.createEl("h3", {
			text: "Advanced Pruning Settings",
		});
		new Setting(semanticSettingsEl)
			.setName("Similarity threshold")
			.setDesc(
				"Only add neighbors with a similarity score above this value (0 to 1).",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g., 0.6")
					.setValue(String(this.plugin.settings.similarityThreshold))
					.onChange(async (value) => {
						this.plugin.settings.similarityThreshold =
							parseFloat(value) || 0;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(semanticSettingsEl)
			.setName("Max vocabulary size")
			.setDesc(
				"A hard cap on the total number of words in the pruned file.",
			)
			.addText((text) =>
				text
					.setPlaceholder("e.g., 100000")
					.setValue(String(this.plugin.settings.maxVocabSize))
					.onChange(async (value) => {
						this.plugin.settings.maxVocabSize =
							parseInt(value, 10) || 100000;
						await this.plugin.saveSettings();
					}),
			);

		semanticSettingsEl.createEl("h3", { text: "Actions" });
		new Setting(semanticSettingsEl)
			.setName("Reload vector model")
			.setDesc(
				"Applies path changes and loads the appropriate model for your device.",
			)
			.addButton((button) =>
				button.setButtonText("Reload Now").onClick(() => {
					this.plugin.semanticSearchProvider["vectors"] = null;
					this.plugin.semanticSearchProvider.loadVectorModel();
				}),
			);

		new Setting(semanticSettingsEl)
			.setName("Re-build semantic index")
			.setDesc(
				"Re-scans your vault to create the search index. This can be slow.",
			)
			.addButton((button) =>
				button
					.setButtonText("Re-build Now")
					.setWarning()
					.onClick(async () => {
						button.setDisabled(true);
						await this.plugin.semanticSearchProvider.buildIndex();
						this.plugin.settings.lastRebuildIndexTime = Date.now();
						await this.plugin.saveSettings();
						button.setDisabled(false);
						this.display(); // Re-render to show updated timestamp
					}),
			);

		new Setting(semanticSettingsEl)
			.setName("Last Re-build Semantic Index")
			.setDesc(
				this.formatTimestamp(this.plugin.settings.lastRebuildIndexTime),
			);

		new Setting(semanticSettingsEl)
			.setName("Export vault vocabulary")
			.setDesc(
				"Exports a list of all unique words in your vault for external processing.",
			)
			.addButton((button) =>
				button.setButtonText("Export Now").onClick(async () => {
					button.setDisabled(true);
					await exportVaultVocabulary(
						this.plugin.app,
						"embeddings/vault_vocab.txt",
					);
					this.plugin.settings.lastExportVocabularyTime = Date.now();
					await this.plugin.saveSettings();
					button.setDisabled(false);
					this.display(); // Re-render to show updated timestamp
				}),
			);

		new Setting(semanticSettingsEl)
			.setName("Last Export Vault Vocabulary / Pruned File Build")
			.setDesc(
				this.formatTimestamp(
					this.plugin.settings.lastExportVocabularyTime,
				),
			);

		new Setting(semanticSettingsEl)
			.setName("Build enhanced pruned file")
			.setDesc(
				"WARNING: A very slow, long-running process that freezes the app potentially for several hours. Only do this if you really, really, really want to avoid the go script that will take some minutes",
			)
			.addButton((button) =>
				button
					.setButtonText("Build Now")
					.setWarning()
					.onClick(async () => {
						await buildEnhancedPrunedVectors(
							this.plugin.app,
							this.plugin.settings,
						);
						this.plugin.settings.lastExportVocabularyTime =
							Date.now();
						await this.plugin.saveSettings();
						this.display(); // Re-render to show updated timestamp
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

		// Disable input while loading
		this.isLoading = true;
		this.inputEl.disabled = true;

		try {
			return this.searchProvider.search(this.query);
		} finally {
			this.isLoading = false;
			this.inputEl.disabled = false;
			this.inputEl.focus(); // Re-focus the input element
		}
	}

	async renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.classList.add("clau-suggestion-item");
		el.empty();

		// Determine the string to use for highlighting
		const highlightQuery = result.highlightWord || this.query;

		const titleEl = el.createDiv({ cls: "clau-suggestion-title" });
		titleEl.setText(result.title);
		this.highlightRenderedHTML(titleEl, highlightQuery);

		el.createEl("small", {
			text: result.path,
			cls: "clau-suggestion-path",
		});

		if (this.ignorePrivacy) {
			if (result.context) {
				const contextEl = el.createDiv({
					cls: "clau-suggestion-context",
				});
				await MarkdownRenderer.render(
					this.app,
					result.context,
					contextEl,
					result.path,
					this.plugin,
				);
				this.highlightRenderedHTML(contextEl, highlightQuery);
			}
			return;
		}

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
				await MarkdownRenderer.render(
					this.app,
					result.context,
					contextEl,
					result.path,
					this.plugin,
				);
				this.highlightRenderedHTML(contextEl, highlightQuery);
			}
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
			regex.lastIndex = 0;
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

	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
		this.app.workspace.openLinkText(result.path, "", false);
	}
}
