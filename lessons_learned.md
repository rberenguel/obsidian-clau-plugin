### 2025-07-18 - README and Command Naming

- **Issue:** Initial README was for a different plugin, and command names were too verbose, including the plugin name which Obsidian prefixes automatically.
- **Resolution:** Updated README to accurately describe the 'Clau' quick switcher plugin. Shortened command names in `main.ts` (e.g., 'Open Search' instead of 'Open Clau (Clau Search)') to align with Obsidian's command palette conventions.
- **Learning:** Always ensure documentation (like READMEs) is consistent with the current functionality. For Obsidian plugins, keep command names concise as the plugin name is automatically prepended in the command palette.

### 2025-07-19 - Implementing Plugin Settings

- **Issue:** The plugin lacked user-configurable options, such as the ability to ignore certain folders from search or hide previews for sensitive notes.
- **Resolution:**
    1.  Introduced a `ClauSettings` interface and a `DEFAULT_SETTINGS` object to define the structure of the plugin's configuration.
    2.  Implemented a `ClauSettingTab` class (extending `PluginSettingTab`) to create a user interface within Obsidian's settings for modifying these options.
    3.  Used `loadData()` and `saveData()` in the main plugin class to persist settings.
    4.  Modified the `MiniSearchProvider` to filter out files from ignored folders during the indexing process (`build`, `add`, `update`).
    5.  Updated the `ClauModal` to check for "private tags" on a note and conditionally hide the content preview in search results.
    6.  Ensured that saving settings automatically triggers a re-index of the vault to apply changes immediately.
- **Learning:**
    - Adding settings is a core feature for plugin usability. The standard pattern in Obsidian involves creating a `PluginSettingTab`, managing settings via `load/saveData`, and passing the settings object to the relevant components.
    - It's crucial to consider the side effects of changing a setting. For instance, changing ignored folders requires the search index to be rebuilt. Tying the re-index action to the `saveSettings` method is an effective way to ensure changes are applied consistently.
    - Dependency injection, such as passing the `settings` object through constructors, is a clean pattern for making components aware of the plugin's configuration. This avoids global state and makes the code easier to reason about.

### 2025-07-19 - Fixing Settings Change Race Condition

- **Issue:** When changing settings, a "duplicate ID" error occurred because the index rebuild process was triggered on every keystroke, leading to multiple concurrent builds attempting to modify the index simultaneously.
- **Resolution:** Implemented a simple locking mechanism by adding an `isBuilding` boolean flag to the `MiniSearchProvider`. The `build` method now checks this flag upon entry; if a build is already in progress, it skips the new request. The flag is set to `true` at the start of a build and reset to `false` in a `finally` block to ensure it's always released.
- **Learning:** UI event listeners that trigger expensive, asynchronous operations (like `onChange` on a text field triggering a full index rebuild) are highly susceptible to race conditions. A simple locking flag (`isBuilding`) or debouncing the event handler are effective strategies to prevent concurrent executions and ensure data integrity. The `try...finally` pattern is essential for managing the lock, guaranteeing it is released even if the operation fails.

### 2025-07-19 - Implementing Search Term Exclusion

- **Issue:** The search functionality did not support excluding terms from the results.
- **Resolution:** The `search` method in `minisearch-provider.ts` was updated to parse the query for terms prefixed with a hyphen (`-`). It now constructs a `minisearch` query tree, using the `AND_NOT` combinator to filter out results containing the excluded terms. Positive terms are combined with `OR`.
- **Learning:** Leveraging the advanced query capabilities of a library like `minisearch` is more efficient than implementing complex filtering logic manually. The query tree structure provides a powerful and declarative way to handle complex search conditions, including term exclusion.

### 2025-07-19 - Implementing Per-Query Path Exclusion

- **Issue:** Users could not exclude files from specific folders on a per-query basis.
- **Resolution:** The `search` method was enhanced to recognize a new `-/<path>` syntax. It parses these terms from the query and uses them to filter the search results returned by `minisearch`. This post-processing step removes any result whose path starts with one of the excluded path prefixes. The README and search placeholder text were also updated to reflect this new feature.
- **Learning:** Combining a powerful search library with custom post-processing logic is an effective strategy. The library handles the heavy lifting of indexed searching, while the custom code can apply specific business rules (like path-based filtering) that are outside the library's core scope. This keeps the main search fast while still allowing for flexible, user-defined filtering.

### 2025-07-19 - Adding Hint for Private Notes

- **Issue:** When a note's context was hidden due to a private tag, there was no visual feedback, which could be confusing.
- **Resolution:** The `renderSuggestion` method in `ClauModal` was updated to display a subtle message, "Context hidden (private tag)", whenever a note's preview is hidden. A corresponding CSS class (`.clau-private-context`) was added to style this hint appropriately.
- **Learning:** Clear user feedback is essential for a good user experience. When an action (like hiding a preview) happens silently, providing a non-intrusive visual cue helps the user understand the system's behavior without being distracting.

### 2025-07-19 - Adding Private Folders Setting

- **Issue:** Users could not hide context for all notes within a specific folder, only by using tags.
- **Resolution:** Added a `privateFolders` setting to the plugin. The `renderSuggestion` logic was updated to check if a note's path is within one of these folders and, if so, hide the context preview, displaying a "Context hidden (private folder)" message.
- **Learning:** Expanding existing features (like privacy controls) to cover different use cases (tags vs. folders) makes the plugin more flexible and powerful for users with different organizational styles. The implementation was straightforward due to the existing privacy logic.

### 2025-07-19 - Adding Title-Only Search Mode

- **Issue:** The plugin lacked a way to restrict searches to only the titles of notes, which is useful for reducing noise.
- **Resolution:** Implemented a title-only search mode, activated by starting the query with a space. The `search` method in the `MiniSearchProvider` detects this modifier and uses the `fields: ['title']` option in the `minisearch` query to restrict the search to the title field of the existing index. This approach is highly efficient as it avoids the need for a separate, title-only index.
- **Learning:** Before building complex solutions like multiple indexes, thoroughly check the documentation of the libraries in use. Often, a library will provide a simple, efficient option (like the per-query `fields` setting in `minisearch`) that solves the problem elegantly, saving memory, and reducing code complexity.

### 2025-07-19 - Swapping and Implementing Privacy Modifiers

- **Issue:** The initial `!` modifier for private search was not intuitive. There was also no way to temporarily bypass privacy settings for a single search.
- **Resolution:** The privacy modifiers were swapped and a new one was added based on user feedback for better semantics.
    - `?` now triggers a "private search," hiding all context previews.
    - `!` now triggers an "ignore privacy" search, showing all context previews regardless of settings.
    - The logic in `ClauModal` was refactored to handle these two new flags (`isPrivateSearch`, `ignorePrivacy`) to control context visibility.
- **Learning:** The choice of modifier characters matters for usability. `?` (questioning, uncertain) is a better fit for hiding information, while `!` (emphatic, forceful) is a better fit for overriding rules. Being responsive to this kind of user feedback is crucial for creating an intuitive product. The implementation required adding a simple state-management layer (the two boolean flags) to the modal to control the rendering logic based on the query prefix.
