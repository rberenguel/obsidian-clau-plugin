### 2025-07-18 - README and Command Naming

- **Issue:** Initial README was for a different plugin, and command names were too verbose, including the plugin name which Obsidian prefixes automatically.
- **Resolution:** Updated README to accurately describe the 'Clau' quick switcher plugin. Shortened command names in `main.ts` (e.g., 'Open Search' instead of 'Open Clau (Clau Search)') to align with Obsidian's command palette conventions.
- **Learning:** Always ensure documentation (like READMEs) is consistent with the current functionality. For Obsidian plugins, keep command names concise as the plugin name is automatically prepended in the command palette.