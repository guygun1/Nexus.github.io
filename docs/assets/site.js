/* Small client script for the static pages: search, code blocks, "On this page"
 * highlight, mobile menu, and the AdSense sidebar unit with its ad-blocker notice. */
(function () {
  "use strict";

  var body = document.body;
  var root = body.getAttribute("data-root") || "";
  var kind = body.getAttribute("data-kind");

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function plural(n, one) { return n + " " + (n === 1 ? one : one + "s"); }
  function humanize(s) { s = s.replace(/[_-]+/g, " ").trim(); return s.charAt(0).toUpperCase() + s.slice(1); }
  var collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

  // ---------- mobile menu + "/" shortcut ----------
  var menuBtn = document.getElementById("menu-btn");
  function setDrawer(open) {
    body.classList.toggle("sidebar-open", open);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
  }
  if (menuBtn) menuBtn.addEventListener("click", function () { setDrawer(!body.classList.contains("sidebar-open")); });
  var backdrop = document.getElementById("backdrop");
  if (backdrop) backdrop.addEventListener("click", function () { setDrawer(false); });
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && tag !== "input" && tag !== "textarea" && !e.target.isContentEditable) {
      var input = document.getElementById("q-hero") || document.getElementById("q-top");
      if (input) { e.preventDefault(); input.focus(); }
    }
    if (e.key === "Escape") setDrawer(false);
  });

  // ---------- code blocks ----------
  [].slice.call(document.querySelectorAll(".code")).forEach(function (wrap) {
    var code = wrap.querySelector("pre > code");
    if (!code) return;
    var m = (code.className || "").match(/language-([\w+-]+)/);
    if (m && window.hljs && hljs.getLanguage(m[1])) { try { hljs.highlightElement(code); } catch (e) {} }
    var btn = document.createElement("button");
    btn.type = "button"; btn.className = "copy"; btn.textContent = "Copy";
    btn.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(code.textContent).then(function () {
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = "Copy"; }, 1500);
      }, function () {});
    });
    wrap.appendChild(btn);
  });

  // ---------- "On this page" highlight ----------
  var toc = document.querySelector(".toc");
  if (toc && "IntersectionObserver" in window) {
    var links = {};
    [].forEach.call(toc.querySelectorAll("a"), function (a) { links[a.getAttribute("data-id")] = a; });
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        [].forEach.call(toc.querySelectorAll(".is-active"), function (x) { x.classList.remove("is-active"); });
        if (links[e.target.id]) links[e.target.id].classList.add("is-active");
      });
    }, { rootMargin: "-72px 0px -70% 0px" });
    Object.keys(links).forEach(function (id) { var h = document.getElementById(id); if (h) obs.observe(h); });
  }

  // ---------- ads ----------
  if (body.getAttribute("data-ads") === "1") initAds();

  function initAds() {
    // the sidebar unit (present only when a slot id is configured)
    [].forEach.call(document.querySelectorAll("ins.adsbygoogle"), function () {
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) {}
    });

    var COOKIE = "nexus_adblock_ok";
    var cookiePath = "/";
    try { cookiePath = new URL(root || "./", location.href).pathname; } catch (e) {}
    if (document.cookie.split("; ").some(function (c) { return c.indexOf(COOKIE + "=") === 0; })) return;

    // bait element: ad blockers hide elements with these class names
    var bait = document.createElement("div");
    bait.className = "adsbox ad-banner pub_300x250 text-ad";
    bait.style.cssText = "position:absolute;left:-9999px;top:0;width:10px;height:10px;";
    bait.innerHTML = "&nbsp;";
    body.appendChild(bait);

    setTimeout(function () {
      var cs = window.getComputedStyle(bait);
      var blocked = window.__adsBlocked === 1 || bait.offsetHeight === 0 || cs.display === "none" || cs.visibility === "hidden";
      bait.remove();
      if (blocked) showNotice();
    }, 1500);

    function showNotice() {
      var box = document.createElement("div");
      box.className = "adblock-note";
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "Ad blocker notice");
      box.innerHTML =
        "<p><strong>Please allow ads on this site.</strong> The small ad in the sidebar is what pays for keeping this documentation online and updated. Disable your ad blocker for this website to help, then reload.</p>" +
        '<button type="button" class="note-ok">OK</button>';
      body.appendChild(box);
      box.querySelector(".note-ok").addEventListener("click", function () {
        document.cookie = COOKIE + "=1; max-age=31536000; path=" + cookiePath + "; SameSite=Lax";
        box.remove();
      });
    }
  }

  // ---------- search page ----------
  if (kind !== "search") return;

  var mount = document.getElementById("search-root");
  var topInput = document.getElementById("q-top");
  var topForm = topInput.form;
  var DATA = null;

  function hrefFor(id) { return root + "doc/" + id.split("/").map(encodeURIComponent).join("/") + "/"; }
  function searchHref(q, tags) {
    var p = new URLSearchParams();
    if (q) p.set("q", q);
    (tags || []).forEach(function (t) { p.append("tag", t); });
    var s = p.toString();
    return root + "search/" + (s ? "?" + s : "");
  }
  function dirTitle(d) { var c = DATA.categories[d]; return (c && c.title) || humanize(d.split("/").pop()); }
  function crumbPath(p) {
    var parts = p.dir ? p.dir.split("/") : [];
    return parts.map(function (_, i) { return dirTitle(parts.slice(0, i + 1).join("/")); }).join(" › ");
  }

  function parseQuery(raw) {
    var tags = [], words = [];
    raw.trim().split(/\s+/).forEach(function (tok) {
      if (!tok) return;
      var m = tok.match(/^tag:(.+)$/i);
      if (m) tags.push(m[1].toLowerCase());
      else tok.toLowerCase().split(/[^\p{L}\p{N}]+/u).forEach(function (w) { if (w) words.push(w); });
    });
    return { words: words, tags: tags };
  }
  function scoreWord(p, w) {
    var s = 0;
    var starts = new RegExp("(^|[^\\p{L}\\p{N}])" + escRe(w), "u");
    if (starts.test(p._t)) s += 10; else if (p._t.indexOf(w) >= 0) s += 6;
    if (p.tags.some(function (t) { return t === w || t.indexOf(w) === 0; })) s += 8;
    if (p._h.indexOf(w) >= 0) s += 5;
    if (p._path.indexOf(w) >= 0) s += 4;
    if (p._d.indexOf(w) >= 0) s += 3;
    var c = 0, i = -1;
    while (c < 4 && (i = p._x.indexOf(w, i + 1)) >= 0) c++;
    return s + c;
  }
  function search(words, tags) {
    var pool = DATA.pages.filter(function (p) { return tags.every(function (t) { return p.tags.indexOf(t) >= 0; }); });
    if (!words.length) {
      return { partial: false, hits: pool.map(function (p) { return { p: p, s: 1 }; }).sort(function (a, b) { return collator.compare(a.p.title, b.p.title); }) };
    }
    function run(mode) {
      var out = [];
      pool.forEach(function (p) {
        var total = 0, ok = true;
        words.forEach(function (w) { var s = scoreWord(p, w); if (s === 0) ok = false; else total += s; });
        if (mode === "and" ? ok : total > 0) out.push({ p: p, s: total });
      });
      return out.sort(function (a, b) { return b.s - a.s || collator.compare(a.p.title, b.p.title); });
    }
    var hits = run("and");
    if (hits.length || words.length < 2) return { partial: false, hits: hits };
    return { partial: true, hits: run("or") };
  }
  function highlight(text, words) {
    if (!words.length) return esc(text);
    var re = new RegExp("(" + words.map(escRe).join("|") + ")", "gi");
    return text.split(re).map(function (part, i) { return i % 2 ? "<mark>" + esc(part) + "</mark>" : esc(part); }).join("");
  }
  function snippet(p, words) {
    var text = p.text || "", at = -1;
    for (var i = 0; i < words.length && at < 0; i++) at = p._x.indexOf(words[i]);
    if (at < 0) return p.description || text.slice(0, 160);
    var start = Math.max(0, at - 70), end = Math.min(text.length, at + 130);
    return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
  }

  function render() {
    var params = new URLSearchParams(location.search);
    var q = params.get("q") || "";
    var parsed = parseQuery(q);
    var tags = params.getAll("tag").map(function (t) { return t.toLowerCase(); }).concat(parsed.tags);
    tags = tags.filter(function (t, i) { return tags.indexOf(t) === i; });
    var rawQ = q.split(/\s+/).filter(function (t) { return !/^tag:/i.test(t); }).join(" ");
    var res = search(parsed.words, tags);
    document.title = (q ? "Search: " + q : tags.length ? "Tag: " + tags.join(", ") : "Search") + " - " + (document.title.split(" - ").pop() || "");
    if (document.activeElement !== topInput) topInput.value = q;

    var counts = {};
    res.hits.forEach(function (h) { h.p.tags.forEach(function (t) { if (tags.indexOf(t) < 0) counts[t] = (counts[t] || 0) + 1; }); });
    var addable = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || collator.compare(a, b); }).slice(0, 12);

    var html = "<h2 class=\"sr\">Results</h2>";
    var h1 = document.querySelector(".search-page h1");
    h1.textContent = rawQ || !tags.length ? "Search results" : "Tagged: " + tags.join(", ");
    if (tags.length) {
      html += '<div class="filter-row"><b>Filtering by tag</b>' + tags.map(function (t) {
        return '<a class="tag is-on" href="' + searchHref(rawQ, tags.filter(function (x) { return x !== t; })) + '" title="Remove this tag filter">' + esc(t) + " ×</a>";
      }).join("") + "</div>";
    }
    if (addable.length) {
      html += '<div class="filter-row"><b>' + (tags.length ? "Add tag" : "Tags") + "</b>" + addable.map(function (t) {
        return '<a class="tag" href="' + searchHref(rawQ, tags.concat(t)) + '">' + esc(t) + " <span>" + counts[t] + "</span></a>";
      }).join("") + "</div>";
    }
    if (!res.hits.length) {
      html += '<div class="admonition" style="margin-top:1.25rem"><h3>Nothing matched</h3><p>Try fewer or shorter words' + (tags.length ? ", or remove a tag filter" : "") + ".</p></div>";
    } else {
      html += '<p class="result-count">' + plural(res.hits.length, "page") + (res.partial ? " matching some of your words" : "") + " found</p>";
      html += '<ul class="results">' + res.hits.slice(0, 50).map(function (h) {
        var p = h.p, snip = snippet(p, parsed.words);
        return '<li><h2><a href="' + hrefFor(p.id) + '">' + highlight(p.title, parsed.words) + "</a></h2>" +
          (p.dir ? '<div class="path">' + esc(crumbPath(p)) + "</div>" : "") +
          (snip ? "<p>" + highlight(snip, parsed.words) + "</p>" : "") + "</li>";
      }).join("") + "</ul>";
      if (res.hits.length > 50) html += '<p class="result-count">Showing the first 50. Add a tag or another word to narrow it down.</p>';
    }
    mount.innerHTML = html;
  }

  topForm.addEventListener("submit", function (e) { e.preventDefault(); topInput.blur(); });
  topInput.addEventListener("input", function () {
    var params = new URLSearchParams(location.search);
    var tags = params.getAll("tag");
    history.replaceState(null, "", searchHref(topInput.value.trim() ? topInput.value : "", tags));
    render();
  });

  fetch(root + "documentation/manifest.json", { cache: "no-cache" }).then(function (r) {
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }).then(function (m) {
    m.pages.forEach(function (p) {
      p.dir = p.id.indexOf("/") < 0 ? "" : p.id.slice(0, p.id.lastIndexOf("/"));
      p._t = p.title.toLowerCase();
      p._h = (p.headings || []).join(" ").toLowerCase();
      p._path = p.id.replace(/[_\/-]+/g, " ").toLowerCase();
      p._d = (p.description || "").toLowerCase();
      p._x = (p.text || "").toLowerCase();
    });
    DATA = m;
    render();
  }).catch(function (err) {
    mount.innerHTML = '<div class="admonition"><h3>Search index could not load</h3><p>' + esc(err.message) + ". If you opened this file straight from disk, serve the <code>docs</code> folder instead, for example <code>python -m http.server</code>.</p></div>";
  });
})();
