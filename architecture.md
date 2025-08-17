# Clau Plugin Architecture

This document provides a comprehensive overview of the Clau plugin's architecture, its core components, and how they interact.

## High-Level Overview

Clau is an Obsidian plugin that provides a quick switcher with advanced search capabilities. Its primary features include:

-   **Fuzzy Search**: A fast, as-you-type search with typo tolerance.
-   **Semantic Search**: A search that understands the meaning of your query, not just the keywords.
-   **Heading Filtering**: A mode to filter the headings of the current note in real-time.
-   **Multi-Select**: A tool to select multiple notes and copy their content.
-   **Vault Visualization**: A UMAP-based visualization of your notes.

## Folder Structure

The plugin's source code is organized into the following structure:

```
src/
├── main.ts               # Plugin entry point
├── commands.ts           # Command registrations
├── events.ts             # Vault event listeners
├── settings.ts           # Plugin settings and settings tab UI
├── search/
│   ├── providers/        # All search provider implementations
│   ├── search.ts         # Core search interfaces and types
│   ├── searcher.ts       # Semantic search logic
│   └── search-provider.ts# Search provider interface
├── semantic/
│   ├── indexer.ts        # Semantic index building logic
│   ├── model.ts          # Data models for semantic search
│   ├── pruner.ts         # Logic for pruning GloVe vectors
│   └── exporter.ts       # Vault vocabulary exporter
└── ui/
    ├── search-modal.ts       # The main search modal
    ├── multi-select-modal.ts # The multi-select modal
    ├── vectorize-modal.ts    # The modal for creating custom vectors
    ├── heading-filter.ts     # The heading filter implementation
    └── vault-viz/
        ├── vault-viz-view.ts # The vault visualization view
        └── viz-app.ts        # The Pixi.js application for the visualization
```

## Core Components

### 1. Search Providers

The search functionality is modularized into several "providers," each responsible for a specific type of search. This is orchestrated by the `CombinedSearchProvider`.

-   **`MiniSearchProvider`**: The primary search provider, using the `minisearch` library to provide fast, fuzzy, and prefix-based search.
-   **`TitleContainsSearchProvider`**: A simple provider that searches for notes whose titles contain the query string.
-   **`SemanticSearchProvider`**: Handles semantic search, which is triggered by a `,` prefix. It uses word embeddings (GloVe) to find notes that are semantically similar to the query.
-   **`RecentFilesSearchProvider`**: Provides a list of recently modified files when the search query is empty.

### 2. Semantic Search

The semantic search functionality is a core feature of Clau. It works as follows:

-   **Word Embeddings**: The plugin uses pre-trained GloVe word embeddings to represent words as vectors. These vectors capture the meaning of the words.
-   **Chunking and Indexing**: The `SemanticSearchProvider` builds an index of all notes in the vault. Each note is first broken down into smaller "chunks," which correspond to paragraphs (separated by double newlines). Then, for each chunk, the plugin creates a "chunk vector" by averaging the vectors of all the words within that chunk. This provides more granular and contextually relevant search results than using a single vector for the entire note.
-   **Querying**: When a user performs a semantic search, the plugin calculates a vector for the query in the same way (by averaging the vectors of the query words). It then uses cosine similarity to find the note chunks with the most similar vectors.
-   **Custom Vectors**: Users can create custom vectors for out-of-vocabulary words using the "Vectorize selected word" command. This allows the plugin to learn new words and their meanings.

### 3. UI Components

-   **`ClauModal`**: The main search modal, which displays search results and handles user input.
-   **`MultiSelectModal`**: A modal that allows users to select multiple notes and copy their content.
-   **`VectorizeModal`**: A modal for creating custom word vectors.
-   **`HeadingFilterManager`**: Manages the heading filtering mode, which is implemented as a CodeMirror 6 extension.
-   **`VaultVizView`**: An Obsidian `ItemView` that hosts the vault visualization.

## Data Flow

1.  **Initialization**: On load, the `ClauPlugin` class in `main.ts` initializes all the search providers and UI components. It also registers all commands and event listeners.
2.  **User Input**: The user triggers a search by opening the `ClauModal`. As the user types, the `getSuggestions` method is called.
3.  **Search Execution**: The `ClauModal` passes the query to the `CombinedSearchProvider`, which in turn delegates the search to the appropriate provider based on the query's prefix.
4.  **Results Display**: The search results are returned to the `ClauModal`, which then renders them to the user.

## Key Concepts

-   **Decoupling**: The use of search providers decouples the search logic from the UI, making it easy to add new search types.
-   **State Management**: The main `ClauPlugin` class holds the state of the plugin, including the settings and the instances of the search providers.
-   **Modularity**: The code is organized into modules with specific responsibilities, which improves maintainability.
-   **Extensibility**: The architecture is designed to be extensible. For example, adding a new search provider is a straightforward process.