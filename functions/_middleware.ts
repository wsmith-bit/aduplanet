// /functions/_middleware.ts — V6 ENSURE CSS
// Safe header/footer injection + robust CSS loading
// - Loads partials via ASSETS binding (no recursion)
// - Injects /styles/main.css if present; else /styles/main; else minimal inline CSS fallback
// - Adds x-aduplanet-injected: 1 for easy debugging

export const onRequest: PagesFunction = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  const originRes = await next();
  const ctype = originRes.headers.get("content-type") || "";
  if (!ctype.includes("text/html")) return originRes;

  async function getAsset(path: string): Promise<string | null> {
    try {
      const r = await (env as any).ASSETS.fetch(new Request(`https://assets${path}`));
      if (r && r.ok) return await r.text();
    } catch (_) {}
    return null;
  }
  async function assetExists(path: string): Promise<boolean> {
    try {
      const r = await (env as any).ASSETS.fetch(new Request(`https://assets${path}`));
      return !!(r && r.ok);
    } catch (_) { return false; }
  }

  let headerHTML = await getAsset('/partials/header.html');
  let footerHTML = await getAsset('/partials/footer.html');

  if (!headerHTML) headerHTML = `<div class="wrap nav" role="navigation" aria-label="Main"><a href="/" aria-label="ADUPlanet Home"><img src="/assets/logo.png" alt="ADUPlanet logo" style="height:32px;width:auto"></a><nav aria-label="Primary"><a href="/costs">Costs</a><a href="/regulations">Regulations</a><a href="/builders">Builders</a><a href="/financing">Financing</a><a href="/blog/">Blog</a></nav></div>`;
  if (!footerHTML) footerHTML = `<div class="wrap"><nav class="footer-links" aria-label="Footer"><a href="/about">About</a><a href="/privacy">Privacy</a><a href="/builders">Find Builders</a></nav><p>Freshness: Updated <time datetime="2025-08-27" data-global-freshness>August 27, 2025</time>. Explore the funnel: <a href="/costs">Costs</a> → <a href="/regulations">Regulations</a> → <a href="/builders">Builders</a> → <a href="/financing">Financing</a>.</p></div>`;

  // decide which stylesheet to inject
  const cssHref = (await assetExists('/styles/main.css')) ? '/styles/main.css'
                 : (await assetExists('/styles/main')) ? '/styles/main'
                 : null;

  const pathname = url.pathname.replace(/\/$/, "");

  const rewritten = new HTMLRewriter()
    .on('head', { element(el) {
      if (cssHref) {
        el.append(`<link rel="stylesheet" href="${cssHref}" data-injected>`, { html: true });
      } else {
        // minimal fallback so nav never jams together
        el.append(`<style>header nav{display:flex;gap:18px;align-items:center}header nav a{display:inline-block;padding:8px 12px;border-radius:10px;text-decoration:none;color:inherit}</style>`, { html: true });
      }
    }})
    .on('header', { element(el) { el.setInnerContent(headerHTML!, { html: true }); } })
    .on('footer', { element(el) { el.setInnerContent(footerHTML!, { html: true }); } })
    .on('header nav a', { element(el) {
      const href = el.getAttribute('href') || '';
      const normalize = (s: string) => s.replace(/\/$/, '');
      if (normalize(href) === pathname || (pathname === '' && normalize(href) === '')) {
        el.setAttribute('aria-current', 'page');
      }
    }})
    .transform(originRes);

  const headers = new Headers(rewritten.headers);
  headers.set('x-aduplanet-injected', '1');
  return new Response(rewritten.body, { headers, status: rewritten.status, statusText: rewritten.statusText });
};
