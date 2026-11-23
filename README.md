# Nexus.github.io

Documentation site, served by GitHub Pages from the `docs/` folder (Settings, Pages, branch `main`, folder `/docs`).

- Write pages in `docs/documentation/` (folders are categories, `.md` files are pages). See `docs/documentation/README.md`.
- Build: `node docs/scripts/build.mjs`. It generates a real HTML page per document in `docs/doc/`, plus `sitemap.xml`, `robots.txt`, the search index and `404.html`. Commit the generated files.
- Settings (site URL, repo, AdSense): `docs/site.config.json`.
- Preview: `cd docs && python -m http.server`, then open http://localhost:8000
