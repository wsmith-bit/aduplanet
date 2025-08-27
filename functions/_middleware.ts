// Cloudflare Pages Functions middleware to inject a shared <header> and <footer>
// into every HTML page at request time using HTMLRewriter.
// Place this file at /functions/_middleware.ts

export const onRequest: PagesFunction = async (context) => {
  const { request, env, next } = context;
  const url = new URL(request.url);

  // Get the origin page first
  const res = await next();

  // Only process HTML documents
  const ctype = res.headers.get("content-type") || "";
  if (!ctype.includes("text/html")) return res;

  // Helper to fetch a partial from /partials/* via static assets binding
  const fetchPartial = async (path: string) => {
    try {
      const r = await env.ASSETS.fetch(new Request(new URL(path, url.origin), request));
      if (r && r.ok) return await r.text();
    } catch (_) {}
    return null;
  };

  const [headerHTML, footerHTML] = await Promise.all([
    fetchPartial("/partials/header.html"),
    fetchPartial("/partials/footer.html"),
  ]);

  // If no header and no footer partials, return original
  if (!headerHTML && !footerHTML) return res;

  const pathname = url.pathname.replace(/\/$/, "");

  const rewriter = new HTMLRewriter()
    // Inject header if available
    .on("header", { element(el) { if (headerHTML) el.setInnerContent(headerHTML, { html: true }); } })
    // Set aria-current on matching nav link post-injection
    .on('header nav a', {
      element(el) {
        const href = el.getAttribute('href') || '';
        const normalize = (s: string) => s.replace(/\/$/, '');
        if (normalize(href) === pathname) el.setAttribute('aria-current', 'page');
        if (pathname === '' && normalize(href) === '') el.setAttribute('aria-current', 'page');
      }
    })
    // Inject footer if available
    .on("footer", { element(el) { if (footerHTML) el.setInnerContent(footerHTML, { html: true }); } });

  return rewriter.transform(res);
};
