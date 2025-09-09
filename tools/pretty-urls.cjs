// Pretty URLs migrator for static HTML + sitemap
// - Internal href/src to pages:  /path/file.html  -> /path/file
// - Section indexes:             /path/index.html -> /path/
// - Canonicals & og/twitter url: set to pretty full URL per file
// - JSON-LD @id/url/breadcrumbs: strip .html (keep #anchors), fix /index.html -> /
// - Limits to site-internal links (leading slash or aduplanet.com)
// - Excludes /assets, /functions, node_modules

import { promises as fs } from "node:fs";
import { join, resolve, sep, posix } from "node:path";

const ROOT = resolve(".");
const SITE = "https://aduplanet.com";

const EXCLUDE_DIRS = new Set(["assets", "functions", "node_modules", ".git"]);
const HTML_EXT = ".html";

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile() && e.name.toLowerCase().endsWith(HTML_EXT)) out.push(p);
    else if (e.isFile() && e.name === "sitemap.xml") out.push(p); // handle sitemap too
  }
  return out;
}

function toWebPath(fsPath) {
  // Normalize Windows paths to web style
  const rel = fsPath.replace(ROOT + sep, "").split(sep).join("/");
  return rel.startsWith("/") ? rel : "/" + rel;
}

function prettyFromFile(fsPath) {
  const web = toWebPath(fsPath); // e.g., /regulations/seattle.html or /blog/index.html
  if (!web.endsWith(".html")) return web; // (sitemap.xml case)
  if (web.toLowerCase().endsWith("/index.html")) {
    const base = web.slice(0, -"/index.html".length);
    return base === "" ? "/" : base + "/"; // / -> /, /blog/index.html -> /blog/
  }
  return web.slice(0, -".html".length); // /foo/bar.html -> /foo/bar
}

function prettifyHref(href) {
  // Only touch internal (leading /) or full-site URLs
  const urlish = href.trim();

  // Leave anchors/mailto/tel and assets alone
  if (!urlish || urlish.startsWith("#") || urlish.startsWith("mailto:") || urlish.startsWith("tel:")) return href;

  // Full site absolute → reduce to path then pretty
  if (urlish.startsWith(SITE)) {
    const u = new URL(urlish);
    return SITE + prettifyPath(u.pathname) + (u.hash || "");
  }

  // Only transform leading-slash internal links
  if (!urlish.startsWith("/")) return href;

  return prettifyPath(urlish);
}

function prettifyPath(pathname) {
  // /path/index.html -> /path/
  // /path/file.html  -> /path/file
  // Everything else returns as-is
  if (/\/index\.html(\#.*)?$/i.test(pathname)) {
    return pathname.replace(/\/index\.html/i, "/");
  }
  if (/\.html(\#.*)?$/i.test(pathname)) {
    return pathname.replace(/\.html/i, "");
  }
  return pathname;
}

function replaceCanonicals(html, filePretty) {
  const full = SITE + filePretty;
  // rel=canonical
  html = html.replace(
    /<link\s+rel=["']canonical["']\s+href=["'][^"']+["']\s*\/?>/i,
    `<link rel="canonical" href="${full}" />`
  );
  // og:url
  html = html.replace(
    /<meta\s+property=["']og:url["']\s+content=["'][^"']+["']\s*\/?>/i,
    `<meta property="og:url" content="${full}" />`
  );
  // twitter:url
  html = html.replace(
    /<meta\s+name=["']twitter:url["']\s+content=["'][^"']+["']\s*\/?>/i,
    `<meta name="twitter:url" content="${full}" />`
  );
  return html;
}

function rewriteJSONLD(html) {
  // Only touch aduplanet.com URLs and leading-slash items inside JSON-LD blocks
  return html.replace(
    /(<script[^>]+type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    (_, open, json, close) => {
      let patched = json;

      // Full absolute URLs first (aduplanet.com only)
      patched = patched.replace(
        /https:\/\/aduplanet\.com\/([A-Za-z0-9/_\-]+?)(?:index\.html|\.html)(#[^"\\\s]*)?/g,
        (_m, p, anchor = "") => `https://aduplanet.com/${p.replace(/\/index$/i, "")}${anchor || ""}`.replace(/\/$/, "/")
      );

      // Then any remaining relative strings like "/foo/bar.html"
      patched = patched.replace(
        /"\/([A-Za-z0-9/_\-]+?)(?:index\.html|\.html)(#[^"]*)?"/g,
        (_m, p, anchor = "") => `"\/${p.replace(/\/index$/i, "")}${anchor || ""}"`
      );

      // Ensure directory indexes end with trailing slash in absolute form (e.g., /blog/)
      // Already handled above via replace(/\/index$/,'') which leaves /blog, so add slash for known sections if it’s a directory root with no file
      // (JSON-LD rarely requires trailing slash strictly; leaving as-is is fine)

      return open + patched + close;
    }
  );
}

function rewriteHrefs(html) {
  // Replace href values (and ONLY hrefs) that point to pages
  return html.replace(
    /\bhref=(["'])(\/[^"']+?)\1/gi,
    (m, q, url) => `href=${q}${prettifyHref(url)}${q}`
  );
}

function rewriteSitemapXml(xml) {
  // convert <loc>https://aduplanet.com/...index.html</loc> and .html to pretty
  return xml.replace(
    /(<loc>\s*https:\/\/aduplanet\.com\/)([^<]+?)(<\/loc>)/gi,
    (_, pre, path, post) => {
      let out = path;
      if (out.match(/\/index\.html$/i)) out = out.replace(/\/index\.html$/i, "/");
      else if (out.match(/\.html$/i)) out = out.replace(/\.html$/i, "");
      return pre + out + post;
    }
  );
}

function isSitemap(fsPath) {
  return fsPath.toLowerCase().endsWith("sitemap.xml");
}

(async () => {
  const files = await walk(ROOT);
  let changed = 0;

  for (const fsPath of files) {
    const raw = await fs.readFile(fsPath, "utf8");

    if (isSitemap(fsPath)) {
      const next = rewriteSitemapXml(raw);
      if (next !== raw) {
        await fs.writeFile(fsPath, next, "utf8");
        console.log("sitemap updated:", toWebPath(fsPath));
        changed++;
      }
      continue;
    }

    // HTML pages
    const prettyPath = prettyFromFile(fsPath); // per-file pretty URL
    let html = raw;

    html = replaceCanonicals(html, prettyPath);
    html = rewriteJSONLD(html);
    html = rewriteHrefs(html);

    if (html !== raw) {
      await fs.writeFile(fsPath, html, "utf8");
      console.log("rewrote:", toWebPath(fsPath), "→", prettyPath);
      changed++;
    }
  }

  console.log(`Done. Files changed: ${changed}`);
  console.log("Tip: run a grep for any leftover .html links:");
  console.log(`  git grep -nE 'href=\"/[^\"]+\\.html\"' -- ':!assets' ':!functions' ':!node_modules' || echo none`);
})();
