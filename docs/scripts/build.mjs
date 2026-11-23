#!/usr/bin/env node
// Builds the whole site from docs/documentation/**/*.md.
//
//   node docs/scripts/build.mjs
//
// Writes real HTML pages (so search engines can index them), the search index,
// sitemap.xml, robots.txt, 404.html and (if AdSense is configured) ads.txt.
// Settings live in docs/site.config.json.

import { readdir, readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const site = path.resolve(here, "..");
const contentRoot = path.join(site, "documentation");
const { marked } = require(path.join(site, "assets/vendor/marked.umd.js"));

const cfg = {
  siteName: "Nexus docs", siteDescription: "", siteUrl: "", repo: "", branch: "main",
  contentDir: "docs/documentation", adsense: { client: "", slot: "" },
  ...JSON.parse(await readFile(path.join(site, "site.config.json"), "utf8")),
};
cfg.siteUrl = cfg.siteUrl.replace(/\/+$/, "");
const adsOn = !!(cfg.adsense && cfg.adsense.client); // loader script, ads.txt, adblock notice
const adUnit = !!(adsOn && cfg.adsense.slot); // sidebar ad box needs a slot id too
const MAX_TEXT = 30000;

// ---------- small helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const unquote = (s) => s.replace(/^(['"])(.*)\1$/, "$2");
const humanize = (s) => { s = s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
const slugTag = (s) => String(s).trim().toLowerCase().replace(/\s+/g, "-");
const slugHead = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, "").trim().replace(/\s+/g, "-") || "section";
const encPath = (p) => p.split("/").map(encodeURIComponent).join("/");
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;
const dirOf = (id) => (id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : "");
const baseOf = (id) => id.slice(id.lastIndexOf("/") + 1);

function parseFrontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { data: {}, body: src };
  const data = {};
  let listKey = null;
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) { data[listKey].push(unquote(item[1])); continue; }
    const kv = line.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const val = raw.trim();
    if (val === "") { data[key] = []; listKey = key; continue; }
    listKey = null;
    if (val.startsWith("[") && val.endsWith("]")) data[key] = val.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
    else if (/^-?\d+(\.\d+)?$/.test(val)) data[key] = Number(val);
    else if (val === "true" || val === "false") data[key] = val === "true";
    else data[key] = unquote(val);
  }
  return { data, body: src.slice(m[0].length) };
}
function plainText(md) {
  return md.replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*/g, " ")).replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "").replace(/[*_>~|]/g, " ").replace(/\s+/g, " ").trim();
}
function headingsOf(md) {
  const out = []; let fenced = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const h = line.match(/^(#{2,3})\s+(.*?)\s*#*$/);
    if (h) out.push(plainText(h[2]));
  }
  return out;
}
function shorten(text, n) {
  if (text.length <= n) return text;
  const cut = text.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(" "), n - 30)).replace(/[,;:.\s]+$/, "") + "…";
}

async function walk(dir, rel = "") {
  const files = [], dirs = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || (e.name.startsWith("_") && e.name !== "_category.json")) continue;
    const abs = path.join(dir, e.name), r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { dirs.push(r); const s = await walk(abs, r); files.push(...s.files); dirs.push(...s.dirs); }
    else files.push(r);
  }
  return { files, dirs };
}

// ---------- read content ----------
if (!existsSync(contentRoot)) { console.error(`Missing ${contentRoot}`); process.exit(1); }
const { files, dirs: dirList } = await walk(contentRoot);

const pages = [];
for (const f of files.filter((f) => /\.md$/i.test(f) && f.toLowerCase() !== "readme.md")) {
  const src = (await readFile(path.join(contentRoot, f), "utf8")).replace(/^\uFEFF/, "");
  const { data, body } = parseFrontMatter(src);
  if (data.draft === true || data.hidden === true) continue;
  const id = f.replace(/\.md$/i, "");
  const h1 = body.match(/^#\s+(.+?)\s*#*$/m);
  const title = data.title || (h1 && plainText(h1[1])) || humanize(baseOf(id));
  const explicit = (Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []).map(slugTag);
  const top = id.includes("/") ? [slugTag(id.split("/")[0])] : [];
  const text = plainText(body);
  pages.push({
    id, dir: dirOf(id), name: baseOf(id), title, body,
    description: data.description || shorten(text.replace(/^.*?\s{0}/, ""), 155),
    hasDescription: !!data.description,
    tags: [...new Set([...top, ...explicit])],
    order: typeof data.order === "number" ? data.order : null,
    headings: headingsOf(body),
    text: text.slice(0, MAX_TEXT),
  });
}
pages.sort((a, b) => collator.compare(a.id, b.id));
const byId = Object.fromEntries(pages.map((p) => [p.id, p]));

const dirSet = new Set();
for (const p of pages) { const parts = p.dir ? p.dir.split("/") : []; for (let i = 1; i <= parts.length; i++) dirSet.add(parts.slice(0, i).join("/")); }
const categories = {};
for (const d of dirList) {
  let meta = {};
  const mp = path.join(contentRoot, d, "_category.json");
  if (existsSync(mp)) { try { meta = JSON.parse(await readFile(mp, "utf8")); } catch (e) { console.warn(`Bad JSON: ${d}/_category.json`); } }
  categories[d] = { title: meta.title || humanize(baseOf(d)), description: meta.description || "", order: typeof meta.order === "number" ? meta.order : null };
  const parts = d.split("/"); for (let i = 1; i <= parts.length; i++) dirSet.add(parts.slice(0, i).join("/"));
}
for (const d of dirSet) if (!categories[d]) categories[d] = { title: humanize(baseOf(d)), description: "", order: null };

const dirTitle = (d) => categories[d].title;
function sortPages(list) {
  return list.slice().sort((a, b) => {
    const am = a.name === "main" ? 0 : 1, bm = b.name === "main" ? 0 : 1;
    if (am !== bm) return am - bm;
    const ao = a.order ?? 1e9, bo = b.order ?? 1e9;
    return ao !== bo ? ao - bo : collator.compare(a.title, b.title);
  });
}
const pagesIn = (dir) => sortPages(pages.filter((p) => p.dir === dir));
const countUnder = (dir) => pages.filter((p) => p.id.startsWith(dir ? dir + "/" : "")).length;
const childDirs = (dir) => [...dirSet].filter((d) => dirOf(d) === dir).sort((a, b) => {
  const ao = categories[a].order ?? 1e9, bo = categories[b].order ?? 1e9;
  return ao !== bo ? ao - bo : collator.compare(dirTitle(a), dirTitle(b));
});
const tagCounts = {};
for (const p of pages) for (const t of p.tags) tagCounts[t] = (tagCounts[t] || 0) + 1;
const sortedTags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a] || collator.compare(a, b));

// ---------- urls ----------
// Output folder of a page / category (relative to docs/). A folder and a page with the same id: the page wins.
const outDirOfPage = (id) => `doc/${id}`;
const outDirOfCat = (dir) => (byId[dir] ? outDirOfPage(dir) : `doc/${dir}`);
const rootOf = (from) => (from ? "../".repeat(from.split("/").length) : "");
function relUrl(from, to) {
  const r = path.posix.relative(from || ".", to || ".");
  return r ? r + "/" : "./";
}
const pageUrl = (from, id) => relUrl(from, outDirOfPage(id));
const catUrl = (from, dir) => relUrl(from, outDirOfCat(dir));
const absUrl = (outDir) => `${cfg.siteUrl}/${outDir ? encPath(outDir) + "/" : ""}`;

// ---------- markdown ----------
const state = { dir: "", from: "", root: "", used: null, heads: null };
marked.use({
  gfm: true,
  renderer: {
    heading(token) {
      const inner = this.parser.parseInline(token.tokens);
      const plain = token.text.replace(/[*_`]/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
      let id = slugHead(plain), n = 2;
      const base = id;
      while (state.used.has(id)) id = `${base}-${n++}`;
      state.used.add(id);
      if (token.depth === 2 || token.depth === 3) state.heads.push({ depth: token.depth, id, text: plain });
      const link = token.depth > 1 ? `<a class="hash-link" href="#${id}" aria-label="Direct link to ${esc(plain)}">#</a>` : "";
      return `<h${token.depth} id="${id}">${inner}${link}</h${token.depth}>\n`;
    },
    code(token) {
      const lang = (token.lang || "").match(/\S+/)?.[0];
      return `<div class="code"><pre><code${lang ? ` class="language-${esc(lang)}"` : ""}>${esc(token.text)}</code></pre></div>\n`;
    },
  },
  walkTokens(tok) {
    if (tok.type !== "link" && tok.type !== "image") return;
    const href = tok.href || "";
    if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("/")) return;
    const m = href.match(/^([^#?]*)([?#].*)?$/);
    const rest = m[2] || "";
    const segs = state.dir ? state.dir.split("/") : [];
    for (const s of m[1].split("/")) { if (!s || s === ".") continue; if (s === "..") segs.pop(); else segs.push(s); }
    const target = segs.join("/");
    const frag = rest.includes("#") ? rest.slice(rest.indexOf("#")) : "";
    if (tok.type === "link" && /\.md$/i.test(m[1])) {
      const id = target.replace(/\.md$/i, "");
      if (!byId[id]) console.warn(`  broken link in ${state.dir || "."}: ${href}`);
      tok.href = pageUrl(state.from, id) + frag;
    } else if (tok.type === "link" && !/\.[a-z0-9]+$/i.test(m[1]) && dirSet.has(target)) {
      tok.href = catUrl(state.from, target) + frag;
    } else {
      tok.href = `${state.root}documentation/${encPath(target)}${rest}`;
    }
  },
});

function renderMarkdown(p, from) {
  Object.assign(state, { dir: p.dir, from, root: rootOf(from), used: new Set(), heads: [] });
  let body = p.body;
  if (!/^\s*#\s+\S/.test(body)) body = `# ${p.title}\n\n${body}`;
  const html = marked.parse(body, { async: false })
    .replace(/<a href="(https?:\/\/[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"');
  return { html, heads: state.heads };
}

// ---------- shared html ----------
const ICON_SEARCH = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M14.386 14.386l4.088 4.088-4.088-4.088A7.533 7.533 0 1 1 3.733 3.733a7.533 7.533 0 0 1 10.653 10.653z" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/></svg>';
const ICON_HOME = '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 19v-5h4v5c0 .55.45 1 1 1h3c.55 0 1-.45 1-1v-7h1.7c.46 0 .68-.57.33-.87L12.67 3.6c-.38-.34-.96-.34-1.34 0l-8.36 7.53c-.34.3-.13.87.33.87H5v7c0 .55.45 1 1 1h3c.55 0 1-.45 1-1z" fill="currentColor"/></svg>';
const ICON_EDIT = '<svg width="14" height="14" viewBox="0 0 40 40" aria-hidden="true"><g fill="currentColor"><path d="m34.5 11.7-3 3.1-6.3-6.3 3.1-3q.5-.5 1.2-.5t1.1.5l3.9 3.9q.5.4.5 1.1t-.5 1.2zm-29.5 17.1 18.4-18.5 6.3 6.3-18.4 18.4h-6.3v-6.2z"/></g></svg>';

const assetHash = createHash("sha1");
for (const f of ["assets/style.css", "assets/site.js", "assets/img/logo.svg"]) assetHash.update(await readFile(path.join(site, f)));
const V = assetHash.digest("hex").slice(0, 8);

const tagBadge = (from, t, on) => `<a class="tag${on ? " is-on" : ""}" href="${rootOf(from)}search/?tag=${encodeURIComponent(t)}">${esc(t)}${tagCounts[t] ? ` <span>${tagCounts[t]}</span>` : ""}</a>`;

function crumbs(from, dir, last) {
  const parts = dir ? dir.split("/") : [];
  const items = [`<li><a href="${rootOf(from) || "./"}" aria-label="Home">${ICON_HOME}</a></li>`];
  parts.forEach((_, i) => {
    const d = parts.slice(0, i + 1).join("/");
    const isLast = !last && i === parts.length - 1;
    items.push(`<li>${isLast ? `<span aria-current="page">${esc(dirTitle(d))}</span>` : `<a href="${catUrl(from, d)}">${esc(dirTitle(d))}</a>`}</li>`);
  });
  if (last) items.push(`<li><span aria-current="page">${esc(last)}</span></li>`);
  return `<nav aria-label="Breadcrumbs"><ol class="crumbs">${items.join("")}</ol></nav>`;
}
function breadcrumbLd(from, dir, lastTitle, lastOut) {
  const list = [{ name: "Home", url: absUrl("") }];
  const parts = dir ? dir.split("/") : [];
  parts.forEach((_, i) => { const d = parts.slice(0, i + 1).join("/"); list.push({ name: dirTitle(d), url: absUrl(outDirOfCat(d)) }); });
  if (lastTitle) list.push({ name: lastTitle, url: absUrl(lastOut) });
  return { "@type": "BreadcrumbList", itemListElement: list.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.name, item: x.url })) };
}

function sidebar(from, dir, activeId, onCategory) {
  const items = [];
  if (dir) {
    const parent = dirOf(dir);
    items.push(`<li><a class="menu-link menu-up" href="${parent ? catUrl(from, parent) : rootOf(from) || "./"}">${esc(parent ? dirTitle(parent) : "All documentation")}</a></li>`);
    items.push(`<li class="menu-title"><a href="${catUrl(from, dir)}"${onCategory ? ' aria-current="page"' : ""}>${esc(dirTitle(dir))}</a></li>`);
  }
  const here = pagesIn(dir).filter((p) => !(p.id === dir));
  for (const p of here) items.push(`<li><a class="menu-link" href="${pageUrl(from, p.id)}"${p.id === activeId ? ' aria-current="page"' : ""}>${esc(p.title)}</a></li>`);
  const subs = childDirs(dir);
  if (here.length && subs.length) items.push('<li class="menu-sep" role="separator"></li>');
  for (const d of subs) items.push(`<li><a class="menu-link has-sub" href="${catUrl(from, d)}">${esc(dirTitle(d))}</a></li>`);
  const ad = adUnit
    ? `<div class="ad-slot" aria-label="Advertisement"><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(cfg.adsense.client)}" data-ad-slot="${esc(cfg.adsense.slot)}" data-ad-format="auto" data-full-width-responsive="false"></ins></div>`
    : "";
  return `<nav class="sidebar" id="sidebar" aria-label="Docs sidebar"><ul class="menu">${items.join("")}</ul>${ad}</nav>`;
}

function shell({ from, title, desc, canonicalOut, noindex, kind, main, ld, withSidebar, ogType = "website", base }) {
  const root = rootOf(from);
  const r = root || "./";
  const fullTitle = kind === "home" ? title : `${title} - ${cfg.siteName}`;
  const canonical = canonicalOut === undefined ? "" : absUrl(canonicalOut);
  const gh = cfg.repo ? `https://github.com/${cfg.repo}` : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
${base ? `<base href="${esc(base)}">\n` : ""}<title>${esc(fullTitle)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">' : '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large">'}
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ""}
<meta property="og:site_name" content="${esc(cfg.siteName)}">
<meta property="og:type" content="${ogType}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ""}
<meta name="twitter:card" content="summary">
<link rel="icon" href="${root}assets/img/logo.svg?v=${V}" type="image/svg+xml">
<link rel="stylesheet" href="${root}assets/style.css?v=${V}">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}
${adsOn ? `<meta name="google-adsense-account" content="${esc(cfg.adsense.client)}">
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(cfg.adsense.client)}" crossorigin="anonymous" onerror="window.__adsBlocked=1"></script>` : ""}
</head>
<body class="${kind === "home" ? "is-home " : ""}${withSidebar ? "" : "no-sidebar"}" data-root="${root}" data-kind="${kind}"${adsOn ? ' data-ads="1"' : ""}>
<a class="skip" href="#main">Skip to main content</a>
<nav class="navbar" aria-label="Main">
  <button class="menu-btn" id="menu-btn" type="button" aria-label="Toggle navigation bar" aria-expanded="false"><svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true"><path stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="2" d="M4 7h22M4 15h22M4 23h22"/></svg></button>
  <a class="brand" href="${r}"><img src="${root}assets/img/logo.svg?v=${V}" alt="" width="32" height="32"><strong>${esc(cfg.siteName.replace(/\s*docs$/i, "") || cfg.siteName)}</strong></a>
  <a class="nav-link" href="${r}">Documentation</a>
  <span class="grow"></span>
  ${gh ? `<a class="nav-link nav-gh" href="${gh}" target="_blank" rel="noopener noreferrer">GitHub</a>` : ""}
  <form class="nav-search" role="search" action="${root}search/" method="get" autocomplete="off">
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M14.386 14.386l4.088 4.088-4.088-4.088A7.533 7.533 0 1 1 3.733 3.733a7.533 7.533 0 0 1 10.653 10.653z" stroke="currentColor" fill="none" stroke-width="2" stroke-linecap="round"/></svg>
    <label class="sr" for="q-top">Search</label>
    <input id="q-top" name="q" type="search" placeholder="Search" spellcheck="false"><kbd aria-hidden="true">/</kbd>
  </form>
</nav>
<div class="backdrop" id="backdrop"></div>
<main id="main" tabindex="-1">
${main}
</main>
${kind === "doc" ? `<script src="${root}assets/vendor/highlight.min.js"></script>\n` : ""}<script src="${root}assets/site.js?v=${V}"></script>
</body>
</html>
`;
}

const withSidebar = (from, dir, activeId, onCategory, inner) =>
  `<div class="docs">${sidebar(from, dir, activeId, onCategory)}<div class="docs-main">${inner}</div></div>`;
const docListItem = (from, p) => `<li><a href="${pageUrl(from, p.id)}">${esc(p.title)}</a>${p.hasDescription ? `<p>${esc(p.description)}</p>` : ""}</li>`;

// ---------- generate ----------
const out = new Map();
const urls = [{ loc: absUrl("") }];

// doc pages
for (const p of pages) {
  const from = outDirOfPage(p.id);
  const root = rootOf(from);
  const { html, heads } = renderMarkdown(p, from);
  const siblings = pagesIn(p.dir);
  const i = siblings.indexOf(p);
  let after = "";
  if (p.tags.length) after += `<div class="doc-tags"><b>Tags:</b> ${p.tags.map((t) => tagBadge(from, t)).join(" ")}</div>`;
  if (cfg.repo) after += `<div class="edit-row"><a href="https://github.com/${cfg.repo}/edit/${cfg.branch}/${cfg.contentDir}/${encPath(p.id)}.md" target="_blank" rel="noopener noreferrer">${ICON_EDIT} Edit this page</a></div>`;
  let pag = "";
  if (i > 0) pag += `<a class="prev" href="${pageUrl(from, siblings[i - 1].id)}"><small>Previous</small><b>« ${esc(siblings[i - 1].title)}</b></a>`;
  if (i >= 0 && i < siblings.length - 1) pag += `<a class="next" href="${pageUrl(from, siblings[i + 1].id)}"><small>Next</small><b>${esc(siblings[i + 1].title)} »</b></a>`;
  if (pag) after += `<nav class="pagination" aria-label="Docs pages">${pag}</nav>`;
  const toc = heads.length >= 2
    ? `<aside class="toc" aria-label="On this page"><h2>On this page</h2><ul>${heads.map((h) => `<li class="l${h.depth}"><a href="#${h.id}" data-id="${h.id}">${esc(h.text)}</a></li>`).join("")}</ul></aside>`
    : "";
  const main = withSidebar(from, p.dir, p.id, false,
    `<div class="docs-grid${toc ? "" : " no-toc"}"><div class="docs-col">${crumbs(from, p.dir, p.title)}<article class="markdown">${html}</article>${after}</div>${toc}</div>`);
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "TechArticle", headline: p.title, description: p.description, url: absUrl(from), mainEntityOfPage: absUrl(from), inLanguage: "en", keywords: p.tags.join(", "), isPartOf: { "@type": "WebSite", name: cfg.siteName, url: absUrl("") } },
      breadcrumbLd(from, p.dir, p.title, from),
    ],
  };
  out.set(`${from}/index.html`, shell({ from, title: p.title, desc: p.description || cfg.siteDescription, canonicalOut: from, kind: "doc", main, ld, withSidebar: true, ogType: "article" }));
  urls.push({ loc: absUrl(from) });
}

// category pages
for (const dir of dirSet) {
  if (byId[dir]) continue;
  const from = outDirOfCat(dir);
  const info = categories[dir];
  const ps = pagesIn(dir), subs = childDirs(dir);
  let inner = crumbs(from, dir) + `<div class="cat-head"><h1>${esc(info.title)}</h1>${info.description ? `<p>${esc(info.description)}</p>` : ""}</div>`;
  if (ps.length) inner += `<h2 class="list-title">Pages</h2><ul class="doc-list">${ps.map((p) => docListItem(from, p)).join("")}</ul>`;
  if (subs.length) inner += `<h2 class="list-title">Sections</h2><ul class="doc-list">${subs.map((d) => `<li><a href="${catUrl(from, d)}">${esc(dirTitle(d))}</a><p>${categories[d].description ? esc(categories[d].description) + " " : ""}${plural(countUnder(d), "page")}</p></li>`).join("")}</ul>`;
  const desc = info.description || `${info.title}: ${plural(countUnder(dir), "page")} in the ${cfg.siteName}.`;
  const ld = { "@context": "https://schema.org", ...breadcrumbLd(from, dir, null, from) };
  out.set(`${from}/index.html`, shell({ from, title: info.title, desc, canonicalOut: from, kind: "category", main: withSidebar(from, dir, null, true, inner), ld, withSidebar: true }));
  urls.push({ loc: absUrl(from) });
}

// home
{
  const from = "";
  const top = childDirs("");
  let body = `<header class="hero"><div class="container"><h1>${esc(cfg.siteName.replace(/\s*docs$/i, "") || cfg.siteName)}</h1><p>Documentation</p>
<form class="hero-search" role="search" action="search/" method="get" autocomplete="off">${ICON_SEARCH}<label class="sr" for="q-hero">Search documentation</label><input id="q-hero" name="q" type="search" placeholder="Search the documentation" spellcheck="false"><kbd aria-hidden="true">/</kbd></form>
<p class="home-hint">Narrow by tag with <code>tag:coding</code></p></div></header><div class="container home-body">`;
  if (!pages.length) {
    body += '<div class="admonition"><h3>No documentation yet</h3><p>Add a Markdown file such as <code>docs/documentation/coding/from_scratch/rendering/main.md</code>, then run <code>node docs/scripts/build.mjs</code>.</p><p>The page format is described in <code>docs/documentation/README.md</code>.</p></div>';
  } else {
    if (top.length) body += `<h2>Categories</h2><ul class="features">${top.map((d) => `<li><h3><a href="${catUrl(from, d)}">${esc(dirTitle(d))}</a></h3>${categories[d].description ? `<p>${esc(categories[d].description)}</p>` : ""}<small>${plural(countUnder(d), "page")}</small></li>`).join("")}</ul>`;
    const loose = pagesIn("");
    if (loose.length) body += `<h2>Pages</h2><ul class="doc-list">${loose.map((p) => docListItem(from, p)).join("")}</ul>`;
    if (sortedTags.length) body += `<h2>Tags</h2><ul class="tag-list">${sortedTags.map((t) => `<li>${tagBadge(from, t)}</li>`).join("")}</ul>`;
  }
  body += "</div>";
  const ld = { "@context": "https://schema.org", "@type": "WebSite", name: cfg.siteName, url: absUrl(""), description: cfg.siteDescription, potentialAction: { "@type": "SearchAction", target: `${absUrl("")}search/?q={search_term_string}`, "query-input": "required name=search_term_string" } };
  out.set("index.html", shell({ from, title: `${cfg.siteName.replace(/\s*docs$/i, "")} documentation`, desc: cfg.siteDescription, canonicalOut: "", kind: "home", main: body, ld, withSidebar: false }));
}

// search page (client-rendered, not indexed)
out.set("search/index.html", shell({
  from: "search", title: "Search", desc: "Search the documentation", noindex: true, kind: "search", withSidebar: false,
  main: '<div class="container search-page"><h1>Search results</h1><div id="search-root"><noscript><p>Search needs JavaScript.</p></noscript></div></div>',
}));

// 404
out.set("404.html", shell({
  from: "", title: "Page not found", desc: "Page not found", noindex: true, kind: "404", withSidebar: false, base: `${cfg.siteUrl}/`,
  main: '<div class="container search-page"><h1>Page not found</h1><div class="admonition"><p>This page does not exist. Use the search box, or go to the <a href="./">home page</a>.</p></div></div>',
}));

// search index
const manifest = {
  version: 2,
  pages: pages.map((p) => ({ id: p.id, title: p.title, description: p.hasDescription ? p.description : "", tags: p.tags, order: p.order, headings: p.headings, text: p.text })),
  categories,
};
out.set("documentation/manifest.json", JSON.stringify(manifest) + "\n");

// robots, sitemap, ads.txt
out.set("robots.txt", `User-agent: *\nAllow: /\n\nSitemap: ${cfg.siteUrl}/sitemap.xml\n`);
out.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(u.loc)}</loc></url>`).join("\n")}\n</urlset>\n`);
if (adsOn) out.set("ads.txt", `google.com, ${cfg.adsense.client.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`);

// ---------- write ----------
let written = 0;
for (const [rel, content] of out) {
  const abs = path.join(site, rel);
  if (existsSync(abs) && (await readFile(abs, "utf8")) === content) continue;
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content);
  written++;
}
// remove generated pages that no longer have a source
async function listFiles(dir, rel = "") {
  if (!existsSync(dir)) return [];
  const r = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const a = path.join(dir, e.name), q = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) r.push(...(await listFiles(a, q))); else r.push(q);
  }
  return r;
}
for (const f of await listFiles(path.join(site, "doc"), "doc")) {
  if (out.has(f)) continue;
  try { await unlink(path.join(site, f)); console.log(`removed stale ${f}`); } catch { console.warn(`could not remove stale ${f} (delete it by hand)`); }
}
console.log(`built ${pages.length} page(s), ${dirSet.size} categor${dirSet.size === 1 ? "y" : "ies"}; ${written} file(s) written; assets ?v=${V}${adsOn ? (adUnit ? "; ads ON (sidebar unit)" : "; AdSense script ON, no sidebar unit yet (set adsense.slot)") : "; ads off (set adsense.client in site.config.json)"}`);
