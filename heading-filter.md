# Heading Filter Feature Plan

## 1. Overview

This document outlines the plan for a new search feature that allows for real-time filtering of headings within the currently active document. The feature is triggered when a user types a hash (`#`) as the first character in the main search modal. This action initiates a special "heading-filter" mode.

## 2. Core Requirements

- **Trigger:** The mode activates when `#` is the first character typed into the search input.
- **UI Behavior:** Upon activation, the search modal is hidden, but keyboard input remains captured.
- **Filtering Scope:** The filtering logic applies only to the content of the currently active editor view.
- **Live Filtering:** As the user types, the active document's view is dynamically updated. Headings (and their content) that do not match the typed string are hidden.
- **Hierarchical Logic:**
    - If a heading matches the search term, it and all its descendant headings (and their respective content) are shown.
    - If a child heading matches but its parent does not, the parent heading element itself should remain visible to maintain context, but its other non-matching content should be hidden. The matching child and its content should be visible.
- **Controls:**
    - `Backspace`: Deletes the last character from the search buffer and updates the filter.
    - `Escape`: Exits the heading-filter mode completely, clearing the search buffer and restoring the document's original visibility state.

## 3. System Architecture & Design

The feature will be encapsulated into a new, self-contained module (`heading-filter.ts`) to ensure separation of concerns.

### 3.1. Components

1.  **`HeadingFilterManager` (Main Class):**

    - Manages the state of the feature (e.g., `isActive`, `searchBuffer`).
    - Orchestrates the interaction between the trigger, input handling, and DOM manipulation.
    - Attaches and detaches global keyboard event listeners (`keydown`) when the mode is active.

2.  **`SearchModalPatcher` (Integration Point):**

    - This will not be a new component, but rather a modification to the existing search modal logic.
    - It will detect the `#` trigger, prevent default search behavior, and call the `HeadingFilterManager` to activate the feature.

3.  **`ActiveViewFilter` (DOM Manipulator):**
    - A dedicated class or set of functions responsible for all DOM interactions within the active editor.
    - It will query for all heading elements (`H1` through `H6`).
    - It will be responsible for parsing the heading hierarchy and applying the filtering logic by changing the `display` style property of elements.
    - It will store the original display state of all modified elements to allow for a clean restoration.

### 3.2. Data Models & State

- **`state.isActive: boolean`**: Tracks if the filter mode is currently active.
- **`state.searchBuffer: string`**: Stores the user's typed query.
- **`state.originalElementStyles: Map<HTMLElement, string>`**: A map to store the original `display` style of every element that is hidden, allowing for perfect restoration.

## 4. Logic Flow Description

### 4.1. Activation

1.  The user opens the search modal.
2.  The user types `#`.
3.  The patch on the search modal's input handler detects the trigger.
4.  It calls `HeadingFilterManager.activate()`.
5.  The manager:
    - Hides the search modal.
    - Sets `isActive = true`.
    - Clears the `searchBuffer`.
    - Attaches a `keydown` event listener to the `window`.

### 4.2. Filtering on Key-Press

1.  The `keydown` listener captures the event.
2.  If the key is a character, it's appended to `searchBuffer`. If it's `Backspace`, the buffer is shortened.
3.  The `ActiveViewFilter.applyFilter(searchBuffer)` function is called.
4.  **Inside `applyFilter`**:
    a. First, if this is the first time filtering, it traverses the document and stores the original `display` style for all relevant elements in `originalElementStyles`.
    b. It gets all heading elements (`.cm-header`) from the active editor view.
    c. It builds a logical tree of these headings and their associated content sections.
    d. It iterates through the tree, applying the hierarchical visibility rules: - An element is marked as "visible" if its heading text contains the `searchBuffer` (case-insensitive) OR if one of its ancestors was already marked "visible".
    e. It then traverses the DOM elements. For each element corresponding to a heading and its content: - If the element is marked "visible", its `display` style is restored from the map. - If not, its `display` style is set to `none`.

### 4.3. Deactivation

1.  The `keydown` listener detects the `Escape` key.
2.  It calls `HeadingFilterManager.deactivate()`.
3.  The manager:
    - Calls `ActiveViewFilter.restoreView()`, which iterates through `originalElementStyles` and restores the original `display` property on all elements.
    - Clears the `originalElementStyles` map.
    - Resets `isActive = false` and `searchBuffer = ''`.
    - Removes the global `keydown` listener.

## 5. Open Questions & Risks

- **DOM Structure Complexity:** The success of the `ActiveViewFilter` depends on the stability and predictability of Obsidian's editor DOM structure. This can change between versions. The implementation must be robust enough to handle the known structure of content sections relative to their headings.
- **Performance:** For very large documents, re-filtering on every keystroke could introduce lag. The input handling should be debounced by a small amount (e.g., 50-100ms) to ensure a smooth user experience.
- **Editor Mode Compatibility:** The initial implementation will target Live Preview mode. Reading mode might require a separate or slightly adjusted DOM traversal logic. This should be investigated after the core functionality is stable.
- **Hierarchical Hiding:** The logic to hide parts of a parent section while keeping a matching child visible is the most complex part. It will require careful DOM traversal, likely by identifying the container element for a heading and its content, and then selectively hiding children of that container.

## 8. Lessons Learned

- **Initial Complexity Underestimated:** The initial filtering logic was too simplistic. A more robust, multi-pass algorithm was required to correctly handle the hierarchical display rules (e.g., showing an ancestor heading for context without showing its content).
- **Stateful Filtering is Key:** Using an enum (`VisibilityReason`) to track _why_ a heading was visible (direct match, ancestor, etc.) was crucial. This allowed the rendering logic to make fine-grained decisions about showing content vs. just the heading.
- **Debounce for UX:** For real-time DOM manipulation based on user input, debouncing the event handler is essential to prevent performance lag and visual flicker, creating a much smoother user experience.
- **Clean State Restoration:** Caching the original `display` style of all modified DOM elements in a `Map` before altering them is a critical pattern. It ensures that the view can be restored to its exact original state when the feature is deactivated.
- **Architectural Separation:** Encapsulating the feature in a dedicated `HeadingFilterManager` class kept the logic isolated and made the integration with the existing `ClauModal` cleaner and less invasive.
