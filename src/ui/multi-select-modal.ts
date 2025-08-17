import {
	App,
	Notice,
	SuggestModal,
	TFile,
	setIcon,
	setTooltip,
} from "obsidian";
import { ISearchProvider } from "../search/search-provider";
import { SearchResult } from "../search/search";
import ClauPlugin from "../main";

export class MultiSelectModal extends SuggestModal<SearchResult> {
	constructor(
		app: App,
		private plugin: ClauPlugin,
		private searchProvider: ISearchProvider,
		private selectionMap: Map<string, SearchResult>, // Receive the shared map
	) {
		super(app);
		this.setPlaceholder("Search files to add to selection...");
	}

	getSuggestions(query: string): Promise<SearchResult[]> {
		return this.searchProvider.search(query);
	}

	renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.createDiv({ text: result.title });
		el.createEl("small", {
			text: result.path,
			cls: "clau-suggestion-path",
		});
		if (this.selectionMap.has(result.path)) {
			el.addClass("is-selected");
		}
	}

	/**
	 * Toggles file selection.
	 * On mobile, the modal tends to close on selection. We use a setTimeout
	 * to reopen it immediately after it has closed.
	 */
	onChooseSuggestion(result: SearchResult, evt: MouseEvent | KeyboardEvent) {
		if (this.selectionMap.has(result.path)) {
			this.selectionMap.delete(result.path);
		} else {
			this.selectionMap.set(result.path, result);
		}
		this.plugin.lastMultiSelectQuery = this.inputEl.value;
		// Use a timeout to reopen the modal after it closes on mobile.
		// TODO: this needs to be only on mobile? It works on desktop, but…
		setTimeout(
			() =>
				(this.app as any).commands.executeCommandById(
					"clau:open-clau-multi-select",
				),
			50,
		);
	}

	onOpen() {
		super.onOpen();
		if (this.plugin.lastMultiSelectQuery) {
			this.inputEl.value = this.plugin.lastMultiSelectQuery;
			this.inputEl.dispatchEvent(new Event("input"));
		}
		const { modalEl } = this;

		// Remove the container from the previous render to prevent duplication
		modalEl.querySelector(".clau-multi-select-container")?.remove();
		const container = modalEl.createDiv({
			cls: "clau-multi-select-container",
		});

		// --- UI Elements ---
		const listContainer = container.createDiv({
			cls: "clau-selection-list",
		});
		const headerEl = listContainer.createEl("div", {
			cls: "clau-selection-header",
		});
		const itemsContainer = listContainer.createDiv(); // Div to hold the item rows

		const buttonContainer = container.createDiv({
			cls: "multi-select-buttons",
		});
		const copyButton = buttonContainer.createEl("button", {
			cls: "mod-cta",
		});
		const clearAllButton = buttonContainer.createEl("button", {
			text: "Clear All",
			cls: "clau-clear-all-btn",
		});

		setIcon(clearAllButton, "circle-x");
		setTooltip(clearAllButton, "Clear the copy list");

		// --- Helper to deselect item in the main suggestion list ---
		const deselectSuggestion = (path: string) => {
			const suggesterEl = this.containerEl.querySelector(
				".suggestion-container",
			);
			if (!suggesterEl) return;
			suggesterEl
				.querySelectorAll(".suggestion-item")
				.forEach((itemEl) => {
					const pathEl = itemEl.querySelector(
						"small.clau-suggestion-path",
					);
					if (pathEl?.textContent === path) {
						itemEl.removeClass("is-selected");
					}
				});
		};

		// --- Helper to update counts and button states ---
		const updateUI = () => {
			const count = this.selectionMap.size;
			const hasSelection = count > 0;

			headerEl.setText(`Selected (${count}):`);
			copyButton.setText(`Copy Content of ${count} File(s)`);
			listContainer.style.display = hasSelection ? "block" : "none";
			copyButton.disabled = !hasSelection;
			clearAllButton.disabled = !hasSelection;
		};

		// --- Populate selected items list ---
		for (const result of this.selectionMap.values()) {
			const itemEl = itemsContainer.createDiv({
				cls: "clau-selection-item",
			});
			itemEl.createSpan({
				text: result.title,
				cls: "clau-selection-item-title",
			});

			const removeBtn = itemEl.createEl("button", {
				text: "", //AAAA
				cls: "clau-selection-item-remove-btn",
			});
			setIcon(removeBtn, "x");
			setTooltip(removeBtn, "Remove this file from the copy list");

			removeBtn.onClickEvent((evt) => {
				evt.stopPropagation();
				this.selectionMap.delete(result.path);
				itemEl.remove(); // Remove the row from the DOM
				updateUI();
				deselectSuggestion(result.path);
			});
		}

		copyButton.onClickEvent(() => this.copyContent());
		clearAllButton.onClickEvent(() => {
			const pathsToDeselect = Array.from(this.selectionMap.keys());
			this.selectionMap.clear();
			itemsContainer.empty(); // Remove all item rows
			updateUI();
			pathsToDeselect.forEach(deselectSuggestion);
			this.plugin.lastMultiSelectQuery = "";
		});

		updateUI();
	}

	private async copyContent() {
		if (this.selectionMap.size === 0) {
			new Notice("No files selected.");
			return;
		}
		this.plugin.lastMultiSelectQuery = "";
		let combinedContent = "";
		let fileCount = 0;
		for (const result of this.selectionMap.values()) {
			const file = this.app.vault.getAbstractFileByPath(
				result.path,
			) as TFile;
			if (file) {
				const content = await this.app.vault.cachedRead(file);
				if (fileCount > 0) combinedContent += "\n\n---\n\n";
				combinedContent += `--- FILE: ${file.path} ---\n${content}`;
				fileCount++;
			}
		}

		await navigator.clipboard.writeText(combinedContent);
		new Notice(`Copied content of ${fileCount} file(s).`);
		this.selectionMap.clear();
		this.close();
	}
}
