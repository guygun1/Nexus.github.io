# How to add documentation

Everything in this folder is the content of the site. Folders are categories, `.md` files are pages.

```
documentation/
  coding/                      <- category (also becomes a tag: "coding")
    from_scratch/              <- sub-category
      rendering/               <- sub-category: its pages fill the sidebar
        main.md
        continuation.md
```

Each page starts with optional front matter:

```
---
title: Rendering basics
description: One line shown in search results.
tags: [graphics, beginner]
order: 1
---
```

- `title`: falls back to the first `# Heading`, then the file name.
- `tags`: extra tags. The top-level folder is always added as a tag.
- `order`: position in the sidebar of the category. `main.md` always comes first.
- `draft: true`: hides the page.

Optional: put a `_category.json` in a folder to give it a nicer name:

```
{ "title": "From scratch", "description": "Build it yourself.", "order": 1 }
```

After adding files run `node docs/scripts/build-index.mjs` (the GitHub Action does this for you on push).
