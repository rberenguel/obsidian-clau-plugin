// src/commands.ts
import { Editor, Notice } from "obsidian";
import ClauPlugin from "./main";
import { ClauModal } from "./ui/search-modal";
import { MultiSelectModal } from "./ui/multi-select-modal";
import { VAULT_VIZ_VIEW_TYPE } from "./ui/vault-viz/vault-viz-view";
import { VectorizeModal } from "./ui/vectorize-modal";

export function registerCommands(plugin: ClauPlugin) {
	plugin.addCommand({
		id: "open-clau-minisearch",
		name: "Open Search",
		callback: () => {
			new ClauModal(
				plugin.app,
				plugin.combinedSearchProvider,
				plugin.recentFilesSearchProvider,
				plugin,
				"search? also: , for semantic, ? for private, ! to ignore privacy, space for title, . for fuzzy, -term, -/path",
				plugin.settings,
			).open();
		},
	});

	plugin.addCommand({
		id: "rebuild-clau-index",
		name: "Re-build index",
		callback: async () => {
			await plugin.combinedSearchProvider.build();
			plugin.settings.lastRebuildIndexTime = Date.now();
			await plugin.saveSettings();
			new Notice("MiniSearch index has been manually rebuilt.");
		},
	});

	plugin.addCommand({
		id: "open-clau-multi-select",
		name: "Select files to copy content",
		callback: () => {
			new MultiSelectModal(
				plugin.app,
				plugin,
				plugin.combinedSearchProvider,
				plugin.selectionMap,
			).open();
		},
	});

	plugin.addCommand({
		id: "open-clau-vault-viz",
		name: "Open Vault Visualization",
		callback: async () => {
			plugin.app.workspace.detachLeavesOfType(VAULT_VIZ_VIEW_TYPE);
			const newLeaf = plugin.app.workspace.getLeaf("tab");
			await newLeaf.setViewState({
				type: VAULT_VIZ_VIEW_TYPE,
				active: true,
			});
			plugin.app.workspace.revealLeaf(newLeaf);
		},
	});

	plugin.addCommand({
		id: "vectorize-selected-word",
		name: "Vectorize selected word",
		editorCallback: (editor: Editor) => {
			const selection = editor.getSelection();
			if (!selection.trim()) {
				new Notice("Please select a word to vectorize.");
				return;
			}
			new VectorizeModal(plugin.app, plugin, selection.trim()).open();
		},
	});

	plugin.addCommand({
		id: "generate-vectors-from-file",
		name: "Generate vectors from active file",
		editorCallback: async (editor: Editor) => {
			const file = plugin.app.workspace.getActiveFile();
			if (!file) {
				new Notice("No active file selected.");
				return;
			}
			new Notice(`Generating vectors from ${file.basename}...`);
			const content = await plugin.app.vault.read(file);
			await plugin.semanticSearchProvider.generateVectorsFromFileContent(
				content,
			);
		},
	});
}
