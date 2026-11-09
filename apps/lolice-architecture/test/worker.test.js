import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import worker from "../src/index.js";

const BODY = "<html>fixture-page</html>";

const env = {
  ASSETS: {
    fetch: async (url) =>
      new URL(url).pathname === "/lolice-architecture.html"
        ? new Response(BODY, { status: 200 })
        : new Response("missing", { status: 404 }),
  },
};

const call = (path = "/", method = "GET", targetEnv = env) =>
  worker.fetch(new Request(`https://lolice-architecture.example.com${path}`, { method }), targetEnv);

test("anonymous GET returns the page with its headers", async () => {
  const res = await call();
  assert.equal(res.status, 200);
  assert.equal(await res.text(), BODY);
  assert.equal(res.headers.get("Cache-Control"), "no-cache, no-transform");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(res.headers.get("Content-Security-Policy"), "frame-ancestors 'none'");
  assert.match(res.headers.get("Content-Type"), /^text\/html/);
});

test("HEAD returns no body", async () => {
  const res = await call("/", "HEAD");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
});

for (const path of ["/lolice-architecture.html", "/data/", "/owner-summary.md", "/request.md", "//", "/%2e%2e/x", "/index.html"]) {
  test(`only / serves the page: ${path}`, async () => {
    const res = await call(path);
    assert.equal(res.status, 404);
    assert.ok(!(await res.text()).includes("fixture-page"));
  });
}

for (const method of ["POST", "PUT", "DELETE"]) {
  test(`${method} is refused`, async () => {
    const res = await call("/", method);
    assert.equal(res.status, 405);
    assert.equal(res.headers.get("Allow"), "GET, HEAD");
  });
}

test("missing asset is a plain 404", async () => {
  const noAsset = { ASSETS: { fetch: async () => new Response("x", { status: 404 }) } };
  assert.equal((await call("/", "GET", noAsset)).status, 404);
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

test("/sha256 reports the hash of the served page", async () => {
  const res = await call("/sha256");
  assert.equal(res.status, 200);
  assert.equal((await res.text()).trim(), createHash("sha256").update(BODY).digest("hex"));
  assert.equal(res.headers.get("Cache-Control"), "no-store");
});

test("the deploy workflow keeps the page secret on main and off the logs", () => {
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
