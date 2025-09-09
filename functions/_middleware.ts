// /functions/_middleware.ts — v9 (HEAD-safe ETag)
// All v8 features preserved (partials, force-light, freshness, JSON-LD dateModified, og:updated_time)
// Plus: only compute/set ETag on GET; skip hashing for HEAD

export const onRequest: PagesFunction = async (context) => {
  const { env, next, request } = context;
  const url = new URL(request.url);
  const isHead = request.method === "HEAD";

  const originRes = await next();
  const ctype = originRes.headers.get("content-type") || "";
  if (!ctype.includes("text/html")) return originRes;

  async function getAsset(path: string): Promise<string | null> {
    try {
      const r = await (env as any).ASSETS?.fetch?.(new Request(`https://assets${path}`));
      if (r && r.ok) return await r.text();
    } catch {}
    return null;
  }
  async function assetExists(path: string): Promise<boolean> {
    try {
      const r = await (env as any).ASSETS?.fetch?.(new Request(`https://assets${path}`));
      return !!(r && r.ok);
    } catch { return false; }
  }

  // Partials (with fallbacks)
  let headerHTML = await getAsset("/partials/header.html");
  let footerHTML = await getAsset("/partials/footer.html");
  if (!headerHTML) headerHTML = `
    <nav class="wrap nav" role="navigation" aria-label="Primary">
      <a class="brand" href="/" aria-label="ADUPlanet Home">
        <img src="/assets/logo.png" alt="ADUPlanet logo" width="120" height="32" />
      </a>
      <div class="links">
        <a href="/costs">Costs</a><a href="/regulations">Regulations</a>
        <a href="/builders">Builders</a><a href="/financing">Financing</a><a href="/blog/">Blog</a>
      </div>
    </nav>
    <style>header{background:rgba(255,255,255,.92);border-bottom:1px solid #cbd5e1;backdrop-filter:saturate(1.2) blur(8px)}
    header .nav{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:16px 0}
    header .links{display:flex;gap:16px;flex-wrap:wrap}header .links a{padding:10px 12px;border-radius:12px;text-decoration:none;color:#0b0f19}
    header nav a[aria-current="page"]{background:#f8fafc;outline:1px solid #cbd5e1}</style>`;
  if (!footerHTML) footerHTML = `
    <div class="wrap"><nav class="footer-links" aria-label="Footer">
      <a href="/about">About</a><a href="/privacy">Privacy</a><a href="/builders">Find Builders</a>
    </nav><p class="freshness">Updated <time data-global-freshness datetime="2025-08-27">August 27, 2025</time>.</p></div>
    <style>footer.site-footer{background:#fff;border-top:1px solid #cbd5e1;padding:28px 0 40px}
    footer .wrap{max-width:1120px;margin:0 auto;padding:0 20px}
    footer .footer-links{display:flex;gap:14px;flex-wrap:wrap}</style>`;

  const cssHref =
    (await assetExists("/styles/main.css")) ? "/styles/main.css" :
    (await assetExists("/styles/main")) ? "/styles/main" : null;
  const forceCssHref = (await assetExists("/styles/force-light.css")) ? "/styles/force-light.css" : null;

  const pathname = url.pathname.replace(/\/$/, "");
  const slug = pathname === "" ? "home" : (pathname.replace(/^\//, "").replace(/[^\w-]/g, "-") || "home");

  const now = new Date();
  const isoFull = now.toISOString();
  const isoDate = isoFull.slice(0, 10);
  const human = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

  const rewrittenRes = new HTMLRewriter()
    .on("head", { element(el) {
      if (cssHref) el.append(`<link rel="stylesheet" href="${cssHref}" data-injected>`, { html: true });
      else el.append(`<style>header .links{display:flex;gap:18px}</style>`, { html: true });
      if (forceCssHref) el.append(`<link rel="stylesheet" href="${forceCssHref}" data-injected="force-light">`, { html: true });
      el.append(`<meta property="og:updated_time" content="${isoFull}">`, { html: true });
    }})
    .on("body", { element(el) {
      const cls = (el.getAttribute("class") || "").trim();
      el.setAttribute("class", (cls ? cls + " " : "") + `force-light page-${slug}`);
      el.setAttribute("data-route", slug);
    }})
    .on("header", { element(el){ el.setInnerContent(headerHTML!, { html: true }); }})
    .on("footer", { element(el){ el.setInnerContent(footerHTML!, { html: true }); }})
    .on("header nav a", { element(el){
      const href = (el.getAttribute("href") || "").replace(/\/$/, "");
      const cur  = pathname;
      if (href === cur || (href === "" && cur === "")) el.setAttribute("aria-current", "page");
    }})
    .on('time[data-global-freshness]', { element(el){
      el.setAttribute("datetime", isoDate);
      el.setInnerContent(human);
    }})
    .on('script[type="application/ld+json"]', { text(t){
      const src = t.text;
      const patched = src.replace(/"dateModified"\s*:\s*"[0-9T:\-+.Z]+"/g, `"dateModified":"${isoDate}"`);
      if (patched !== src) t.replace(patched);
    }})
    .transform(originRes);

  const headers = new Headers(rewrittenRes.headers);
  headers.set("x-aduplanet-injected", "1");
  headers.set("Cache-Control", "public, max-age=0, must-revalidate, no-transform");
  if (!headers.has("referrer-policy")) headers.set("referrer-policy", "strict-origin-when-cross-origin");
  if (!headers.has("content-type")) headers.set("content-type", "text/html; charset=utf-8");

  const lm = (env as any)?.CF_PAGES_COMMIT_TIME || Date.now();
  headers.set("Last-Modified", new Date(lm).toUTCString());

  if (isHead) {
    // Don’t read the body on HEAD; skip ETag to avoid empty-body hashes
    return new Response(null, { status: rewrittenRes.status, statusText: rewrittenRes.statusText, headers });
  }

  // GET (or others): compute content-based ETag
  const finalBody = await rewrittenRes.text();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(finalBody));
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  headers.set("ETag", `W/"${hex.slice(0,16)}"`);

  return new Response(finalBody, { status: rewrittenRes.status, statusText: rewrittenRes.statusText, headers });
};
