// Serves one private page. Cloudflare Access guards the hostname; the JWT check
// here keeps the page closed if a request ever reaches the Worker without Access.
const ASSET_PATH = "/lolice-lineage.html";
const JWKS_TTL_MS = 5 * 60 * 1000;
const CLOCK_SKEW_S = 60;

const PAGE_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "frame-ancestors 'none'",
};

let jwksCache = { issuer: null, fetchedAt: 0, keys: new Map() };

export function resetJwksCache() {
  jwksCache = { issuer: null, fetchedAt: 0, keys: new Map() };
}

async function loadKeys(issuer) {
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error("jwks unavailable");
  const { keys } = await res.json();
  const imported = new Map();
  for (const jwk of keys) {
    if (jwk.kty !== "RSA" || !jwk.kid) continue;
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    imported.set(jwk.kid, key);
  }
  jwksCache = { issuer, fetchedAt: Date.now(), keys: imported };
}

async function findKey(issuer, kid) {
  const fresh =
    jwksCache.issuer === issuer && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;
  if (fresh && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid);
  // Unknown kid or stale cache: refetch once to follow key rotation.
  await loadKeys(issuer);
  return jwksCache.keys.get(kid);
}

function decodeSegment(segment) {
  const b64 = segment.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const decodeJson = (segment) => JSON.parse(new TextDecoder().decode(decodeSegment(segment)));

async function isAuthorized(request, env) {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return false;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [rawHeader, rawPayload, rawSignature] = parts;
    const header = decodeJson(rawHeader);
    if (header.alg !== "RS256" || typeof header.kid !== "string") return false;

    const key = await findKey(env.ACCESS_TEAM_DOMAIN, header.kid);
    if (!key) return false;
    const signed = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      decodeSegment(rawSignature),
      signed,
    );
    if (!valid) return false;

    const claims = decodeJson(rawPayload);
    const now = Date.now() / 1000;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return (
      audiences.includes(env.ACCESS_AUD) &&
      claims.iss === env.ACCESS_TEAM_DOMAIN &&
      typeof claims.exp === "number" &&
      claims.exp > now - CLOCK_SKEW_S &&
      (claims.nbf === undefined || claims.nbf <= now + CLOCK_SKEW_S)
    );
  } catch {
    // Malformed tokens and JWKS failures both stay closed.
    return false;
  }
}

const plain = (status, body, headers = {}) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

export default {
  async fetch(request, env) {
    if (!(await isAuthorized(request, env))) return plain(403, "Forbidden\n");
    if (request.method !== "GET" && request.method !== "HEAD") {
      return plain(405, "Method Not Allowed\n", { Allow: "GET, HEAD" });
    }
    const url = new URL(request.url);
    if (url.pathname !== "/" && url.pathname !== "/sha256") return plain(404, "Not Found\n");

    const asset = await env.ASSETS.fetch(new URL(ASSET_PATH, url.origin), { method: request.method });
    if (!asset.ok) return plain(404, "Not Found\n");
    if (url.pathname === "/sha256") {
      // Lets the signed-in Owner compare the served bytes with the source hash.
      const digest = await crypto.subtle.digest("SHA-256", await asset.arrayBuffer());
      return plain(200, `${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}\n`);
    }
    return new Response(asset.body, { status: 200, headers: PAGE_HEADERS });
  },
};
