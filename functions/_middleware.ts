// /functions/_middleware.ts — V4 SAFE (no same-origin fetch recursion)
// Injects shared <header> and <footer> from /partials/* using the ASSETS binding only.
// Adds a debug header: x-aduplanet-injected: 1

export const onRequest: PagesFunction = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Get origin response first
  const originRes = await next();

  // Only process HTML
  const ctype = originRes.headers.get("content-type") || "";
  if (!ctype.includes("text/html")) return originRes;

  // Helper: fetch static asset via ASSETS binding (bypasses this middleware)
  async function fetchAsset(path: string): Promise<string | null> {
    try {
      // ASSETS.fetch requires an absolute URL, host is ignored
      const req = new Request(`https://assets${path}`, { method: "GET" });
      const r = await (env as any).ASSETS.fetch(req);
      if (r && r.ok) return await r.text();
    } catch (_) {}
    return null;
  }

  // Load partials (or use inline fallbacks)
  let headerHTML = await fetchAsset("/partials/header.html");
  let footerHTML = await fetchAsset("/partials/footer.html");

  if (!headerHTML) {
    headerHTML =
      `<div class="wrap nav" role="navigation" aria-label="Main">` +
      `<a href="/" aria-label="ADUPlanet Home"><img src="/assets/logo.png" alt="ADUPlanet logo" style="height:32px;width:auto"></a>` +
      `<nav aria-label="Primary"><a href="/costs">Costs</a><a href="/regulations">Regulations</a><a href="/builders">Builders</a><a href="/financing">Financing</a><a href="/blog/">Blog</a></nav>` +
      `</div>`;
  }
  if (!footerHTML) {
    footerHTML =
      `<nav class="footer-links" aria-label="Footer"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/builders">Find Builders</a></nav>` +
      `<p>Freshness: Updated <time datetime="2025-08-27" data-global-freshness>August 27, 2025</time>. Explore the funnel: <a href="/costs">Costs</a> → <a href="/regulations">Regulations</a> → <a href="/builders">Builders</a> → <a href="/financing">Financing</a>.</p>`;
  }

  const pathname = url.pathname.replace(/\/$/, "");

  const rewritten = new HTMLRewriter()
    .on("header", { element(el) { el.setInnerContent(headerHTML!, { html: true }); } })
    .on("footer", { element(el) { el.setInnerContent(footerHTML!, { html: true }); } })
    .on("header nav a", {
      element(el) {
        const href = el.getAttribute("href") || "";
        const normalize = (s: string) => s.replace(/\/$/, "");
        if (normalize(href) === pathname || (pathname === "" && normalize(href) === "")) {
          el.setAttribute("aria-current", "page");
        }
      }
    })
    .transform(originRes);

  // Add a debug header so you can confirm the middleware executed
  return new Response(rewritten.body, {
    headers: new Headers(rewritten.headers),
    status: rewritten.status,
    statusText: rewritten.statusText,
  }).headers.set("x-aduplanet-injected", "1"), rewritten;
};
