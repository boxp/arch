import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import worker, { resetJwksCache } from "../src/index.js";

const ISS = "https://team.example.com";
const AUD = "test-aud";
const BODY = "<html>fixture-page</html>";
const ALG = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };

const pair = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
const otherPair = await crypto.subtle.generateKey(ALG, true, ["sign", "verify"]);
const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };

const env = {
  ACCESS_TEAM_DOMAIN: ISS,
  ACCESS_AUD: AUD,
  ASSETS: {
    fetch: async (url) =>
      new URL(url).pathname === "/lolice-architecture.html"
        ? new Response(BODY, { status: 200 })
        : new Response("missing", { status: 404 }),
  },
};

const b64 = (v) => Buffer.from(typeof v === "string" ? v : new Uint8Array(v)).toString("base64url");
const now = () => Math.floor(Date.now() / 1000);
const goodClaims = () => ({ aud: [AUD], iss: ISS, exp: now() + 300, nbf: now() - 10 });

async function sign(claims = goodClaims(), { header = { alg: "RS256", kid: "k1" }, key = pair.privateKey } = {}) {
  const input = `${b64(JSON.stringify(header))}.${b64(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return `${input}.${b64(sig)}`;
}

const call = (token, path = "/", method = "GET") =>
  worker.fetch(
    new Request(`https://lolice-architecture.example.com${path}`, {
      method,
      headers: token ? { "Cf-Access-Jwt-Assertion": token } : {},
    }),
    env,
  );

beforeEach(() => {
  resetJwksCache();
  globalThis.fetch = async () => Response.json({ keys: [publicJwk] });
});

test("valid token returns the page with private headers", async () => {
  const res = await call(await sign());
  assert.equal(res.status, 200);
  assert.equal(await res.text(), BODY);
  assert.equal(res.headers.get("Cache-Control"), "private, no-store, no-transform");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(res.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.match(res.headers.get("Content-Type"), /^text\/html/);
});

test("HEAD is allowed", async () => {
  assert.equal((await call(await sign(), "/", "HEAD")).status, 200);
});

const rejected = {
  "missing token": async () => null,
  garbage: async () => "garbage",
  "garbage segments": async () => "a.b.c",
  "wrong signature": () => sign(goodClaims(), { key: otherPair.privateKey }),
  "alg none": async () => `${b64(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64(JSON.stringify(goodClaims()))}.`,
  HS256: () => sign(goodClaims(), { header: { alg: "HS256", kid: "k1" } }),
  "wrong aud": () => sign({ ...goodClaims(), aud: ["other"] }),
  "wrong iss": () => sign({ ...goodClaims(), iss: "https://evil.example.com" }),
  expired: () => sign({ ...goodClaims(), exp: now() - 3600 }),
  "missing exp": () => {
    const { exp, ...claims } = goodClaims();
    return sign(claims);
  },
  "nbf in the future": () => sign({ ...goodClaims(), nbf: now() + 3600 }),
  "unknown kid": () => sign(goodClaims(), { header: { alg: "RS256", kid: "nope" } }),
};

for (const [name, makeToken] of Object.entries(rejected)) {
  test(`rejects ${name} without the page`, async () => {
    const res = await call(await makeToken());
    assert.equal(res.status, 403);
    assert.ok(!(await res.text()).includes("fixture-page"));
  });
}

test("JWKS failure stays closed", async () => {
  globalThis.fetch = async () => new Response("down", { status: 500 });
  const res = await call(await sign());
  assert.equal(res.status, 403);
  assert.ok(!(await res.text()).includes("fixture-page"));
});

test("unauthenticated requests are refused before routing", async () => {
  for (const [path, method] of [["/data/", "GET"], ["/lolice-architecture.html", "GET"], ["/", "POST"]]) {
    assert.equal((await call(null, path, method)).status, 403);
  }
});

for (const path of ["/lolice-architecture.html", "/data/", "/owner-summary.md", "//", "/%2e%2e/x", "/index.html"]) {
  test(`only / serves the page: ${path}`, async () => {
    const res = await call(await sign(), path);
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes("fixture-page"));
  });
}

test("POST is refused after auth", async () => {
  const res = await call(await sign(), "/", "POST");
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("Allow"), "GET, HEAD");
});

test("missing asset is a plain 404", async () => {
  const noAsset = { ...env, ASSETS: { fetch: async () => new Response("x", { status: 404 }) } };
  const res = await worker.fetch(
    new Request("https://lolice-architecture.example.com/", { headers: { "Cf-Access-Jwt-Assertion": await sign() } }),
    noAsset,
  );
  assert.equal(res.status, 404);
});

test("config closes the alternate hostnames and runs the Worker first", () => {
  const text = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
  const config = JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
  assert.equal(config.workers_dev, false);
  assert.equal(config.preview_urls, false);
  assert.equal(config.assets.run_worker_first, true);
  assert.equal(config.assets.html_handling, "none");
});

test("git tracks nothing under public/", () => {
  const cwd = new URL("..", import.meta.url);
  assert.equal(execFileSync("git", ["ls-files", "public"], { cwd, encoding: "utf8" }), "");
});

test("/sha256 reports the hash of the served page after auth", async () => {
  const res = await call(await sign(), "/sha256");
  assert.equal(res.status, 200);
  assert.equal((await res.text()).trim(), createHash("sha256").update(BODY).digest("hex"));
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("/sha256 is refused without auth", async () => {
  assert.equal((await call(null, "/sha256")).status, 403);
});

test("the deploy workflow keeps the private page on main and off the logs", () => {
  const wf = readFileSync(new URL("../../../.github/workflows/deploy-lolice-architecture.yml", import.meta.url), "utf8");
  const triggers = wf.slice(wf.indexOf("\non:"), wf.indexOf("\npermissions:"));
  assert.match(triggers, /workflow_dispatch/);
  assert.doesNotMatch(triggers, /pull_request|push:|schedule/);
  assert.match(wf, /github\.ref == 'refs\/heads\/main'/);
  assert.match(wf, /environment: lolice-architecture-deploy/);
  assert.doesNotMatch(wf, /upload-artifact|actions\/cache|cache:|set -x|secrets: inherit/);
  assert.doesNotMatch(wf, /cat |echo "\$PAGE/);
  assert.equal(wf.match(/LOLICE_ARCHITECTURE_HTML_XZ_B64 }}/g).length, 1);
});

test("a Worker deployed without ACCESS_AUD stays closed", async () => {
  const { ACCESS_AUD, ...noAud } = env;
  const res = await worker.fetch(
    new Request("https://lolice-architecture.example.com/", { headers: { "Cf-Access-Jwt-Assertion": await sign() } }),
    noAud,
  );
  assert.equal(res.status, 403);
});

test("deploying requires the live Access redirect", () => {
  const script = readFileSync(new URL("../scripts/deploy.sh", import.meta.url), "utf8");
  assert.match(script, /access-aud\.sh" lolice-architecture\.b0xp\.io/);
  assert.match(script, /--var "ACCESS_AUD:\$aud"/);
});
