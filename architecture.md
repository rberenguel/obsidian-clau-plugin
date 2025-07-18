# Architecture and Design Decisions

This document tracks the architectural evolution of the Quick Switcher++ plugin, focusing on the design of the search index.

## V1: Simple In-Memory Inverse Index (Stable)

This was the first functional version of the index and remains the most stable and memory-efficient implementation.

- **Design:** A `Map<string, SearchResult[]>` where the key is a full word (token) and the value is an array of notes that contain the word.
- **Search:** The query is tokenized, and the index is looked up for each token. The intersection of the resulting note arrays provides the final matches.
- **Pros:**
    -   **Low Memory Footprint:** The index only stores each word once. The memory usage is directly proportional to the number of unique words in the vault, which is very manageable.
    -   **Fast Indexing:** Building the index is quick and efficient.
    -   **Reliable:** The implementation is straightforward and not prone to memory explosions.
- **Cons:**
    -   **No Prefix Search:** Users must type the full word to get a match. "plug" will not match "plugin". This makes the search less interactive than desired.

## V2: Trie (Prefix Tree) - *Failed*

This was the first attempt to implement "search-as-you-type" prefix matching.

- **Design:** A classic Trie data structure where each node represents a character. Paths from the root to a node form a prefix, and notes were stored at the node corresponding to the final character of each word.
- **Search:** Traverse the Trie based on the query characters to find all words sharing that prefix.
- **Outcome: Failure**
    -   **Reason:** Catastrophic memory consumption. The overhead of creating millions of `TrieNode` objects, combined with storing references to note objects in many different nodes, caused the plugin to quickly run out of memory, especially in a large vault. The implementation was not optimized for memory efficiency.

## V3: Prefix Map - *Failed*

This was the second attempt at prefix matching, intended to be simpler than the Trie.

- **Design:** A `Map<string, Set<string>>` where for every word (e.g., "plugin"), all of its prefixes ("p", "pl", "plu", "plug", "plugi", "plugin") were generated and stored as keys. The value was a set of paths to notes containing that prefix.
- **Search:** A direct lookup of the query string in the map.
- **Outcome: Failure**
    -   **Reason:** Even higher memory consumption than the Trie. The number of keys in the map exploded, as a single long word generates many prefixes. This approach proved to be the most memory-intensive and quickly hit the engine's limits for Map size.

## V4: Index-Key Scanning - *Failed*

This was a third attempt at prefix matching, designed to be memory-efficient.

- **Design:** Use the stable V1 inverse index. Instead of a direct lookup, the search query would iterate over *all keys* (the unique words) in the index, performing a `startsWith()` check to find all matching words.
- **Search:** For a query "plug", scan the entire dictionary of the vault for words like "plugin", "plugging", etc. Aggregate the notes from all matched keys.
- **Outcome: Failure**
    -   **Reason:** Unacceptable UI latency. While memory-efficient, this approach shifted the performance bottleneck from memory to CPU. Iterating over tens of thousands of unique words on every single keystroke was too slow, resulting in a noticeable lag between typing and seeing results.

## Conclusion

All attempts at providing prefix search functionality have so far failed due to either excessive memory usage (Trie, Prefix Map) or unacceptable CPU latency (Index-Key Scanning). The core challenge is creating an index that supports partial matching without storing a massive number of keys or requiring a full scan of the dictionary on each input.

The current, stable architecture (V1) prioritizes stability, low memory usage, and a responsive UI over the "search-as-you-type" feature. Future work on prefix searching would require a much more sophisticated, performance-tuned data structure or a hybrid approach.
