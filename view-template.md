> [!snipper-config]- Snipper filter
>
> // --- Config Example, needs to be a folded callout ---
> // Use a convenience query (thisMonth, lastMonth, thisWeek, lastWeek)
> query: thisWeek
>
> // Or, use a specific date range (this will be ignored if "query" is set)
> // dateFormat: YYYYMMDD
> // startDate: 20250701
> // endDate: 20250703
>
> // --- Optional Display Settings ---
> // listStyle: card, glow, quote, glass, or ""
> // sortOrder: desc (newest first) or asc (oldest first)
> listStyle: glow
> sortOrder: desc

````dataviewjs
// --- Configuration ---
// This section finds and parses the dedicated YAML config block.
async function getSnipperConfig() {
    const defaultConfig = {
        listStyle: "card",
        sortOrder: "desc",
        dateFormat: "YYYYMMDD",
        query: "", // New: for one-word queries like "thisMonth"
        startDate: "",
        endDate: "",
    };
    const current = dv.current()
    if(!current){
        return [defaultConfig, "NoCurrentFileYet"]
    }
    const fileContent = await dv.io.load(current.file.path);
    const configRegex = /> \[\!snipper-config\]- Snipper filter\s*([\s\S]*?)\s*```/;
    const match = fileContent.match(configRegex);
    if (!match) return [defaultConfig, "NoValidConfig"];

    // Custom mini-parser for YAML key:value pairs
    const userConfig = {};
    const lines = match[1].split('\n');
    for (const _line of lines) {
	    let line = _line.slice(2)
        if (line.trim().startsWith('//') || line.trim() === '') continue;
        const colonIndex = line.indexOf(':');
        if (colonIndex === -1) continue;
        const key = line.substring(0, colonIndex).trim();
        let value = line.substring(colonIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
        }
        if (key) userConfig[key] = value;
    }

    return [{ ...defaultConfig, ...userConfig }, null];
}


// --- Helper Function ---
function parseDateWithFormat(dateString, formatString) {
    try {
        const yearIndex = formatString.indexOf("YYYY");
        const monthIndex = formatString.indexOf("MM");
        const dayIndex = formatString.indexOf("DD");
        const year = parseInt(dateString.substring(yearIndex, yearIndex + 4));
        const month = parseInt(dateString.substring(monthIndex, monthIndex + 2));
        const day = parseInt(dateString.substring(dayIndex, dayIndex + 2));
        const isoString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return dv.date(isoString);
    } catch (e) {
        return null;
    }
}


// --- Main Execution ---
const [config, errorMode] = await getSnipperConfig();

if (config) { // Only run if config was parsed successfully
    let startDate, endDate;
    const now = dv.date("now");

    // New: Process convenience queries first
    if (config.query) {
        switch (config.query.toLowerCase()) {
            case 'thisweek':
                startDate = now.startOf('week');
                endDate = now.endOf('week');
                break;
            case 'lastweek':
                startDate = now.minus({ weeks: 1 }).startOf('week');
                endDate = now.minus({ weeks: 1 }).endOf('week');
                break;
            case 'thismonth':
                startDate = now.startOf('month');
                endDate = now.endOf('month');
                break;
            case 'lastmonth':
                startDate = now.minus({ months: 1 }).startOf('month');
                endDate = now.minus({ months: 1 }).endOf('month');
                break;
        }
    } else {
        // Fallback to startDate and endDate if no query is set
        startDate = config.startDate ? parseDateWithFormat(String(config.startDate), config.dateFormat) : null;
        endDate = config.endDate ? parseDateWithFormat(String(config.endDate), config.dateFormat) : null;
    }

    // If no dates are set at all, show help text instead of running a query.
    if (errorMode === "NoValidConfig") {
        dv.el("div", "No date range specified. Add a configuration block like the one below (a custom folded callout) to this note to get started.", {cls: "help-text"});
        const example = `
\`\`\`
> [!snipper-config]- Snipper filter
>
>
> //  --- Config Example, a codeblock with language obsidian-snipper ---
> // Use a convenience query (thisMonth, > lastMonth, thisWeek, lastWeek)
> // query: thisMonth
>
> // Or, use a specific date range (this > will be ignored if "query" is set)
> dateFormat: YYYYMMDD
> startDate: 20250701
> endDate: 20250703
>
> // --- Optional Display Settings ---
> // listStyle: card, glow, quote, glass, > or ""
> // sortOrder: desc (newest first) or asc > (oldest first)
> listStyle: glow
> sortOrder: desc
\`\`\`
`;
        dv.paragraph(example);
        return; // Stop execution
    }

    if (errorMode === "NoCurrentFileYet") {
        dv.el("div", "The current file is not available yet. Give it a few seconds.", {cls: "help-text"});
        return; // Stop execution
    }

    const folderPath = app.plugins.plugins.snipper.settings.snippetFolderPath;
    const dailyNoteFolder = app.internalPlugins.plugins['daily-notes'].instance.options.folder || "";

    let pages = dv.pages(`"${folderPath}"`)
        .where(p => {
            const fileDate = parseDateWithFormat(p.file.name.substring(2), config.dateFormat);
            if (!fileDate) return false;
            if (startDate && fileDate < startDate) return false;
            // Use endOf('day') on endDate to make the range inclusive
            if (endDate && fileDate > endDate.endOf('day')) return false;
            return true;
        })
        .sort(p => p.file.name, config.sortOrder);

    if (pages.length === 0) {
        dv.paragraph("No snippets found for the selected criteria.");
    } else {
        for (const page of pages) {
            const container = dv.container.createEl("div", { cls: `snippet-widget ${config.listStyle}` });

            // Add date link
            const fileDate = parseDateWithFormat(page.file.name.substring(2), config.dateFormat);
            if(fileDate) {
                const dailyNoteName = page.file.name.slice(2);
                const dailyNotePath = dailyNoteFolder ? `${dailyNoteFolder}${dailyNoteName}.md` : `${dailyNoteName}.md`;

                const dateEl = container.createEl('div', { cls: 'snippet-date' });
                const link = dateEl.createEl('a', {
                    cls: 'internal-link',
                    href: dailyNotePath,
                    text: dailyNoteName
                });
                link.addEventListener('click', (e) => {
                    e.preventDefault();
                    app.workspace.openLinkText(dailyNotePath, page.file.path, true); // true = open in new tab
                });
            }

            const content = await dv.io.load(page.file.path);
            if (content && content.trim()) {
                await obsidian.MarkdownRenderer.render(app, content, container, page.file.path, dv.component);
            } else {
                container.createEl("p", { text: "Empty snippet." });
            }
        }
    }
}
````
