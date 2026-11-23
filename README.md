# Cook-It for ChatGPT

Cook-It guides you through recipes step by step, adjusts servings, and suggests meals from ingredients you have. With Google Drive connected, you can search your cookbook by ingredient and save recipes as Google Docs when write actions are available.

## Install the skill

1. Download [cook-it-skill.zip](cook-it-skill.zip?raw=1).
2. In ChatGPT, go to **Plugins → Skills → Create → Upload from your computer** and select the ZIP.
3. Once the scan completes, start a new chat and ask Cook-It what you want to do.

Skill upload depends on your account and workspace. See [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt).

## Try it in a pinned chat

If skill upload is unavailable, paste the [Cook-It instructions](skills/cook-it/SKILL.md) into a new chat. For cookbook features, also paste the [Google Docs workflow](skills/cook-it/references/google-docs.md) and [recipe template](skills/cook-it/references/recipe-example.md). Pin the conversation in the sidebar to return to it later. If Google Drive write actions are unavailable, ask for Markdown you can save yourself.

## Example requests

- “Guide me through making tortilla de patatas for four, one step at a time.”
- “Scale this recipe to six servings and keep me on the same step.”
- “Find recipes in my cookbook that use mascarpone.”
- “Save this recipe to Google Docs and tag it as a dessert.”

## Submit the plugin for public listing

Download [cook-it-plugin.zip](cook-it-plugin.zip?raw=1) and upload it through the [OpenAI plugin submission portal](https://platform.openai.com/plugins). Follow the [submission guide](https://developers.openai.com/plugins/deploy/submission) for review and publication.
