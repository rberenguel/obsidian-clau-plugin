# Architecture and Design Decisions

This document tracks the architectural evolution of the Quick Switcher++ plugin, focusing on the design of the search index.

## V1: Simple In-Memory Inverse Index (Stable)

This was the first functional version of the index and remains the most stable and memory-efficient implementation.

- **Design:** A `Map<string, SearchResult[]>` where the key is a full word (token) and the value is an array of notes that contain the word.
- **Search:** The query is tokenized, and the index is looked up for each token. The intersection of the resulting note arrays provides the final matches.
- **Pros:**
    - **Low Memory Footprint:** The index only stores each word once. The memory usage is directly proportional to the number of unique words in the vault, which is very manageable.
    - **Fast Indexing:** Building the index is quick and efficient.
    - **Reliable:** The implementation is straightforward and not prone to memory explosions.
- **Cons:**
    - **No Prefix Search:** Users must type the full word to get a match. "plug" will not match "plugin". This makes the search less interactive than desired.

## V2: Trie (Prefix Tree) - _Failed_

This was the first attempt to implement "search-as-you-type" prefix matching.

- **Design:** A classic Trie data structure where each node represents a character. Paths from the root to a node form a prefix, and notes were stored at the node corresponding to the final character of each word.
- **Search:** Traverse the Trie based on the query characters to find all words sharing that prefix.
- **Outcome: Failure**
    - **Reason:** Catastrophic memory consumption. The overhead of creating millions of `TrieNode` objects, combined with storing references to note objects in many different nodes, caused the plugin to quickly run out of memory, especially in a large vault. The implementation was not optimized for memory efficiency.

## V3: Prefix Map - _Failed_

This was the second attempt at prefix matching, intended to be simpler than the Trie.

- **Design:** A `Map<string, Set<string>>` where for every word (e.g., "plugin"), all of its prefixes ("p", "pl", "plu", "plug", "plugi", "plugin") were generated and stored as keys. The value was a set of paths to notes containing that prefix.
- **Search:** A direct lookup of the query string in the map.
- **Outcome: Failure**
    - **Reason:** Even higher memory consumption than the Trie. The number of keys in the map exploded, as a single long word generates many prefixes. This approach proved to be the most memory-intensive and quickly hit the engine's limits for Map size.

## V4: Index-Key Scanning - _Failed_

This was a third attempt at prefix matching, designed to be memory-efficient.

- **Design:** Use the stable V1 inverse index. Instead of a direct lookup, the search query would iterate over _all keys_ (the unique words) in the index, performing a `startsWith()` check to find all matching words.
- **Search:** For a query "plug", scan the entire dictionary of the vault for words like "plugin", "plugging", etc. Aggregate the notes from all matched keys.
- **Outcome: Failure**
    - **Reason:** Unacceptable UI latency. While memory-efficient, this approach shifted the performance bottleneck from memory to CPU. Iterating over tens of thousands of unique words on every single keystroke was too slow, resulting in a noticeable lag between typing and seeing results.

## V5: MiniSearch Library (Recommended)

After multiple failed attempts to build a custom prefix/fuzzy search index, the decision was made to use a dedicated, third-party library.

- **Design:** Integrate the `minisearch` library, a feature-rich, client-side search index. It handles indexing, prefix search, fuzzy matching, and result boosting internally. Our code is now a lightweight wrapper around this powerful library.
- **Search:** Delegate all search operations to the `minisearch` instance. The query `minisearch.search(query, { prefix: true, fuzzy: 0.2 })` provides all desired features out-of-the-box.
- **Key Learning:** The initial integration of `minisearch` failed due to extreme memory pressure. The root cause was a misconfiguration: the entire `content` of every note was being passed to `storeFields`. The correct approach is to **index** the `content` field but only **store** the fields required for display (e.g., `title`, `path`). This prevents the library from holding the entire vault's content in memory.
- **Key Learning 2:** Startup performance was severely impacted by attempting to index non-markdown files (e.g., images). The indexing process must strictly filter for `.md` files to avoid reading and processing binary data, which causes extreme memory and CPU load.
- **Pros:**
    - **Feature-Rich:** Provides prefix search, fuzzy (typo-tolerant) search, and result boosting with no custom implementation effort.
    - **High Performance:** When configured correctly, `minisearch` is highly optimized for this exact use case, balancing memory usage and search speed effectively.
    - **Maintainable:** Offloads the most complex part of the plugin to a well-maintained external library, simplifying our codebase significantly.
- **Cons:**
    - **External Dependency:** Adds a new dependency to the project. (This is a very minor "con" given the benefits).

---

## V4: Index-Key Scanning - _Failed_
