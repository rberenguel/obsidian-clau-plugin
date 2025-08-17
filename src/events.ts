// src/events.ts
import { TFile } from "obsidian";
import ClauPlugin from "./main";

export function registerEvents(plugin: ClauPlugin) {
	plugin.registerEvent(
		plugin.app.vault.on("create", (file) => {
			if (file instanceof TFile)
				plugin.combinedSearchProvider.add(file);
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("delete", (file) => {
			if (file instanceof TFile)
				plugin.combinedSearchProvider.remove(file);
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("modify", (file) => {
			if (file instanceof TFile)
				plugin.combinedSearchProvider.update(file);
		}),
	);
	plugin.registerEvent(
		plugin.app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile)
				plugin.combinedSearchProvider.rename(file, oldPath);
		}),
	);
}
