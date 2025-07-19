# Clau

A quick switcher plugin for Obsidian with fuzzy search across all your notes.

## Features

- **Fuzzy Search:** Quickly find notes by title or content using fuzzy matching.
- **Content Context:** See a snippet of the matching content directly in the search results.
- **Multiple Search Providers:** Choose between a fast, in-memory MiniSearch index or Obsidian's native search engine.
- **Real-time Indexing:** Automatically updates the search index when notes are created, modified, or deleted.

## How to Use

1.  **Open Search:** Use the command palette (`Ctrl/Cmd + P`) and search for "Clau: Open Search".
2.  **Type your query:**
    *   **Private Search (`?`):** Start your query with a question mark to hide all context previews.
    *   **Ignore Privacy (`!`):** Start your query with an exclamation mark to show all context previews, even for notes in private folders or with private tags.
    *   **Title-Only Search (` `):** Start your query with a space to search only note titles.
    *   **Fuzzy Search (`.`):** Start your query with a dot to enable typo-tolerant fuzzy matching.
    *   **Term Exclusion (`-`):** Add a hyphen before a word to exclude notes containing it.
    *   **Path Exclusion (`-/`):** Add `-/` before a path to exclude notes from that folder.
    *   **Modifiers can be combined:** For example, `! . project spec -wip` will perform a fuzzy, title-only search for "project spec" while ignoring privacy and excluding notes with "wip".
3.  **Re-build index:** If you encounter issues with search results, you can manually rebuild the index by searching for "Clau: Re-build index" in the command palette.

## Why not use [OmniSearch](https://github.com/scambier/obsidian-omnisearch)?

Tweaking your own plugin is kind of fun, also _sometimes_ I need plugins with the minimum amount of dependencies so I can confirm the code is safe. This is small enough I can check everything manually, and does _exactly_ what I want.

## Installation

### Manual Installation

1.  Download the latest release files (`main.js`, `styles.css`, `manifest.json`) from the **Releases** page of the GitHub repository (or the zip file, contains all of these).
2.  Find your Obsidian vault's plugins folder by going to `Settings` > `About` and clicking `Open` next to `Override config folder`. Inside that folder, navigate into the `plugins` directory.
3.  Create a new folder named `clau`.
4.  Copy the `main.js`, `manifest.json`, and `styles.css` files into the new `clau` folder.
5.  In Obsidian, go to **Settings** > **Community Plugins**.
6.  Make sure "Restricted mode" is turned off. Click the "Reload plugins" button.
7.  Find "Clau" in the list and **enable** it.
