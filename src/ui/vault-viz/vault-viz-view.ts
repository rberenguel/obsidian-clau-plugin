// vault-viz-view.ts
import {
	ItemView,
	WorkspaceLeaf,
	normalizePath,
	setIcon,
	Notice,
} from "obsidian";
import ClauPlugin from "../../main";
import { SearchResult } from "../../search/search";

export const VAULT_VIZ_VIEW_TYPE = "clau-vault-viz-view";

export class VaultVizView extends ItemView {
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
		Object.assign(container.style, {
			width: "100%",
			height: "100%",
			position: "relative",
		});

		const dataPath = `clau-viz/visualization-data.json`;
		if (!(await this.app.vault.adapter.exists(normalizePath(dataPath)))) {
			this.showGenerateButton(container);
			return;
		}

		const titleContainer = container.createDiv({
			cls: "clau-viz-titles-container",
			attr: {
				style: "position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none;",
			},
		});

		this.searchWrapper = container.createDiv({
			cls: "clau-viz-search-wrapper",
			attr: {
				style: "position: fixed; top: 5em; left: 5em; z-index: 10; display: flex; align-items: center; gap: 8px;",
			},
		});
		this.searchInput = this.searchWrapper.createEl("input", {
			type: "text",
			placeholder: "Semantic Search...",
		});
		Object.assign(this.searchInput.style, {
			display: "none",
			border: "1px solid #555",
			backgroundColor: "#333",
			color: "white",
			padding: "5px",
			borderRadius: "3px",
			width: "150px",
		});

		this.searchIcon = this.searchWrapper.createDiv({
			cls: "clau-viz-search-icon",
			attr: { style: "cursor: pointer; padding: 5px;" },
		});
		setIcon(this.searchIcon, "search");

		this.searchIcon.onClickEvent(async () => {
			if (this.searchInput.style.display === "none") {
				const loadingNotice = new Notice(
					"Loading semantic model...",
					0,
				);
				await this.plugin.semanticSearchProvider.getVectors();
				loadingNotice.hide();
				this.searchInput.style.display = "block";
				this.searchInput.focus();
			} else {
				this.searchInput.style.display = "none";
			}
		});

		const tooltipEl = container.createEl("div", {
			attr: {
				style: "position: absolute; display: none; padding: 4px 8px; background-color: rgba(0,0,0,0.8); color: white; border-radius: 4px; pointer-events: none; font-size: 12px;",
			},
		});

		await this.drawPlot(container, tooltipEl, titleContainer);
	}

	private showSearchUI(isLoading: boolean) {
		this.searchIcon.style.opacity = isLoading ? "0.5" : "1";
		this.searchIcon.style.pointerEvents = isLoading ? "none" : "auto";
	}

	showGenerateButton(container: HTMLElement) {
		container.empty();
		const wrapper = container.createDiv({
			attr: {
				style: "display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%;",
			},
		});
		wrapper.createEl("h3", { text: "Visualization Data Not Found" });
		const generateButton = wrapper.createEl("button", {
			text: "Generate Data Now",
			cls: "mod-cta",
		});
		generateButton.onClickEvent(async () => {
			generateButton.setText("Generating...");
			generateButton.disabled = true;
			if (await this.plugin.ensureVizData()) {
				this.draw();
			} else {
				generateButton.setText(
					"Failed to generate data. Check console.",
				);
			}
		});
	}

	async onClose() {
		if (this.pixiApp)
			this.pixiApp.destroy(true, {
				children: true,
				texture: true,
				baseTexture: true,
			});
	}

	async drawPlot(
		container: HTMLElement,
		tooltipEl: HTMLElement,
		titleContainer: HTMLElement,
	) {
		const bundlePath = `${this.app.vault.configDir}/plugins/clau/viz-bundle.js`;
		if (!(await this.app.vault.adapter.exists(normalizePath(bundlePath)))) {
			container.setText(`Visualization bundle not found.`);
			return;
		}

		const script = container.createEl("script");
		script.src = this.app.vault.adapter.getResourcePath(
			normalizePath(bundlePath),
		);
		script.onload = async () => {
			const updateTitles = (viewport: any, points: any[]) => {
				const isZoomedIn = viewport.scale.x > this.ZOOM_THRESHOLD;
				if (!isZoomedIn) {
					this.titleElements.forEach(
						(el) => (el.style.display = "none"),
					);
					return;
				}

				if (this.titleElements.length === 0) {
					points.forEach((p) => {
						const titleEl = titleContainer.createDiv({
							text: p.title,
							cls: "clau-viz-title",
							attr: {
								style: "position: absolute; color: #FFFFFF; font-size: 10px; white-space: nowrap; transform: translate(-50%, -120%); pointer-events: none; text-shadow: 1px 1px 2px #000000;",
							},
						});
						this.titleElements.push(titleEl);
					});
				}

				points.forEach((p, i) => {
					const titleEl = this.titleElements[i];
					const screenPos = viewport.toScreen(p.x, p.y);
					const isVisible =
						screenPos.x > 0 &&
						screenPos.x < container.offsetWidth &&
						screenPos.y > 0 &&
						screenPos.y < container.offsetHeight;
					titleEl.style.display = isVisible ? "block" : "none";
					if (isVisible) {
						titleEl.style.left = `${screenPos.x}px`;
						titleEl.style.top = `${screenPos.y}px`;
					}
				});
			};

			// Pass the UMAP settings to the visualization script
			const vizSettings = {
				umapNNeighbors: this.plugin.settings.umapNNeighbors,
				umapMinDist: this.plugin.settings.umapMinDist,
				umapSpread: this.plugin.settings.umapSpread, // Add this line
			};

			const vizApp = await (window as any).renderClauVisualization(
				container,
				tooltipEl,
				this.app,
				this.triggerVizSearch.bind(this),
				(isLoading: boolean) => this.showSearchUI(isLoading),
				updateTitles,
				vizSettings,
			);
			this.pixiApp = vizApp.pixiApp;

			this.searchInput.addEventListener("input", (e) => {
				const query = (e.target as HTMLInputElement).value;
				if (vizApp?.search) vizApp.search(query);
			});

			if (vizApp?.viewport && vizApp.allPointsGfx) {
				updateTitles(vizApp.viewport, vizApp.allPointsGfx);
			}
		};
	}

	private async triggerVizSearch(
		query: string,
		topK: number = 50,
	): Promise<SearchResult[]> {
		const isSemantic = query.startsWith(",");
		if (isSemantic) {
			return this.plugin.semanticSearchProvider.search(
				query.substring(1),
				topK,
			);
		} else {
			return this.plugin.combinedSearchProvider.search(query);
		}
	}
}
