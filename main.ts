import {
	App,
	Plugin,
	SuggestModal,
	TFile,
	MarkdownRenderer,
	PluginSettingTab,
	Setting,
	Notice,
	ItemView,
	WorkspaceLeaf,
	normalizePath,
	setIcon
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
import { getDocumentVector } from "./model";

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

export const VAULT_VIZ_VIEW_TYPE = "clau-vault-viz-view";

class VaultVizView extends ItemView {
    private pixiApp: any;
    private plugin: ClauPlugin;
    private searchWrapper: HTMLElement;
    private searchInput: HTMLInputElement;
    private searchIcon: HTMLElement;
private titleElements: HTMLElement[] = [];
    private ZOOM_THRESHOLD = 10;
    constructor(leaf: WorkspaceLeaf, plugin: ClauPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType() {
        return VAULT_VIZ_VIEW_TYPE;
    }

    getDisplayText() {
        return "Vault Visualization";
    }

    async onOpen() {
        this.draw();
    }

 async draw() {
        const container = this.containerEl.children[1] as HTMLElement;
        container.empty();
        container.style.width = '100%';
        container.style.height = '100%';
        container.style.position = 'relative';

        const dataPath = `clau-viz/visualization-data.json`;
        if (!(await this.app.vault.adapter.exists(normalizePath(dataPath)))) {
            this.showGenerateButton(container);
            return;
        }
        
        const titleContainer = container.createDiv({ cls: 'clau-viz-titles-container' });
        titleContainer.style.position = 'absolute';
        titleContainer.style.top = '0';
        titleContainer.style.left = '0';
        titleContainer.style.width = '100%';
        titleContainer.style.height = '100%';
        titleContainer.style.pointerEvents = 'none';

        const vizContainer = this.containerEl.children[1] as HTMLElement;
        this.searchWrapper = vizContainer.createDiv({ cls: 'clau-viz-search-wrapper' });
        this.searchWrapper.style.position = 'fixed';
        this.searchWrapper.style.top = '5em';
        this.searchWrapper.style.left = '5em';
        this.searchWrapper.style.zIndex = '10';
        this.searchWrapper.style.display = 'flex';
        this.searchWrapper.style.alignItems = 'center';
        this.searchWrapper.style.gap = '8px';

        this.searchInput = this.searchWrapper.createEl('input', { type: 'text', placeholder: 'Semantic Search...' });
        this.searchInput.style.display = 'none';
        this.searchInput.style.border = '1px solid #555';
        this.searchInput.style.backgroundColor = '#333';
        this.searchInput.style.color = 'white';
        this.searchInput.style.padding = '5px';
        this.searchInput.style.borderRadius = '3px';
        this.searchInput.style.width = '150px';

        this.searchIcon = this.searchWrapper.createDiv({ cls: 'clau-viz-search-icon' });
        setIcon(this.searchIcon, "search");
        this.searchIcon.style.cursor = 'pointer';
        this.searchIcon.style.padding = '5px';

        this.searchIcon.onClickEvent(async () => {
            const isHidden = this.searchInput.style.display === 'none';
            if (isHidden) {
                const loadingNotice = new Notice("Loading semantic model...", 0);
                await this.plugin.semanticSearchProvider.getVectors();
                loadingNotice.hide();
                this.searchInput.style.display = 'block';
                this.searchInput.focus();
            } else {
                this.searchInput.style.display = 'none';
            }
        });

        const tooltipEl = container.createEl('div');
        tooltipEl.style.position = 'absolute';
        tooltipEl.style.display = 'none';
        tooltipEl.style.padding = '4px 8px';
        tooltipEl.style.backgroundColor = 'rgba(0,0,0,0.8)';
        tooltipEl.style.color = 'white';
        tooltipEl.style.borderRadius = '4px';
        tooltipEl.style.pointerEvents = 'none';
        tooltipEl.style.fontSize = '12px';

        await this.drawPlot(container, tooltipEl, titleContainer);
    }
    
    private showSearchUI(isLoading: boolean) {
        if (isLoading) {
            this.searchIcon.style.opacity = '0.5';
            this.searchIcon.style.pointerEvents = 'none';
            
        } else {
            this.searchIcon.style.opacity = '1';
            this.searchIcon.style.pointerEvents = 'auto';
            
        }
    }
    
    showGenerateButton(container: HTMLElement) {
        container.empty();
        const wrapper = container.createDiv({
            attr: { style: 'display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;' }
        });
        wrapper.createEl('h3', { text: "Visualization Data Not Found" });
        const generateButton = wrapper.createEl('button', { text: "Generate Data Now", cls: "mod-cta" });
        
        generateButton.onClickEvent(async () => {
            generateButton.setText("Generating...");
            generateButton.disabled = true;
            const newDataCreated = await this.plugin.ensureVizData();
            if (newDataCreated) {
                this.draw();
            } else {
                generateButton.setText("Failed to generate data. Check console.");
            }
        });
    }

    async onClose() {
        if (this.pixiApp) {
            this.pixiApp.destroy(true, { children: true, texture: true, baseTexture: true });
        }
    }

async drawPlot(container: HTMLElement, tooltipEl: HTMLElement, titleContainer: HTMLElement) {
        const bundlePath = `${this.app.vault.configDir}/plugins/clau/viz-bundle.js`;

        if (!(await this.app.vault.adapter.exists(normalizePath(bundlePath)))) {
            container.setText(`Visualization bundle not found.`);
            return;
        }

        const script = container.createEl("script");
        script.src = this.app.vault.adapter.getResourcePath(normalizePath(bundlePath));
        script.onload = async () => {
            const updateTitles = (viewport: any, points: any[]) => {
                const isZoomedIn = viewport.scale.x > this.ZOOM_THRESHOLD;
                if (!isZoomedIn) {
                    this.titleElements.forEach(el => el.style.display = 'none');
                    return;
                }
                
                if (this.titleElements.length === 0) {
                    points.forEach((p, i) => {
                        const titleEl = titleContainer.createDiv({ text: p.title, cls: 'clau-viz-title' });
                        titleEl.style.position = 'absolute';
                        titleEl.style.color = '#FFFFFF';
                        titleEl.style.fontSize = '10px';
                        titleEl.style.whiteSpace = 'nowrap';
                        titleEl.style.transform = 'translate(-50%, -120%)';
                        titleEl.style.pointerEvents = 'none';
                        titleEl.style.textShadow = '1px 1px 2px #000000';
                        this.titleElements.push(titleEl);
                    });
                }
                
                points.forEach((p, i) => {
                    const titleEl = this.titleElements[i];
                    const screenPos = viewport.toScreen(p.x, p.y);
                    
                    const isVisible = screenPos.x > 0 && screenPos.x < container.offsetWidth &&
                                      screenPos.y > 0 && screenPos.y < container.offsetHeight;
                                      
                    if (isVisible) {
                        titleEl.style.display = 'block';
                        titleEl.style.left = `${screenPos.x}px`;
                        titleEl.style.top = `${screenPos.y}px`;
                    } else {
                        titleEl.style.display = 'none';
                    }
                });
            };

            const vizApp = await (window as any).renderClauVisualization(container, tooltipEl, this.app, this.triggerVizSearch.bind(this), (isLoading: boolean) => this.showSearchUI(isLoading), updateTitles);
            this.pixiApp = vizApp.pixiApp;

            // FIX: Wire the input event listener to the vizApp's search function
            this.searchInput.addEventListener('input', (e) => {
                const query = (e.target as HTMLInputElement).value;
                if (vizApp && vizApp.search) {
                    vizApp.search(query);
                }
            });
            
            if (vizApp.viewport && vizApp.allPointsGfx) {
                updateTitles(vizApp.viewport, vizApp.allPointsGfx);
            }
        };
    }
   private async triggerVizSearch(query: string, topK: number = 50): Promise<SearchResult[]> {
        // Semantic search is an exclusive search mode in the combined provider
        const isSemantic = query.startsWith(',');
        if (isSemantic) {
            // The semantic search provider needs to be called directly with the topK parameter
            return this.plugin.semanticSearchProvider.search(query.substring(1), topK);
        } else {
            // All other searches use the existing combined logic (minisearch + title-contains)
            return this.plugin.combinedSearchProvider.search(query);
        }
    }
}

export default class ClauPlugin extends Plugin {
	miniSearchProvider: MiniSearchProvider;
	titleContainsSearchProvider: TitleContainsSearchProvider;
	semanticSearchProvider: SemanticSearchProvider;
	combinedSearchProvider: CombinedSearchProvider;
	settings: ClauSettings;
	reindexIntervalId: number | null = null;
	selectionMap: Map<string, SearchResult> = new Map();
	public lastMultiSelectQuery: string = "";

	async onload() {
		this.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
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

        this.registerView(
        VAULT_VIZ_VIEW_TYPE,
        (leaf) => new VaultVizView(leaf, this)
    );

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

this.addCommand({
        id: 'open-clau-vault-viz',
        name: 'Open Vault Visualization',
        callback: async () => {
            this.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
            const newLeaf = this.app.workspace.getLeaf('tab');
            await newLeaf.setViewState({
                type: VAULT_VIZ_VIEW_TYPE,
                active: true,
            });
            this.app.workspace.revealLeaf(newLeaf);
        }
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

    async ensureVizData(): Promise<boolean> {
    const vizFolderName = "clau-viz";
    const dataPath = `${vizFolderName}/visualization-data.json`;
    if (await this.app.vault.adapter.exists(normalizePath(dataPath))) {
         return false;
    }

    new Notice("Generating new visualization data...");
    const vectors = await this.semanticSearchProvider.getVectors();
    if (!vectors) {
        new Notice("Vectors not loaded!");
        return false;
    }

    const files = this.app.vault.getMarkdownFiles();
    const exportData = [];
    for (const file of files) {
        const content = await this.app.vault.cachedRead(file);
        const embedding = getDocumentVector(content, vectors);
        if (embedding) {
            exportData.push({ path: file.path, title: file.basename, embedding });
        }
    }
    await this.app.vault.adapter.write(normalizePath(dataPath), JSON.stringify(exportData));
    new Notice(`Data for ${exportData.length} notes exported.`);
    return true;
}

	onunload() {
		this.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
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
		await this.miniSearchProvider.build();
		this.setupReindexInterval();
	}
}

class ClauSettingTab extends PluginSettingTab {
	plugin: ClauPlugin;

	constructor(app: App, plugin: ClauPlugin) {
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

		this.isLoading = true;
		this.inputEl.disabled = true;

		try {
			return this.searchProvider.search(this.query);
		} finally {
			this.isLoading = false;
			this.inputEl.disabled = false;
			this.inputEl.focus();
		}
	}

	async renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.classList.add("clau-suggestion-item");
		el.empty();

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