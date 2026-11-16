// Serves one public page. run_worker_first keeps every other asset path behind this routing.
const ASSET_PATH = "/lolice-lineage.html";

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  // no-transform keeps Cloudflare from rewriting the page (Web Analytics injects a script),
  // so browsers get the same bytes that /sha256 reports.
  "Cache-Control": "no-cache, no-transform",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

const plain = (status, body, headers = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return plain(405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/sha256") return plain(404, "Not Found\n");

    const asset = await env.ASSETS.fetch(new URL(ASSET_PATH, url.origin), { method: "GET" });
    if (!asset.ok) return plain(404, "Not Found\n");
    if (url.pathname === "/sha256") {
      // Lets anyone compare the served bytes with the source hash.
      const digest = await crypto.subtle.digest("SHA-256", await asset.arrayBuffer());
      return plain(200, `${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}\n`);
    }
    return new Response(request.method === "HEAD" ? null : asset.body, { status: 200, headers: PAGE_HEADERS });
  },
};
