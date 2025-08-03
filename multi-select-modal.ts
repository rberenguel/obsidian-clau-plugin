import { App, Notice, SuggestModal, TFile } from 'obsidian';
import { ISearchProvider } from './search-provider';
import { SearchResult } from './search';

export class MultiSelectModal extends SuggestModal<SearchResult> {
	constructor(
		app: App,
		private searchProvider: ISearchProvider,
		private selectionMap: Map<string, SearchResult> // Receive the shared map
	) {
		super(app);
		this.setPlaceholder("Search files to add to selection...");
	}

	/**
	 * Helper to refresh the modal UI while preserving the user's search query.
	 * Now checks for mobile to avoid problematic auto-focusing.
	 */
	private refresh() {
		const query = this.inputEl.value;
		this.open();
		this.inputEl.value = query;
        const isMobile = (this.app as any).isMobile
		if (!isMobile) {
			this.inputEl.focus();
		}
	}

	getSuggestions(query: string): Promise<SearchResult[]> {
		return this.searchProvider.search(query);
	}

	renderSuggestion(result: SearchResult, el: HTMLElement) {
		el.createDiv({ text: result.title });
		el.createEl("small", { text: result.path, cls: "clau-suggestion-path" });
		if (this.selectionMap.has(result.path)) {
			el.addClass('is-selected');
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

		// Use a timeout to reopen the modal after it closes on mobile.
        // AAAA: this needs to be only on mobile?
		setTimeout(() => (this.app as any).commands.executeCommandById("clau:open-clau-multi-select"), 50);
	}

	onOpen() {
		super.onOpen();
		const { modalEl } = this;

		// Remove the container from the previous render to prevent duplication
		modalEl.querySelector('.clau-multi-select-container')?.remove();
		const container = modalEl.createDiv({ cls: 'clau-multi-select-container' });

		// --- Display a list of currently selected files ---
		if (this.selectionMap.size > 0) {
			const listContainer = container.createDiv({ cls: 'clau-selection-list' });
			listContainer.createEl('div', { text: `Selected (${this.selectionMap.size}):`, cls: 'clau-selection-header' });

			for (const result of this.selectionMap.values()) {
				const itemEl = listContainer.createDiv({ cls: 'clau-selection-item' });
				itemEl.createSpan({ text: result.title, cls: 'clau-selection-item-title' });

				const removeBtn = itemEl.createEl('button', {
					text: 'Remove',
					cls: 'clau-selection-item-remove-btn'
				});

				removeBtn.onClickEvent((evt) => {
					evt.stopPropagation();
					this.selectionMap.delete(result.path);
					this.refresh();
				});
			}
		}

		// --- Global action buttons ---
		const buttonContainer = container.createDiv({ cls: 'multi-select-buttons' });

		const copyButton = buttonContainer.createEl('button', {
			text: `Copy Content of ${this.selectionMap.size} File(s)`,
			cls: 'mod-cta'
		});
		copyButton.onClickEvent(() => this.copyContent());

		const clearAllButton = buttonContainer.createEl('button', { text: 'Clear All' });
		clearAllButton.onClickEvent(() => {
			this.selectionMap.clear();
			this.refresh();
		});

		if (this.selectionMap.size === 0) {
			copyButton.disabled = true;
			clearAllButton.disabled = true;
		}
	}

	private async copyContent() {
		if (this.selectionMap.size === 0) {
			new Notice("No files selected.");
			return;
		}

		let combinedContent = "";
		let fileCount = 0;
		for (const result of this.selectionMap.values()) {
			const file = this.app.vault.getAbstractFileByPath(result.path) as TFile;
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