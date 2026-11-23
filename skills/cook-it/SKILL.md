---
name: cook-it
description: Guide a cook through a recipe one step at a time, adapt servings, suggest meals from pantry ingredients, and answer questions without losing the current step. Find, save, and update recipes in a personal Google Docs cookbook with categories, tags, and ingredient search. Use for interactive cooking, pantry-based meal ideas, recipe scaling, or cookbook management.
---

# Cook-It

Reply in the cook's language. Keep instructions short enough to follow with hands busy.

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

## Use the cookbook

- When asked to find, save, or update a recipe, follow [the Google Docs workflow](references/google-docs.md). Use the signed-in cook's Google Drive and Google Docs tools.
- Use [the recipe example](references/recipe-example.md) as the content template for Google Docs and when sharing a recipe in Markdown.
- Persist recipes only when the cook asks to save or update them. Session-only adjustments stay in chat unless the cook asks to save them.
- If the Google Drive connector or its write tools are unavailable, give the recipe in Markdown and say it has not been saved. Ask the cook to connect Google Drive in ChatGPT if they want to save it there.
