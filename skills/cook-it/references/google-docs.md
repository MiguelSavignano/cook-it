# Google Docs cookbook

Use the current user's Google Drive connector for file lookup, folder creation, and moves, and its Google Docs tools for reading, creating, and editing native documents. Access follows the current user's permissions. Use the folder or document the cook specifies before applying the defaults below.

## Resolve the cookbook

1. Look for the `Cook-It` folder in Drive. Search within it for a `Recetas` subfolder and a main recipe index at the folder root. Reuse the user's existing equivalents, including English names such as `Recipes`. If multiple plausible folders or indexes exist, use known links or ask which one to use.
2. For an explicit save, create any missing folder or main index in the user's Drive. For a lookup, return what is available without creating files.
3. When the connector cannot create a Google Doc directly in a folder, create it, inspect its current parent, and move it to the intended folder. Verify the resulting parent. Keep one native Google Doc per recipe under `Recetas`, and the main index in `Cook-It`.

## Find recipes

Read the main index. Match titles, categories, tags, and key ingredients case-insensitively, including common synonyms. Open candidate recipes to verify the ingredient lists, and return matching titles with their Docs links. An older index may contain only titles. Search the recipe folder and consult candidate documents when metadata is incomplete. Distinguish verified ingredient matches from guesses. If the cook wants to resume a recipe, read that recipe and use the cooking-session workflow.

## Save and index

1. Read the recipe source and use the [Markdown example](recipe-example.md) as a template. Preserve quantities, units, ingredient groups, steps, and meaningful notes. Use the cook's language and the existing cookbook's category names. Choose a few descriptive tags and a short list of searchable ingredients from the recipe. Include photo and source links only if supplied or already verified.
2. Search within the recipe folder and index for the same title or source before creating a document. Reuse the same document when an update is requested. If several variants could match, ask which one to update. Do not overwrite an existing recipe when the cook has asked to save a distinct version.
3. Write using native headings, lists or a native ingredient table, and clickable links. Use Google's Docs tools to read current document structure before editing. Guard edits with the current revision when available. Confirm the content and folder before adding the index entry.
4. In the appropriate category, add or update one entry with the linked recipe title, tags, and key ingredients. For an existing index with simple linked titles, keep that format and add the metadata on an adjacent line or in existing columns. Key the entry by recipe document ID to avoid adding duplicates. If the index update fails, retain the saved recipe, report its link and the index failure, and resume by repairing the index rather than creating a second recipe.
5. Verify the recipe link and its metadata in the index. Return the recipe and index links, and report any action that failed.
