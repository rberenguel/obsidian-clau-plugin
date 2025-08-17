// heading-filter.ts
import { App, MarkdownView } from "obsidian";
import {
	ViewPlugin,
	EditorView,
	ViewUpdate,
	Decoration,
	DecorationSet,
	PluginValue,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { Extension } from "@codemirror/state";

const HIDDEN_CLASS = "clau-hidden";

type HeadingInfo = { pos: number; level: number; text: string };

// The plugin now contains all state and logic.
export class HeadingFilterViewPlugin implements PluginValue {
	decorations: DecorationSet;
	isActive = false;
	searchBuffer = "";
	manager: HeadingFilterManager | null = null;

	// A static property to hold the single instance for easy access.
	public static instance: HeadingFilterViewPlugin | null = null;

	constructor(private view: EditorView) {
		HeadingFilterViewPlugin.instance = this;
		this.decorations = this.buildDecorations();
	}

	update(update: ViewUpdate) {
		// The update method is now only needed if the document itself changes while active.
		if (this.isActive && update.docChanged) {
			this.decorations = this.buildDecorations();
		}
	}

	destroy() {
		this.manager?.deactivate();
		HeadingFilterViewPlugin.instance = null;
	}

	// This is called from the manager to start the filter.
	activate() {
		this.isActive = true;
		// The keydown handler is now managed by this plugin.
		document.body.addEventListener("keydown", this.handleKeyDown, true);
	}

	// This is called from the manager to stop the filter.
	deactivate() {
		this.isActive = false;
		this.searchBuffer = "";
		document.body.removeEventListener("keydown", this.handleKeyDown, true);
		// Trigger one last update to clear all decorations.
		this.updateDecorations();
	}

	// We use a bound instance of the keydown handler.
	private handleKeyDown = (event: KeyboardEvent): void => {
		if (!this.isActive) return;

		// We must stop the event here to prevent it from reaching the editor.
		event.preventDefault();
		event.stopImmediatePropagation();

		if (event.key === "Escape") {
			this.manager?.deactivate();
			return;
		}

		let needsUpdate = false;
		if (event.key === "Backspace") {
			this.searchBuffer = this.searchBuffer.slice(0, -1);
			needsUpdate = true;
		} else if (
			event.key.length === 1 &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey
		) {
			this.searchBuffer += event.key;
			needsUpdate = true;
		}

		if (needsUpdate) {
			this.updateDecorations();
		}
	};

	// A central method to trigger decoration updates.
	updateDecorations() {
		this.decorations = this.buildDecorations();
		// Dispatch an empty transaction to force CodeMirror to re-read decorations.
		this.view.dispatch({});
	}

	buildDecorations(): DecorationSet {
		if (!this.isActive || this.searchBuffer.length === 0) {
			return Decoration.none;
		}
		const builder = new RangeSetBuilder<Decoration>();
		const query = this.searchBuffer.toLowerCase();

		const headings: HeadingInfo[] = [];
		const headingsByPos = new Map<number, HeadingInfo>();

		for (let i = 1; i <= this.view.state.doc.lines; i++) {
			const line = this.view.state.doc.line(i);
			const match = line.text.match(/^(#+)\s*(.*)/);
			if (match) {
				const heading: HeadingInfo = {
					pos: line.from,
					level: match[1].length,
					text: match[2].toLowerCase().trim(),
				};
				headings.push(heading);
				headingsByPos.set(line.from, heading);
			}
		}

		const visibility = new Map<number, boolean>();
		const shouldShowContent = new Map<number, boolean>();

		for (const h of headings) {
			if (h.text.includes(query)) {
				visibility.set(h.pos, true);
				shouldShowContent.set(h.pos, true);
				const children = this.getChildren(h, headings);
				for (const child of children) {
					visibility.set(child.pos, true);
					shouldShowContent.set(child.pos, true);
				}
			}
		}

		for (const h of headings) {
			if (visibility.get(h.pos)) {
				let parent = this.getParent(h, headings);
				while (parent) {
					if (!visibility.get(parent.pos)) {
						visibility.set(parent.pos, true);
					}
					parent = this.getParent(parent, headings);
				}
			}
		}

		let currentHeading: HeadingInfo | undefined = undefined;
		for (let i = 1; i <= this.view.state.doc.lines; i++) {
			const line = this.view.state.doc.line(i);
			const headingInfo = headingsByPos.get(line.from);

			let hideLine = false;

			if (headingInfo) {
				currentHeading = headingInfo;
				if (!visibility.get(currentHeading.pos)) {
					hideLine = true;
				}
			} else if (currentHeading) {
				if (
					!visibility.get(currentHeading.pos) ||
					!shouldShowContent.get(currentHeading.pos)
				) {
					hideLine = true;
				}
			} else {
				hideLine = true;
			}

			if (hideLine) {
				builder.add(
					line.from,
					line.from,
					Decoration.line({ class: HIDDEN_CLASS }),
				);
			}
		}

		return builder.finish();
	}

	getParent(h: HeadingInfo, headings: HeadingInfo[]) {
		const hIndex = headings.findIndex((x) => x.pos === h.pos);
		for (let i = hIndex - 1; i >= 0; i--) {
			if (headings[i].level < h.level) {
				return headings[i];
			}
		}
		return null;
	}

	getChildren(h: HeadingInfo, headings: HeadingInfo[]) {
		const children = [];
		const hIndex = headings.findIndex((x) => x.pos === h.pos);
		for (let i = hIndex + 1; i < headings.length; i++) {
			if (headings[i].level > h.level) {
				children.push(headings[i]);
			} else {
				break;
			}
		}
		return children;
	}
}

// The Manager is now just a thin wrapper to activate/deactivate the plugin.
export class HeadingFilterManager {
	private statusBar: HTMLElement | null = null;
	public static pluginSpec: Extension = ViewPlugin.fromClass(
		HeadingFilterViewPlugin,
		{
			decorations: (v) => v.decorations,
		},
	);

	constructor(private app: App) {}

	public activate() {
		const instance = HeadingFilterViewPlugin.instance;
		if (!instance) return;

		instance.manager = this;

		this.showFilterStatusBar();
		instance.activate();
		this.updateStatus(instance);

		const originalUpdateDecorations =
			instance.updateDecorations.bind(instance);
		instance.updateDecorations = () => {
			originalUpdateDecorations();
			this.updateStatus(instance);
		};

		document.body.addEventListener("click", this.handleOutsideClick, true);
	}

	private handleOutsideClick = (event: MouseEvent): void => {
		const target = event.target as HTMLElement;
		if (target && target.closest(".clau-heading-filter-status")) {
			return;
		}
		this.deactivate();
	};

	public deactivate() {
		const instance = HeadingFilterViewPlugin.instance;
		if (instance && instance.isActive) {
			instance.deactivate();
		}
		if (this.statusBar) {
			this.statusBar.remove();
			this.statusBar = null;
		}
		document.body.removeEventListener(
			"click",
			this.handleOutsideClick,
			true,
		);
		if (instance) {
			instance.manager = null;
		}
	}

	private updateStatus(pluginInstance: HeadingFilterViewPlugin) {
		if (this.statusBar) {
			this.statusBar.setText(
				`Filter headings: ${pluginInstance.searchBuffer}`,
			);
		}
	}

	private showFilterStatusBar() {
		if (this.statusBar) return;
		this.statusBar = document.body.createEl("div", {
			cls: "clau-heading-filter-status",
		});
	}
}
