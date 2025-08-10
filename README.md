# Clau

A quick switcher plugin for Obsidian with fuzzy search across all your notes.

## Features

- **Instant Search:** Searches as you type.
- **Fuzzy Search:** Quickly find notes by title or content using fuzzy matching.
- **Content Context:** See a snippet of the matching content directly in the search results.
- **Multiple Search Providers:** Choose between a fast, in-memory MiniSearch index or Obsidian's native search engine.
- **Real-time Indexing:** Automatically updates the search index when notes are created, modified, or deleted.
- **Semantic Search:** Understands the meaning of your query to find relevant notes, even if exact keywords aren't present.

### Some screenshots

#### Private search

![](https://raw.githubusercontent.com/rberenguel/obsidian-clau-plugin/main/media/clau-private.png)

#### Semantic search

![](https://raw.githubusercontent.com/rberenguel/obsidian-clau-plugin/main/media/clau-semantic.png)

## How to Use

1.  **Open Search:** Use the command palette (`Ctrl/Cmd + P`) and search for "Clau: Open Search".
2.  **Type your query:**
    - **Private Search (`?`):** Start your query with a question mark to hide all context previews. _This needs to be first_.
    - **Ignore Privacy (`!`):** Start your query with an exclamation mark to show all context previews, even for notes in private folders or with private tags. _This needs to be first_.
    - **Title-Only Search (` `):** Start your query with a space to search only note titles.
    - **Fuzzy Search (`.`):** Start your query with a dot to enable typo-tolerant fuzzy matching. _This needs to be first_. Does not combine with semantic search, and presenting context depends a lot on the search term.
    - **Concatenated Title Search:** Titles with no spaces (e.g., `thisHasNoSpaces`) can now be found by searching for parts of the concatenated words (e.g., `hasNo`). This works automatically for all title searches.
    - **Term Exclusion (`-`):** Add a hyphen before a word to exclude notes containing it. Does not combine with semantic search.
    - **Path Exclusion (`-/`):** Add `-/` before a path to exclude notes from that folder. Does not combine with semantic search (yet).
    - **Modifiers can be combined:** For example, `! . project spec -wip` will perform a fuzzy, title-only search for "project spec" while ignoring privacy and excluding notes with "wip". Note that order is important for most of these, and semantic search does not work yet with all of them.
    - **Semantic Search Integration:** When enabled in settings, semantic search automatically enhances your search results by finding notes conceptually similar to your query, even if they don't contain the exact words. You can enable or disable this feature and configure its models in the plugin settings under "Semantic Search".
3.  **Re-build index:** If you encounter issues with search results, you can manually rebuild the index by searching for "Clau: Re-build index" in the command palette. Index is rebuilt automatically periodically.

### Copy Content from Multiple Files

This feature allows you to select multiple notes and copy their content to the clipboard, formatted for use as a context in a Large Language Model (LLM) prompt.

#### How to Use

1.  Open the command palette and run the command: `Select files to copy content`.
2.  Use the search bar to find the files you want to include. Click on a file in the search results to add it to your selection.
3.  Selected files appear in a list at the bottom of the modal. You can manage your selection here:
    - Click the **Remove** button next to any file to exclude it.
    - Click **Clear All** to empty your selection.
4.  Once you are satisfied with the list, click the **Copy Content of X File(s)** button.

This will copy the formatted content to your clipboard and close the modal.

#### Output Format

The content of the selected files is concatenated into a single block of text. Each file is clearly delineated with a header containing its path, making it easy for an LLM to distinguish between different sources of information.

The format is as follows:

```
--- FILE: path/to/first-note.md ---
Content of the first note...

---

--- FILE: path/to/second-note.md ---
Content of the second note...
```

## Why not use [OmniSearch](https://github.com/scambier/obsidian-omnisearch)?

Tweaking your own plugin is kind of fun, also _sometimes_ I need plugins with the minimum amount of dependencies so I can confirm the code is safe. This is small enough I can check everything manually, and does _exactly_ what I want. Also, semantic search now.

## Semantic Search Setup

To enable and use the semantic search functionality, you need to set up the GloVe word embeddings:

1.  **Download GloVe Vectors:**

    - Download the `glove.6B.zip` file from the [Stanford NLP website](https://nlp.stanford.edu/projects/glove/).
    - Extract the `glove.6B.100d.txt` file (or your preferred dimension, `100d` works well on a Mac and iPads) from the zip.
    - Place this file in a subfolder within your vault, for example, `your_vault/embeddings/glove.6B.100d.txt`.

2.  **Prepare GloVe for Desktop (Splitting):**

    - The plugin expects the GloVe file to be split into smaller parts for efficient loading on desktop (Obsidian doesn't "see" very large files for performance reasons).
    - Use the `glove-tool.go` script (available in the plugin's GitHub repository) to split the file. Run it from your terminal:
        ```bash
        go run glove-tool.go split -input "your_vault/embeddings/glove.6B.100d.txt" -output-prefix "your_vault/embeddings/glove.6B.100d_part_"
        ```
    - This will create files like `glove.6B.100d_part_1.txt`, `glove.6B.100d_part_2.txt`, etc.
    - In Clau settings, set "GloVe path format" to `embeddings/glove.6B.100d_part_{}.txt` and "Number of GloVe file parts" to the number of files generated.
    - _Alternative_: You can also run the Python script in `split_file.py` (run it like `python split_file.py -input your_file.txt -lines 50000`) to split these vectors, useful if you don't care about mobile or don't have Go installed. I didn't bother getting the pruner in Python though.

3.  (for mobile use) **Export Vault Vocabulary:**

    - In Obsidian, go to Clau settings, navigate to the "Semantic Search" section, and click the "Export Now" button under "Export vault vocabulary".
    - This will create a file named `embeddings/vault_vocab.txt` (or your configured path) containing all unique words from your notes.

4.  (for mobile use) **Generate Pruned GloVe for Mobile (Optional but Recommended):**
    - For better performance on mobile devices, it's recommended to create a smaller, pruned GloVe file containing only words relevant to your vault and their nearest neighbors.
    - Use the `glove-tool.go` script again:
        ```bash
        go run glove-tool.go prune -glove-input "your_vault/embeddings/glove.6B.100d.txt" -vocab-input "your_vault/embeddings/vault_vocab.txt" -output "your_vault/embeddings/enhanced_pruned_vectors.txt"
        ```
    - In Clau settings, set "Pruned GloVe file path" to `embeddings/enhanced_pruned_vectors.txt`.

If you have semantic search configured properly you can create a [UMAP](https://umap-learn.readthedocs.io/en/latest/) plot of your vault. There is also a search field that will search using minisearch (full terms, no frills for now) by default, and will search semantically when adding a `,` at the beginning. Looks like this:

![](https://raw.githubusercontent.com/rberenguel/obsidian-clau-plugin/main/media/clau-umap.png)

## Installation

### Manual Installation

1.  Download the latest release files (`main.js`, `styles.css`, `manifest.json`) from the **Releases** page of the GitHub repository (or the zip file, contains all of these).
2.  Find your Obsidian vault's plugins folder by going to `Settings` > `About` and clicking `Open` next to `Override config folder`. Inside that folder, navigate into the `plugins` directory.
3.  Create a new folder named `clau`.
4.  Copy the `main.js`, `manifest.json`, and `styles.css` files into the new `clau` folder.
5.  In Obsidian, go to **Settings** > **Community Plugins**.
6.  Make sure "Restricted mode" is turned off. Click the "Reload plugins" button.
7.  Find "Clau" in the list and **enable** it.
