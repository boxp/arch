// Expected values come from the spec note
// (Obsidian: Projects/pi-web-agent-trial/spec.md「入口の門番」), not from the implementation.
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { checkRequest, startGate } from "../gate/gate.ts";

const P = 4317;
const ok = (h: Record<string, string>, method = "GET") => checkRequest({ method, headers: h }, P).ok;

test("Host must be 127.0.0.1:PORT or localhost:PORT", () => {
	assert.equal(ok({ host: "127.0.0.1:4317" }), true);
	assert.equal(ok({ host: "LOCALHOST:4317" }), true);
	assert.equal(ok({ host: "evil.example:4317" }), false); // DNS rebinding
	assert.equal(ok({ host: "127.0.0.1:4318" }), false);
	assert.equal(ok({ host: "127.0.0.1" }), false);
	assert.equal(ok({}), false);
});

test("Origin, when present, must be the local origin", () => {
	assert.equal(ok({ host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" }, "POST"), true);
	assert.equal(ok({ host: "localhost:4317", origin: "http://localhost:4317" }, "POST"), true);
	assert.equal(ok({ host: "127.0.0.1:4317", origin: "https://evil.example" }, "POST"), false);
	assert.equal(ok({ host: "127.0.0.1:4317", origin: "null" }, "POST"), false);
	assert.equal(ok({ host: "127.0.0.1:4317", origin: "https://evil.example" }), false);
});

test("non-GET/HEAD requires Origin", () => {
	assert.equal(ok({ host: "127.0.0.1:4317" }, "POST"), false);
	assert.equal(ok({ host: "127.0.0.1:4317" }, "DELETE"), false);
	assert.equal(ok({ host: "127.0.0.1:4317" }, "PATCH"), false);
	assert.equal(ok({ host: "127.0.0.1:4317" }, "HEAD"), true);
});

test("Sec-Fetch-Site must be same-origin or none (except top-level page navigation)", () => {
	assert.equal(ok({ host: "127.0.0.1:4317", "sec-fetch-site": "same-origin" }), true);
	assert.equal(ok({ host: "127.0.0.1:4317", "sec-fetch-site": "none" }), true);
	assert.equal(ok({ host: "127.0.0.1:4317", "sec-fetch-site": "cross-site" }), false);
	assert.equal(ok({ host: "127.0.0.1:4317", "sec-fetch-site": "same-site" }), false);
});

// spec「入口の門番」4 (BOXP-714 TD-02): cross-site / same-site pass only for a GET/HEAD top-level
// navigation to a non-/api page (e.g. returning from the Access login).
test("cross-site top-level navigation to a page passes, everything else cross-site is denied", () => {
	const nav = { host: "127.0.0.1:4317", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
	const at = (url: string, h: Record<string, string> = nav, method = "GET") => checkRequest({ method, url, headers: h }, P).ok;
	assert.equal(at("/"), true);
	assert.equal(at("/?chat=abc"), true);
	assert.equal(at("/index.html"), true);
	assert.equal(at("/", { ...nav, "sec-fetch-site": "same-site" }), true);
	assert.equal(at("/", nav, "HEAD"), true);
	// embedded / non-navigation requests from another site
	assert.equal(at("/", { ...nav, "sec-fetch-dest": "iframe" }), false);
	assert.equal(at("/", { ...nav, "sec-fetch-dest": "frame" }), false);
	assert.equal(at("/", { ...nav, "sec-fetch-dest": "object" }), false);
	assert.equal(at("/", { ...nav, "sec-fetch-dest": "embed" }), false);
	assert.equal(at("/", { ...nav, "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" }), false);
	assert.equal(at("/", { ...nav, "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }), false);
	assert.equal(at("/", { host: "127.0.0.1:4317", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" }), false); // no Dest
	assert.equal(at("/", { host: "127.0.0.1:4317", "sec-fetch-site": "cross-site", "sec-fetch-dest": "document" }), false); // no Mode
	// API is never a cross-site navigation target
	assert.equal(at("/api/chats"), false);
	assert.equal(at("/api"), false);
	assert.equal(at("/API/chats"), false);
	assert.equal(at("/%61pi/chats"), false);
	assert.equal(at("/api%2Fchats"), false);
	assert.equal(at("//api/chats"), false);
	assert.equal(at("http://127.0.0.1:4317/api/chats"), false);
	assert.equal(at(""), false);
	assert.equal(at("/%zz"), false); // undecodable
	// non-GET navigation (form POST) from another site
	assert.equal(at("/", nav, "POST"), false);
	assert.equal(at("/", { ...nav, origin: "http://127.0.0.1:4317" }, "POST"), false);
	// Host / Origin rules still apply
	assert.equal(at("/", { ...nav, host: "evil.example:4317" }), false);
	assert.equal(at("/", { ...nav, origin: "https://evil.example" }), false);
});

test("Upgrade is never relayed", () => {
	assert.equal(ok({ host: "127.0.0.1:4317", upgrade: "websocket", connection: "Upgrade" }), false);
});

function send(port: number, method: string, path: string, headers: Record<string, string>) {
	return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((done, fail) => {
		const req = httpRequest({ host: "127.0.0.1", port, method, path, headers, setHost: false }, (res) => {
			let body = "";
			res.on("data", (c) => (body += c));
			res.on("end", () => done({ status: res.statusCode ?? 0, body, headers: res.headers }));
		});
		req.on("error", fail);
		req.end();
	});
}

test("gate relays allowed requests and blocks others before reaching upstream", async () => {
	const seen: string[] = [];
	const upstream = createServer((req, res) => {
		seen.push(`${req.method} ${req.url} host=${req.headers.host}`);
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("upstream-ok");
	});
	await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
	const upPort = (upstream.address() as AddressInfo).port;
	const gate = await startGate({ listenPort: 0, upstreamPort: upPort, publicPort: P });
	const gPort = (gate.address() as AddressInfo).port;
	try {
		const good = await send(gPort, "GET", "/api/chats", { host: "127.0.0.1:4317" });
		assert.equal(good.status, 200);
		assert.equal(good.body, "upstream-ok");
		assert.equal(good.headers["x-frame-options"], "DENY");
		const post = await send(gPort, "POST", "/api/chats", { host: "127.0.0.1:4317", origin: "http://127.0.0.1:4317" });
		assert.equal(post.status, 200);
		const rebound = await send(gPort, "GET", "/api/chats", { host: "evil.example:4317" });
		assert.equal(rebound.status, 403);
		const csrf = await send(gPort, "POST", "/api/chats", { host: "127.0.0.1:4317", origin: "https://evil.example" });
		assert.equal(csrf.status, 403);
		assert.deepEqual(seen, [
			`GET /api/chats host=127.0.0.1:${upPort}`,
			`POST /api/chats host=127.0.0.1:${upPort}`,
		]);
	} finally {
		gate.close();
		upstream.close();
	}
});
