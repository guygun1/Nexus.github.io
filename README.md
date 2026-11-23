# Nexus.github.io

Documentation site, served by GitHub Pages from the `docs/` folder.

- Content: `docs/documentation/` (folders are categories, `.md` files are pages). See `docs/documentation/README.md`.
- Index: `node docs/scripts/build-index.mjs` regenerates `docs/documentation/manifest.json`. The GitHub Action in `.github/workflows/` does this on every push.
- Preview locally: `cd docs && python -m http.server`, then open http://localhost:8000
