# Cook-It for ChatGPT

Cook-It guides you through recipes step by step, adjusts servings, and suggests meals from ingredients you have. With Google Drive connected, you can search your cookbook by ingredient and save recipes as Google Docs when write actions are available.

## Install the skill

1. Download [cook-it-skill.zip](cook-it-skill.zip?raw=1).
2. In ChatGPT, go to **Plugins → Skills → Create → Upload from your computer** and select the ZIP.
3. Once the scan completes, start a new chat and ask Cook-It what you want to do.

Skill upload depends on your account and workspace. See [Skills in ChatGPT](https://help.openai.com/en/articles/20001066-skills-in-chatgpt).

## Try it in a pinned chat

Copy and paste this prompt into a new ChatGPT conversation:

```text
Set up Cook-It in this chat. Read the full instructions from these three links and use them as my cooking and cookbook workflow throughout this conversation:

https://github.com/MiguelSavignano/cook-it/blob/main/skills/cook-it/SKILL.md
https://github.com/MiguelSavignano/cook-it/blob/main/skills/cook-it/references/google-docs.md
https://github.com/MiguelSavignano/cook-it/blob/main/skills/cook-it/references/recipe-template.md

If you can't open a link, ask me to paste that file's contents. If you can't save recipes to Google Docs, give me the recipe in Markdown so I can save it myself.
```

Pin the conversation in the sidebar so you can return to it later.

## Example requests

- “Guide me through making tortilla de patatas for four, one step at a time.”
- “Scale this recipe to six servings and keep me on the same step.”
- “Find recipes in my cookbook that use mascarpone.”
- “Save this recipe to Google Docs and tag it as a dessert.”

## Submit the plugin for public listing

Download [cook-it-plugin.zip](cook-it-plugin.zip?raw=1) and upload it through the [OpenAI plugin submission portal](https://platform.openai.com/plugins). Follow the [submission guide](https://developers.openai.com/plugins/deploy/submission) for review and publication.
