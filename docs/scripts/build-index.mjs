#!/usr/bin/env node
// Scans docs/documentation/**/*.md and writes docs/documentation/manifest.json.
// Run:  node docs/scripts/build-index.mjs
// (A GitHub Action also runs this on every push, so you can just add .md files.)

import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "documentation");
const MAX_TEXT = 30000; // characters of body text kept per page for search

// ---------- front matter (small YAML subset) ----------
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
    if (val.startsWith("[") && val.endsWith("]")) {
      data[key] = val.slice(1, -1).split(",").map((s) => unquote(s.trim())).filter(Boolean);
    } else if (/^-?\d+(\.\d+)?$/.test(val)) data[key] = Number(val);
    else if (val === "true" || val === "false") data[key] = val === "true";
    else data[key] = unquote(val);
  }
  return { data, body: src.slice(m[0].length) };
}
const unquote = (s) => s.replace(/^(['"])(.*)\1$/, "$2");

// ---------- helpers ----------
const humanize = (s) =>
  s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^./, (c) => c.toUpperCase());
const slugTag = (s) => String(s).trim().toLowerCase().replace(/\s+/g, "-");

function plainText(md) {
  return md
    .replace(/```[\s\S]*?```/g, (b) => b.replace(/```\w*/g, " "))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_>~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function headingsOf(md) {
  const out = [];
  let fenced = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const h = line.match(/^(#{2,3})\s+(.*?)\s*#*$/);
    if (h) out.push(plainText(h[2]));
  }
  return out;
}

async function walk(dir, rel = "") {
  const files = [];
  const dirs = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".") || e.name.startsWith("_") && e.name !== "_category.json") continue;
    const abs = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      dirs.push(r);
      const sub = await walk(abs, r);
      files.push(...sub.files);
      dirs.push(...sub.dirs);
    } else files.push(r);
  }
  return { files, dirs };
}

// ---------- build ----------
if (!existsSync(root)) {
  console.error(`Missing folder: ${root}`);
  process.exit(1);
}
const { files, dirs } = await walk(root);

const pages = [];
for (const f of files.filter((f) => f.toLowerCase().endsWith(".md") && f.toLowerCase() !== "readme.md")) {
  const src = (await readFile(path.join(root, f), "utf8")).replace(/^﻿/, "");
  const { data, body } = parseFrontMatter(src);
  if (data.draft === true || data.hidden === true) continue;
  const id = f.replace(/\.md$/i, "");
  const parts = id.split("/");
  const name = parts[parts.length - 1];
  const h1 = body.match(/^#\s+(.+?)\s*#*$/m);
  const title = data.title || (h1 && plainText(h1[1])) || humanize(name);
  const explicitTags = (Array.isArray(data.tags) ? data.tags : data.tags ? [data.tags] : []).map(slugTag);
  const topFolder = parts.length > 1 ? [slugTag(parts[0])] : [];
  const tags = [...new Set([...topFolder, ...explicitTags])];
  pages.push({
    id,
    title,
    description: data.description || "",
    tags,
    order: typeof data.order === "number" ? data.order : null,
    headings: headingsOf(body),
    text: plainText(body).slice(0, MAX_TEXT),
  });
}

// optional per-folder metadata: _category.json  { "title": "...", "description": "...", "order": 1 }
const categories = {};
for (const d of dirs) {
  const metaPath = path.join(root, d, "_category.json");
  let meta = {};
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(await readFile(metaPath, "utf8")); }
    catch (e) { console.warn(`Bad JSON in ${d}/_category.json: ${e.message}`); }
  }
  categories[d] = {
    title: meta.title || humanize(d.split("/").pop()),
    description: meta.description || "",
    order: typeof meta.order === "number" ? meta.order : null,
  };
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
pages.sort((a, b) => collator.compare(a.id, b.id));

const manifest = { version: 1, pages, categories };
await writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest) + "\n");
console.log(`manifest.json: ${pages.length} page(s), ${Object.keys(categories).length} categor${Object.keys(categories).length === 1 ? "y" : "ies"}`);

// ---------- cache busting ----------
// GitHub Pages lets browsers cache CSS/JS for a while. Stamp index.html with a hash of
// the assets so a changed file is always fetched fresh.
const siteDir = path.resolve(here, "..");
const hash = createHash("sha1");
for (const f of ["assets/style.css", "assets/app.js", "assets/img/logo.svg"]) hash.update(await readFile(path.join(siteDir, f)));
const v = hash.digest("hex").slice(0, 8);
const indexPath = path.join(siteDir, "index.html");
const html = await readFile(indexPath, "utf8");
const stamped = html.replace(/(assets\/(?:style\.css|app\.js|img\/logo\.svg))(\?v=[0-9a-f]+)?/g, `$1?v=${v}`);
if (stamped !== html) { await writeFile(indexPath, stamped); console.log(`index.html: assets stamped ?v=${v}`); }
