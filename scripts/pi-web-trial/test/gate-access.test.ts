// Expected values come from the spec note
// (Obsidian: Projects/pi-web-agent-trial/spec.md「Cloudflare Access 入口」), not from the implementation.
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { type AccessConfig, checkAccessRequest, startAccessGate, verifyAccessJwt } from "../gate/gate.ts";

const TEAM = "https://team.cloudflareaccess.com";
const AUD = "aud-pi-web";
const OWNER = "owner@example.com";
const cfg: AccessConfig = {
	teamDomain: TEAM,
	aud: AUD,
	ownerEmails: [OWNER],
	publicOrigin: "https://pi-web.b0xp.io",
};

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const keys: Record<string, KeyObject> = { k1: publicKey };
const keyFor = async (kid: string) => keys[kid];

const NOW = 1_800_000_000_000;
const nowS = NOW / 1000;
const b64 = (v: unknown) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function jwt(payload: Record<string, unknown>, opts: { kid?: string; alg?: string; key?: KeyObject } = {}) {
	const head = b64({ alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" });
	const body = b64(payload);
	const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), opts.key ?? privateKey).toString("base64url");
	return `${head}.${body}.${sig}`;
}
const good = (extra: Record<string, unknown> = {}) =>
	jwt({ iss: TEAM, aud: [AUD], email: OWNER, exp: nowS + 600, nbf: nowS - 10, ...extra });

test("valid Access JWT of the Owner yields the email", async () => {
	assert.equal(await verifyAccessJwt(good(), cfg, keyFor, NOW), OWNER);
	assert.equal(await verifyAccessJwt(good({ email: "Owner@Example.com" }), cfg, keyFor, NOW), OWNER);
	assert.equal(await verifyAccessJwt(good({ aud: AUD }), cfg, keyFor, NOW), OWNER); // aud as a string
});

test("JWT is refused when signature, alg, kid, iss, aud, time or email is wrong", async () => {
	const bad = async (t: string | undefined) => assert.equal(await verifyAccessJwt(t, cfg, keyFor, NOW), undefined);
	await bad(undefined);
	await bad("");
	await bad("not.a.jwt");
	await bad(good({ email: "someone@example.com" })); // other GitHub user
	await bad(good({ email: undefined }));
	await bad(good({ iss: "https://evil.cloudflareaccess.com" }));
	await bad(good({ aud: ["other-app"] }));
	await bad(good({ exp: nowS - 60 })); // expired beyond 30s leeway
	await bad(good({ exp: undefined }));
	await bad(good({ nbf: nowS + 120 })); // not yet valid
	await bad(jwt({ iss: TEAM, aud: [AUD], email: OWNER, exp: nowS + 600 }, { key: other.privateKey })); // forged
	await bad(jwt({ iss: TEAM, aud: [AUD], email: OWNER, exp: nowS + 600 }, { kid: "unknown" }));
	await bad(jwt({ iss: TEAM, aud: [AUD], email: OWNER, exp: nowS + 600 }, { alg: "HS256" }));
	const [h, p] = good().split(".");
	await bad(`${h}.${p}.`); // empty signature
	await bad(`${b64({ alg: "none", kid: "k1" })}.${p}.`);
});

test("missing configuration denies everything", async () => {
	for (const broken of [
		{ ...cfg, aud: "" },
		{ ...cfg, teamDomain: "" },
		{ ...cfg, ownerEmails: [] },
		{ ...cfg, publicOrigin: "" },
	]) {
		const v = await checkAccessRequest(
			{ method: "GET", headers: { host: "pi-web.b0xp.io", "cf-access-jwt-assertion": good() } },
			broken,
			keyFor,
			NOW,
		);
		assert.equal(v.ok, false);
	}
});

test("Host, Origin, Sec-Fetch-Site and Upgrade rules apply on the Access port too", async () => {
	const check = async (h: Record<string, string>, method = "GET") =>
		(await checkAccessRequest({ method, headers: { "cf-access-jwt-assertion": good(), ...h } }, cfg, keyFor, NOW)).ok;
	assert.equal(await check({ host: "pi-web.b0xp.io" }), true);
	assert.equal(await check({ host: "PI-WEB.b0xp.io" }), true);
	assert.equal(await check({ host: "pi-web.b0xp.io", origin: "https://pi-web.b0xp.io" }, "POST"), true);
	assert.equal(await check({ host: "evil.example" }), false);
	assert.equal(await check({ host: "127.0.0.1:4319" }), false);
	assert.equal(await check({}), false);
	assert.equal(await check({ host: "pi-web.b0xp.io", origin: "https://evil.example" }, "POST"), false);
	assert.equal(await check({ host: "pi-web.b0xp.io", origin: "http://pi-web.b0xp.io" }, "POST"), false);
	assert.equal(await check({ host: "pi-web.b0xp.io" }, "POST"), false); // Origin required
	assert.equal(await check({ host: "pi-web.b0xp.io", "sec-fetch-site": "cross-site" }), false);
	// returning from the Access login (GitHub) is a cross-site top-level navigation: allowed for pages, not /api (TD-02)
	const back = { host: "pi-web.b0xp.io", "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };
	const at = async (url: string, h: Record<string, string>, method = "GET", token: string | null = good()) =>
		(await checkAccessRequest({ method, url, headers: token ? { "cf-access-jwt-assertion": token, ...h } : h }, cfg, keyFor, NOW)).ok;
	assert.equal(await at("/", back), true);
	assert.equal(await at("/", back, "GET", null), false); // still needs the Owner's JWT
	assert.equal(await at("/", back, "GET", good({ email: "someone@example.com" })), false);
	assert.equal(await at("/", { ...back, host: "evil.example" }), false);
	assert.equal(await at("/api/chats", back), false);
	assert.equal(await at("/", { ...back, "sec-fetch-dest": "iframe" }), false);
	assert.equal(await at("/api/chats", { ...back, "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" }), false);
	assert.equal(await at("/api/chats", { ...back, origin: "https://evil.example" }, "POST"), false);
	assert.equal(await check({ host: "pi-web.b0xp.io", upgrade: "websocket" }), false);
	// JWT missing even though everything else is right
	const noJwt = await checkAccessRequest({ method: "GET", headers: { host: "pi-web.b0xp.io" } }, cfg, keyFor, NOW);
	assert.equal(noJwt.ok, false);
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

test("Access gate relays only the Owner and strips the Access credentials", async () => {
	const seen: Record<string, unknown>[] = [];
	const upstream = createServer((req, res) => {
		seen.push({ method: req.method, url: req.url, ...req.headers });
		res.writeHead(200, { "Content-Type": "text/plain" });
		res.end("upstream-ok");
	});
	await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
	const upPort = (upstream.address() as AddressInfo).port;
	const gate = await startAccessGate({
		listenHost: "127.0.0.1",
		listenPort: 0,
		upstreamPort: upPort,
		config: cfg,
		keyFor,
		now: () => NOW,
	});
	const gPort = (gate.address() as AddressInfo).port;
	try {
		const ok = await send(gPort, "GET", "/api/chats", {
			host: "pi-web.b0xp.io",
			"cf-access-jwt-assertion": good(),
			"cf-access-authenticated-user-email": OWNER,
			cookie: "CF_Authorization=secret-token; theme=dark",
		});
		assert.equal(ok.status, 200);
		assert.equal(ok.body, "upstream-ok");
		assert.equal(ok.headers["x-frame-options"], "DENY");
		const noJwt = await send(gPort, "GET", "/api/chats", { host: "pi-web.b0xp.io" });
		assert.equal(noJwt.status, 403);
		const forged = await send(gPort, "GET", "/api/chats", {
			host: "pi-web.b0xp.io",
			"cf-access-jwt-assertion": jwt({ iss: TEAM, aud: [AUD], email: OWNER, exp: nowS + 600 }, { key: other.privateKey }),
		});
		assert.equal(forged.status, 403);
		const otherUser = await send(gPort, "POST", "/api/chats", {
			host: "pi-web.b0xp.io",
			origin: "https://pi-web.b0xp.io",
			"cf-access-jwt-assertion": good({ email: "someone@example.com" }),
		});
		assert.equal(otherUser.status, 403);
		assert.equal(seen.length, 1);
		const relayed = seen[0];
		assert.equal(relayed.host, `127.0.0.1:${upPort}`);
		assert.equal(relayed["cf-access-jwt-assertion"], undefined);
		assert.equal(relayed["cf-access-authenticated-user-email"], undefined);
		assert.equal(relayed.cookie, "theme=dark");
	} finally {
		gate.close();
		upstream.close();
	}
});

test("Access gate refuses WebSocket upgrades", async () => {
	const gate = await startAccessGate({ listenHost: "127.0.0.1", listenPort: 0, upstreamPort: 1, config: cfg, keyFor, now: () => NOW });
	const gPort = (gate.address() as AddressInfo).port;
	try {
		const r = await send(gPort, "GET", "/", {
			host: "pi-web.b0xp.io",
			"cf-access-jwt-assertion": good(),
			connection: "Upgrade",
			upgrade: "websocket",
		});
		assert.equal(r.status, 403);
	} finally {
		gate.close();
	}
});

