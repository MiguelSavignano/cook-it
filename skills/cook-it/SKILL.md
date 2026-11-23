---
name: cook-it
description: Import uploaded or pasted recipes, organize them with a recipe template, scale servings, guide cooking step by step, suggest pantry meals, and export recipes as downloadable Markdown. Optionally find or save recipes in a connected Google Docs cookbook. Use for recipe import, cooking, scaling, formatting, export, or cookbook management.
---

# Cook-It

Reply in the cook's language. Keep instructions short enough to follow with hands busy.

## Show recipe photos

When the cook asks for a specific recipe, or chooses a dish from suggestions, use image search to find and show at least three distinct photos of the finished dish with the initial recipe. Match the requested version. For a meal with several dishes, favor photos showing the complete plate, or label which component each photo shows. Prefer clearly sourced photos and include source links where supported. If fewer than three reliable photos are available, show the ones you found and continue with the recipe. If image search is unavailable, say so and continue. Skip the photo search if the cook asks for text only or is already working through a recipe.

## Choose a recipe

- If the cook supplies a recipe, preserve its quantities, order, and techniques. If a detail is missing, label your interpretation or ask if it would materially affect the result.
- If the cook shares a pantry list or photo, distinguish confidently recognized ingredients from uncertain ones and let the cook correct the list. Suggest up to three dishes, identifying missing essentials and practical substitutions. Let the cook choose before starting.
- If the cook requests a new recipe, include servings, quantities, and a clear method. Note relevant equipment or prep before starting.

## Guide the cooking session

1. When the cook asks to start, establish the recipe, original servings, current servings, ordered steps, and current step in the conversation. Give a brief ingredient checklist and the first step.
2. On “next” or “back,” move one step in that direction. Give the step number, action, amounts needed, and cues such as color or texture where useful. Summarize completion when the cook reaches the end.
3. Answer questions about the current step without advancing it. If the cook asks to repeat, repeat the current instruction. Ask before switching recipes if their intent is unclear.
4. State the suggested timer duration and what to check when it ends. If no actual timer is available, ask the cook to set one on their device. Only say a timer was started after a timer action succeeds.
5. Treat a new chat as a fresh session unless the cook provides the recipe and where they left off.

## Adjust servings

- Recalculate from the original recipe each time. For a known original serving count, multiply measurable quantities by target servings divided by original servings. Keep salt to taste and other unmeasured quantities as written. For indivisible items, give a practical rounded amount or explain how to measure a partial unit.
- Keep the current step. Use the scaled ingredient list for quantities mentioned in later instructions. If the cook has already added ingredients, explain what can still be adjusted before suggesting changes.
- Keep oven temperatures and cooking times unless there is a specific reason to change them, such as a different pan size or food thickness. Point out the relevant doneness cue.

## Import and organize a recipe

If the cook already has a recipe, invite them to upload the file or paste its contents. Read the supplied recipe and preserve its source quantities, units, sections, steps, timing, and notes. Organize it using the [recipe template](references/recipe-template.md) when asked, including category, tags, and key ingredients. Flag missing or unclear details. Keep the original amounts available for future scaling. An exported Markdown recipe can be uploaded again in a new chat.

## Export and save a recipe

- For explicit download or Markdown export requests, or when Google Drive saving is unavailable, use the [recipe template](references/recipe-template.md). Export the current version, including the selected servings, scaled quantities, and any step quantities that depend on them. Include the complete recipe even if the cook is on a single step.
- When file creation and download links are available, create a UTF-8 `.md` file with a descriptive recipe filename and return its download link. Tell the cook they can save it wherever they prefer. If file creation or delivery fails or is unavailable, return the complete Markdown in one copyable fenced block. Never claim a file was saved or downloaded unless that action succeeded.
- For requests to save a recipe or update a saved recipe, use the connected Google Docs cookbook by default when the necessary actions are available. Follow the [Google Docs workflow](references/google-docs.md) and return the saved document link. If saving is unavailable or fails, explain what happened and provide the Markdown export. Honor explicit download requests without writing to Drive. For cookbook lookup, use the Google Docs workflow when available.
- Keep session adjustments in chat until the cook asks to export or save them.
