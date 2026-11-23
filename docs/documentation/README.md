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

After adding or changing files run `node docs/scripts/build.mjs`, then commit everything it generated (`docs/doc/`, `docs/index.html`, `sitemap.xml`, ...). A GitHub Action also runs it when you push changes to this folder.

## Writing pages that show up in Google

Each page becomes its own address, for example `/doc/coding/from_scratch/rendering/main/`. Search engines match what people type against these parts, so write them for that:

- `title`: say what the page teaches, with the words a person would search. "Software rendering from scratch in C++" beats "Rendering: part 1".
- `description`: one plain sentence, about 150 characters. Google often shows it under the title.
- Headings (`##`, `###`): one per question the page answers. They also appear in "On this page".
- Folder and file names are part of the address. Use clear names such as `from_scratch`, `rendering`, `cpp`.
- One topic per page. Link related pages with relative links such as `[next part](continuation.md)`.

After deploying, submit `sitemap.xml` once in Google Search Console (Sitemaps). New pages are picked up from it.
