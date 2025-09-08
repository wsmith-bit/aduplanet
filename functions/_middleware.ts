// /functions/_middleware.ts — v7 (Force Light + Freshness + Schema dates)
// - Injects header/footer from ASSETS (fallbacks preserved)
// - Ensures /styles/main.css is loaded; also appends /styles/force-light.css (last-wins)
// - Adds body classes: force-light + route slug (e.g., page-home, page-financing)
// - Updates <time data-global-freshness> to today (ISO + human)
// - Appends <meta property="og:updated_time"> with ISO timestamp
// - Rewrites "dateModified" inside JSON-LD blocks to today's YYYY-MM-DD
// - Sets x-aduplanet-injected: 1 for easy debugging

export const onRequest: PagesFunction = async (context) => {
  const { env, next } = context;
  const url = new URL(context.request.url);

  const originRes = await next();
  const ctype = originRes.headers.get("content-type") || "";
  if (!ctype.includes("text/html")) return originRes;

  async function getAsset(path: string): Promise<string | null> {
    try {
      const r = await (env as any).ASSETS.fetch(new Request(`https://assets${path}`));
      if (r && r.ok) return await r.text();
    } catch {}
    return null;
  }
  async function assetExists(path: string): Promise<boolean> {
    try {
      const r = await (env as any).ASSETS.fetch(new Request(`https://assets${path}`));
      return !!(r && r.ok);
    } catch { return false; }
  }

  // Load partials (scoped, light)
  let headerHTML = await getAsset("/partials/header.html");
  let footerHTML = await getAsset("/partials/footer.html");

  if (!headerHTML) {
    headerHTML = `
    <nav class="wrap nav" role="navigation" aria-label="Primary">
      <a class="brand" href="/" aria-label="ADUPlanet Home">
        <img src="/assets/logo.png" alt="ADUPlanet logo" width="120" height="32" />
      </a>
      <div class="links">
        <a href="/costs">Costs</a>
        <a href="/regulations">Regulations</a>
        <a href="/builders">Builders</a>
        <a href="/financing">Financing</a>
        <a href="/blog/">Blog</a>
      </div>
    </nav>
    <style>
      header{background:rgba(255,255,255,.92);color:var(--ink,#0b0f19);
        border-bottom:1px solid var(--line,#cbd5e1);backdrop-filter:saturate(1.2) blur(8px)}
      header .nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0}
      header .brand{display:inline-flex;align-items:center;gap:10px}
      header .brand img{height:clamp(30px,4.2vw,42px);width:auto;display:block}
      header .links{display:flex;gap:16px;flex-wrap:wrap;align-items:center}
      header .links a{color:var(--ink,#0b0f19);text-decoration:none;padding:10px 12px;border-radius:12px}
      header .links a:hover{text-decoration:underline}
      header nav a[aria-current="page"]{background:#f8fafc;outline:1px solid var(--line,#cbd5e1)}
    </style>`;
  }

  if (!footerHTML) {
    footerHTML = `
    <div class="wrap">
      <nav class="footer-links" aria-label="Footer">
        <a href="/about">About</a>
        <a href="/privacy">Privacy</a>
        <a href="/builders">Find Builders</a>
      </nav>
      <p class="freshness">Updated <time data-global-freshness datetime="2025-08-27">August 27, 2025</time>.</p>
    </div>
    <style>
      footer.site-footer{background:var(--surface,#fff);color:var(--muted,#1f2937);
        border-top:1px solid var(--line,#cbd5e1);padding:28px 0 40px}
      footer.site-footer .wrap{max-width:1120px;margin:0 auto;padding:0 20px}
      footer.site-footer .footer-links{display:flex;gap:14px;flex-wrap:wrap;align-items:center}
      footer.site-footer a{color:var(--link,#1e40af);text-decoration:none}
      footer.site-footer a:hover{text-decoration:underline}
      footer.site-footer a:visited{color:var(--link-visited,#6b21a8)}
      footer.site-footer .freshness{margin-top:10px;font-size:clamp(14px,.9rem,16px);color:var(--muted,#1f2937)}
    </style>`;
  }

  // Stylesheets
  const cssHref =
    (await assetExists("/styles/main.css")) ? "/styles/main.css" :
    (await assetExists("/styles/main")) ? "/styles/main" : null;

  const forceCssHref = (await assetExists("/styles/force-light.css")) ? "/styles/force-light.css" : null;

  // Route helpers
  const pathname = url.pathname.replace(/\/$/, "");
  const pathForSlug = pathname || "/";
  const slug =
    pathForSlug === "/" ? "home" :
    pathForSlug.replace(/^\//, "").replace(/[^\w-]/g, "-") || "home";

  // Timestamps
  const now = new Date();
  const isoFull = now.toISOString();         // e.g., 2025-09-05T12:34:56.789Z
  const isoDate = isoFull.slice(0, 10);      // e.g., 2025-09-05
  const human = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const rewritten = new HTMLRewriter()
    // <head>: ensure CSS order (main first, then force-light), add OG updated time
    .on("head", {
      element(el) {
        if (cssHref) {
          el.append(`<link rel="stylesheet" href="${cssHref}" data-injected>`, { html: true });
        } else {
          el.append(
            `<style>header .links{display:flex;gap:18px;align-items:center}header .links a{display:inline-block;padding:8px 12px;border-radius:10px;text-decoration:none;color:inherit}</style>`,
            { html: true }
          );
        }
        if (forceCssHref) {
          el.append(`<link rel="stylesheet" href="${forceCssHref}" data-injected="force-light">`, { html: true });
        }
        el.append(`<meta property="og:updated_time" content="${isoFull}">`, { html: true });
      }
    })
    // <body>: add force-light + route slug classes and data-route attr
    .on("body", {
      element(el) {
        const cls = (el.getAttribute("class") || "").trim();
        const nextCls = (cls ? cls + " " : "") + `force-light page-${slug}`;
        el.setAttribute("class", nextCls);
        el.setAttribute("data-route", slug);
      }
    })
    // Inject header/footer HTML
    .on("header", { element(el) { el.setInnerContent(headerHTML!, { html: true }); } })
    .on("footer", { element(el) { el.setInnerContent(footerHTML!, { html: true }); } })
    // Mark active nav link
    .on("header nav a", {
      element(el) {
        const href = el.getAttribute("href") || "";
        const normalize = (s: string) => s.replace(/\/$/, "");
        if (normalize(href) === pathname || (pathname === "" && normalize(href) === "")) {
          el.setAttribute("aria-current", "page");
        }
      }
    })
    // Update visible freshness stamps
    .on('time[data-global-freshness]', {
      element(el) {
        el.setAttribute("datetime", isoDate);
        el.setInnerContent(human);
      }
    })
    // Patch JSON-LD dateModified → today's date (YYYY-MM-DD)
    .on('script[type="application/ld+json"]', {
      text(t) {
        const src = t.text;
        // Replace ANY "dateModified":"..." with today's date (keeps rest of JSON intact)
        const patched = src.replace(/"dateModified"\s*:\s*"[0-9T:\-+.Z]+"/g, `"dateModified":"${isoDate}"`);
        if (patched !== src) t.replace(patched);
      }
    })
    .transform(originRes);

  const headers = new Headers(rewritten.headers);
  headers.set("x-aduplanet-injected", "1");
  return new Response(rewritten.body, {
    headers,
    status: rewritten.status,
    statusText: rewritten.statusText
  });
};
export const onRequest: PagesFunction = async (ctx) => {
  const res = await ctx.next();
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  const body = await res.text();
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");

  const out = new Response(body, res);
  // Weak ETag is fine; if you prefer strong, drop the W/
  out.headers.set("ETag", `W/"${hex.slice(0,16)}"`);
  // Use commit time if available; falls back to now
  const lm = (ctx.env as any)?.CF_PAGES_COMMIT_TIME || Date.now();
  out.headers.set("Last-Modified", new Date(lm).toUTCString());
  // Keep revalidation cheap/fast
  out.headers.set("Cache-Control", "public, max-age=0, must-revalidate");

  return out;
};
