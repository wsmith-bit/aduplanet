'use strict';
/**
 * tools/pretty-urls.cjs
 * Sitewide switch to pretty URLs:
 * - Rewrites internal links *.html -> pretty (/foo/bar.html -> /foo/bar, /x/index.html -> /x/)
 * - Fixes canonical / og:url / twitter:url to match each page’s pretty URL
 * - Updates JSON-LD @id/url/Breadcrumb item values
 * - Converts sitemap <loc> entries to pretty URLs
 * Skips: /assets, /functions, node_modules, .git
 */

const fs = require('fs').promises;
const path = require('path');

const ROOT = process.cwd();
const SITE = 'https://aduplanet.com';
const EXCLUDE = new Set(['assets', 'functions', 'node_modules', '.git']);

async function walk(dir) {
  const out = [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    if (EXCLUDE.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...(await walk(p)));
    } else if (e.isFile()) {
      const low = e.name.toLowerCase();
      if (low.endsWith('.html') || low === 'sitemap.xml') out.push(p);
    }
  }
  return out;
}

function toWebPath(fsPath) {
  const rel = fsPath.replace(ROOT + path.sep, '').split(path.sep).join('/');
  return rel.startsWith('/') ? rel : '/' + rel;
}

function prettyFromFile(fsPath) {
  const web = toWebPath(fsPath); // e.g., /regulations/seattle.html or /blog/index.html
  if (!/\.html$/i.test(web)) return web; // non-HTML (e.g., sitemap.xml)
  if (/\/index\.html$/i.test(web)) {
    const base = web.slice(0, -('/index.html'.length));
    return base === '' ? '/' : base + '/';
  }
  return web.replace(/\.html$/i, '');
}

function splitURL(u) {
  // returns { path, query, hash }
  const m = String(u).match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return { path: m[1] || '', query: m[2] || '', hash: m[3] || '' };
}

function prettifyPath(pathname) {
  if (/\/index\.html$/i.test(pathname)) return pathname.replace(/\/index\.html$/i, '/');
  if (/\.html$/i.test(pathname)) return pathname.replace(/\.html$/i, '');
  return pathname;
}

function prettifyHref(href) {
  const s = href.trim();
  if (!s || s.startsWith('#') || s.startsWith('mailto:') || s.startsWith('tel:')) return href;

  // Absolute to our site → operate on pathname only
  if (s.toLowerCase().startsWith(SITE)) {
    let after = s.slice(SITE.length);
    const parts = splitURL(after);
    return SITE + prettifyPath(parts.path) + parts.query + parts.hash;
  }

  // Internal links only (leading slash)
  if (s.startsWith('/')) {
    const parts = splitURL(s);
    return prettifyPath(parts.path) + parts.query + parts.hash;
  }

  // External or relative (no leading slash) → leave alone
  return href;
}

function replaceCanonicals(html, filePretty) {
  const full = SITE + filePretty;
  const hadCanon = /<link\s+rel=["']canonical["']\s+href=/i.test(html);
  const hadOg = /<meta\s+property=["']og:url["']/i.test(html);
  const hadTw = /<meta\s+name=["']twitter:url["']/i.test(html);

  html = html.replace(/<link\s+rel=["']canonical["']\s+href=["'][^"']+["']\s*\/?>/i,
                      `<link rel="canonical" href="${full}" />`);
  html = html.replace(/<meta\s+property=["']og:url["']\s+content=["'][^"']+["']\s*\/?>/i,
                      `<meta property="og:url" content="${full}" />`);
  html = html.replace(/<meta\s+name=["']twitter:url["']\s+content=["'][^"']+["']\s*\/?>/i,
                      `<meta name="twitter:url" content="${full}" />`);

  // If any were missing, inject them just after <head>
  return html.replace(/<head([^>]*)>/i, (m, attrs) => {
    let inject = '';
    if (!hadCanon) inject += `\n<link rel="canonical" href="${full}" />`;
    if (!hadOg) inject += `\n<meta property="og:url" content="${full}" />`;
    if (!hadTw) inject += `\n<meta name="twitter:url" content="${full}" />`;
    return `<head${attrs}>${inject}`;
  });
}

function rewriteJSONLD(html) {
  return html.replace(
    /(<script[^>]+type=["']application\/ld\+json["'][^>]*>)([\s\S]*?)(<\/script>)/gi,
    function (_whole, open, json, close) {
      let s = json;

      // Absolute site URLs
      s = s.replace(
        /https:\/\/aduplanet\.com\/([A-Za-z0-9/_\-]+?)(?:index\.html|\.html)((\?[^"\\\s]*)?#[^"\\\s]*)?/g,
        function (_m, p, tail) {
          const clean = p.replace(/\/index$/i, '');
          return 'https://aduplanet.com/' + clean + (tail || '');
        }
      );
      // Relative (leading slash) JSON strings
      s = s.replace(
        /"\/([A-Za-z0-9/_\-]+?)(?:index\.html|\.html)((\?[^"]*)?#[^"]*)?"/g,
        function (_m, p, tail) {
          const clean = p.replace(/\/index$/i, '');
          return '"/' + clean + (tail || '') + '"';
        }
      );
      return open + s + close;
    }
  );
}

function rewriteHrefs(html) {
  // Only touch href="...". Leave src alone (we don't want to break .css/.js).
  return html.replace(/\bhref=(["'])([^"']+)\1/gi, function (_m, q, url) {
    return 'href=' + q + prettifyHref(url) + q;
  });
}

function rewriteSitemapXml(xml) {
  // <loc>https://aduplanet.com/foo/index.html</loc> → /foo/
  // <loc>https://aduplanet.com/foo/bar.html</loc>   → /foo/bar
  return xml.replace(
    /(<loc>\s*https:\/\/aduplanet\.com\/)([^<]+?)(<\/loc>)/gi,
    function (_m, pre, pathPart, post) {
      let out = pathPart;
      if (/\/index\.html$/i.test(out)) out = out.replace(/\/index\.html$/i, '/');
      else if (/\.html$/i.test(out)) out = out.replace(/\.html$/i, '');
      return pre + out + post;
    }
  );
}

function isSitemap(p) { return p.toLowerCase().endsWith('sitemap.xml'); }

(async function main() {
  const files = await walk(ROOT);
  let changed = 0;

  for (const fsPath of files) {
    const raw = await fs.readFile(fsPath, 'utf8');

    if (isSitemap(fsPath)) {
      const next = rewriteSitemapXml(raw);
      if (next !== raw) {
        await fs.writeFile(fsPath, next, 'utf8');
        console.log('sitemap updated:', toWebPath(fsPath));
        changed++;
      }
      continue;
    }

    const prettyWebPath = prettyFromFile(fsPath);
    let html = raw;
    html = replaceCanonicals(html, prettyWebPath);
    html = rewriteJSONLD(html);
    html = rewriteHrefs(html);

    if (html !== raw) {
      await fs.writeFile(fsPath, html, 'utf8');
      console.log('rewrote:', toWebPath(fsPath), '→', prettyWebPath);
      changed++;
    }
  }

  console.log(`Done. Files changed: ${changed}`);
  console.log(`Leftovers check (internal .html links):`);
  console.log(`  git grep -nE 'href=\"/[^\"]+\\.html\"' -- ':!assets' ':!functions' ':!node_modules' || echo none`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
