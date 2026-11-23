# Cook-It for ChatGPT

Upload or paste a recipe, organize it with the Cook-It template, adjust servings, and cook step by step. Ask to export a recipe to get a downloadable Markdown file when the chat supports file creation, or copy the Markdown directly. You can store it anywhere and upload it again later.

Google Drive is optional. When Drive is connected and allows writes, Cook-It saves and updates recipes there by default. Otherwise it gives you Markdown to keep wherever you like. You can request a download at any time.

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

If you can't open a link, ask me to paste that file's contents. When I ask to save or update a saved recipe, use my connected Google Drive if write actions are available. Otherwise give me a downloadable Markdown file if you can create one, or give me copyable Markdown. If I ask to download or export, give me Markdown directly.
```

Pin the conversation in the sidebar so you can return to it later.

## Example requests

- “Guide me through making tortilla de patatas for four, one step at a time.”
- “Scale this recipe to six servings and keep me on the same step.”
- “Find recipes in my cookbook that use mascarpone.”
- “Organize this recipe I uploaded, scale it to six servings, and give me a Markdown file.”
- “Save this recipe to Google Docs and tag it as a dessert.”

## Submit the plugin for public listing

Download [cook-it-plugin.zip](cook-it-plugin.zip?raw=1) and upload it through the [OpenAI plugin submission portal](https://platform.openai.com/plugins). Follow the [submission guide](https://developers.openai.com/plugins/deploy/submission) for review and publication.
