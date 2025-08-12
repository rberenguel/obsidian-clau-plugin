# OOV Word Vectorization Plan

This document outlines the plan to implement a new "Vectorize" command in the Clau plugin. The goal is to allow users to generate custom word vectors for out-of-vocabulary (OOV) terms based on provided text, and to manage these vectors safely.

## 1. Overview

The "Vectorize" feature will provide a mechanism for users to create meaningful vector representations for words that are not present in the pre-trained GloVe model (e.g., acronyms, jargon, or specialized terms). This is achieved by calculating a vector for the OOV word from the average of the vectors of surrounding words in a user-provided text corpus. These custom vectors will be stored and loaded separately, with validation to prevent model mismatches.

## 2. User Workflow

1.  **Selection:** The user selects a word (e.g., "foobar") within the Obsidian editor.
2.  **Command Execution:** The user executes a new command from the command palette: `Clau: Vectorize selected word`.
3.  **Input Modal:** A modal window appears, displaying the selected word ("foobar"). This modal will contain a large text area.
4.  **Pasting Corpus:** The user pastes a significant amount of text into the text area. This text should be rich in context for the selected word.
5.  **Vector Generation:** The user clicks a "Generate Vector" button.
6.  **Calculation:** The plugin calculates a new vector for "foobar" by averaging the vectors of all other words in the pasted text (excluding stopwords and the target word itself).
7.  **Storage:** The new vector is saved to a separate JSON file (`.obsidian/plugins/clau/custom-vectors.json`), along with important metadata.
8.  **Feedback:** A confirmation notice (e.g., "Custom vector for 'foobar' created successfully") is displayed. The new vector is immediately added to the in-memory model for use.

## 3. Data Model

A new interface, `CustomVector`, will be defined to structure the custom vector data.

```typescript
// In model.ts
export interface CustomVector {
	word: string;
	vector: number[];
	createdAt: string; // ISO 8601 timestamp
	baseModel: string; // The path format of the GloVe model used
	dimension: number;
}
```

The custom vectors will be stored in an array within `custom-vectors.json`:

```json
[
    {
        "word": "mlcr",
        "vector": [0.123, -0.456, ...],
        "createdAt": "2025-08-11T10:00:00Z",
        "baseModel": "embeddings/glove.6B.100d_part_{}.txt",
        "dimension": 100
    },
    ...
]
```

## 4. Implementation Details

### 4.1. New Command (`main.ts`)

- A new command `vectorize-selected-word` will be added.
- It will check for an active editor and a text selection. If not present, it will show a notice and abort.
- It will instantiate and open a new `VectorizeModal`.

### 4.2. Vectorize Modal (`vectorize-modal.ts`)

- A new file `vectorize-modal.ts` will be created.
- The class `VectorizeModal` will extend `Modal`.
- The UI will consist of:
    - A title showing the target word.
    - A large `<textarea>` for pasting the corpus.
    - A "Generate Vector" button.
    - A "Cancel" button.

### 4.3. Vector Calculation Logic

- This logic will reside within the `VectorizeModal`.
- On submission, it will:
    1.  Retrieve the pasted text.
    2.  Tokenize the text, convert to lowercase, and filter out stopwords and the target OOV word.
    3.  Fetch the currently loaded `WordVectorMap` from the `SemanticSearchProvider`.
    4.  Calculate the average vector of the remaining words. This re-uses the `getAverageVector` logic.
    5.  If a vector is successfully generated, proceed to storage.

### 4.4. Storage (`semantic-search-provider.ts`)

- A new method, `saveCustomVector(word: string, vector: number[])`, will be added to `SemanticSearchProvider`.
- This method will:
    1.  Define the path: `CUSTOM_VECTORS_PATH = ".obsidian/plugins/clau/custom-vectors.json"`.
    2.  Read the existing `custom-vectors.json` file, or create an empty array if it doesn't exist.
    3.  Construct the `CustomVector` object with the word, vector, and metadata (timestamp, `glovePathFormat`, dimension).
    4.  Find and replace an existing entry for the word, or add the new entry to the array.
    5.  Write the updated array back to the file.
    6.  Add the new vector to the in-memory `this.vectors` map.

### 4.5. Loading & Validation (`semantic-search-provider.ts`)

- The `loadVectorModel` method in `SemanticSearchProvider` will be updated.
- After loading the main GloVe vectors, it will:
    1.  Check for the existence of `custom-vectors.json`.
    2.  If it exists, read and parse the file.
    3.  Iterate through each `CustomVector` object in the array.
    4.  **Validate** each custom vector:
        - `customVector.baseModel === this.settings.glovePathFormat`
        - `customVector.dimension === dimension_of_loaded_glove_model`
    5.  If validation passes, add the vector to the `this.vectors` map.
    6.  If validation fails, show a `Notice` (e.g., "Skipped loading custom vector for 'MLCR' due to model mismatch.") and log the details to the console.

## 5. Potential Issues & Mitigations

- **No Selection:** The command will check for a selection and show a notice if one isn't made.
- **Empty Corpus:** The calculation logic will handle cases where the pasted text is empty or contains no known words, preventing errors and notifying the user.
- **Calculation Time:** For very large text inputs, the UI might freeze. While this is a client-side operation and should be reasonably fast, we will not add a loading indicator in the first version to keep complexity down.
- **File I/O Errors:** All file read/write operations will be wrapped in `try...catch` blocks to handle potential errors gracefully.
- **Model Not Loaded:** The "Vectorize" command will be disabled or show a notice if the base semantic model is not loaded yet.

This plan provides a comprehensive roadmap for implementing the feature.
