// BOXP-714: Host/Origin gate in front of pi-web-agent.
//
// pi-web-agent's API has no authentication and does not check Host/Origin, so
// binding to 127.0.0.1 alone is not enough: while the Owner's SSH forward is
// open, a malicious site can use DNS rebinding to read chats and notes. This
// gate listens on the local port (127.0.0.1:4317), relays only requests whose
// Host/Origin/Sec-Fetch-Site are the local origin, and forwards them to the
// upstream on an internal port (127.0.0.1:4318). Rules: Obsidian
// Projects/pi-web-agent-trial/spec.md「入口の門番」.
//
// With --access-port/--access-config it also serves the Cloudflare Access
// entrance (https://pi-web.b0xp.io via the k8s tunnel), see startAccessGate.
//
// With --profile pwu (xing-shuyin/pi-web-ui, BOXP-714 TD-03) it relays only the HTTP paths and the
// WebSocket (/ws) messages the chat needs, see checkPwuHttp / decideWsMessage / ClientFrameFilter.
//
//   node gate.ts --port 4317 --upstream-port 4318 [--profile pwu --sessions-dir DIR] [--access-port 4319 --access-config access.json]
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Duplex } from "node:stream";
import {
	createServer,
	request as httpRequest,
	type IncomingHttpHeaders,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http";

export interface GateRequest {
	method?: string;
	/** request target as sent (path + query) */
	url?: string;
	headers: IncomingHttpHeaders | Record<string, string | undefined>;
}

function header(req: GateRequest, name: string): string | undefined {
	const v = (req.headers as Record<string, unknown>)[name];
	return Array.isArray(v) ? undefined : typeof v === "string" ? v : undefined;
}

/**
 * A cross-site / same-site request may pass only as a top-level page navigation (e.g. returning from the
 * Cloudflare Access / GitHub login, or a link in another app): GET/HEAD, Sec-Fetch-Mode navigate,
 * Sec-Fetch-Dest document, and a path outside /api. The page is shown only in the Owner's own tab (never
 * readable by the other site, never framed). Spec「入口の門番」4 (BOXP-714 TD-02).
 */
function isTopLevelPageNavigation(req: GateRequest, method: string): boolean {
	if (method !== "GET" && method !== "HEAD") return false;
	if (header(req, "sec-fetch-mode") !== "navigate" || header(req, "sec-fetch-dest") !== "document") return false;
	const raw = req.url;
	if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return false;
	let path: string;
	try {
		path = decodeURIComponent(raw.split(/[?#]/, 1)[0]).toLowerCase();
	} catch {
		return false;
	}
	if (path.startsWith("//")) return false;
	return path !== "/api" && !path.startsWith("/api/") && !path.startsWith("/api\\");
}

/** Which upstream UI is behind the gate: tg-prplx/pi-web-agent ("legacy") or xing-shuyin/pi-web-ui ("pwu"). */
export type GateProfile = "legacy" | "pwu";

/** Host / Origin / Sec-Fetch-Site / Upgrade rules shared by both entrances. */
function checkHeaders(
	req: GateRequest,
	allowedHosts: string[],
	allowedOrigins: string[],
	profile: GateProfile = "legacy",
): { ok: boolean; reason?: string } {
	const host = header(req, "host")?.toLowerCase();
	if (!host || !allowedHosts.includes(host)) return { ok: false, reason: "host" };

	const origin = header(req, "origin");
	const upgrade = header(req, "upgrade") ?? (req.headers as Record<string, unknown>).upgrade;
	if (upgrade !== undefined) {
		// pi-web-ui speaks over one WebSocket (/ws); the legacy UI never upgrades.
		if (profile !== "pwu") return { ok: false, reason: "upgrade" };
		if (typeof upgrade !== "string" || upgrade.toLowerCase() !== "websocket") return { ok: false, reason: "upgrade" };
		if ((req.method ?? "GET").toUpperCase() !== "GET" || req.url !== "/ws") return { ok: false, reason: "upgrade-path" };
		if (origin === undefined) return { ok: false, reason: "origin-required" };
	} else if (profile === "pwu") {
		const verdict = checkPwuHttp(req.method ?? "GET", req.url);
		if (!verdict.ok) return verdict;
	}

	if (origin !== undefined && !allowedOrigins.includes(origin.toLowerCase())) return { ok: false, reason: "origin" };

	const method = (req.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD" && origin === undefined) return { ok: false, reason: "origin-required" };

	const site = header(req, "sec-fetch-site");
	if (site !== undefined && site !== "same-origin" && site !== "none" && !isTopLevelPageNavigation(req, method))
		return { ok: false, reason: "sec-fetch-site" };

	return { ok: true };
}

export function checkRequest(req: GateRequest, publicPort: number, profile: GateProfile = "legacy"): { ok: boolean; reason?: string } {
	const allowedHosts = [`127.0.0.1:${publicPort}`, `localhost:${publicPort}`];
	return checkHeaders(req, allowedHosts, allowedHosts.map((h) => `http://${h}`), profile);
}

// ---- pi-web-ui (profile "pwu") allow lists ----
// Rules: Obsidian Projects/pi-web-agent-trial/spec.md「新本体（pi-web-ui）向けの門番の決まり」(BOXP-714 TD-03).
// pi-web-ui trusts every loopback client and exposes a terminal, file editing, engine switching, settings
// and plugins over the same WebSocket and HTTP API, so only what the chat needs is let through.

const PWU_PAGE_PATHS = new Set(["/", "/index.html", "/favicon.ico", "/favicon.svg", "/manifest.webmanifest"]);
const PWU_PAGE_PREFIXES = ["/assets/", "/themes/", "/icons/"];
const PWU_API_PATHS = new Set(["/api/health", "/api/themes", "/api/locales", "/api/locales/ja", "/api/prompt-templates"]);

export function checkPwuHttp(method: string, url: string | undefined): { ok: boolean; reason?: string } {
	const m = method.toUpperCase();
	if (m !== "GET" && m !== "HEAD") return { ok: false, reason: "method" };
	if (typeof url !== "string" || !url.startsWith("/")) return { ok: false, reason: "path" };
	const path = url.split("?", 1)[0];
	// No percent-encoding, backslashes, control characters, "..", or "//": the path is judged as written.
	if (!/^[A-Za-z0-9._\-/]*$/.test(path) || path.includes("..") || path.includes("//")) return { ok: false, reason: "path" };
	if (PWU_PAGE_PATHS.has(path) || PWU_API_PATHS.has(path)) return { ok: true };
	if (PWU_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix) && path.length > prefix.length)) return { ok: true };
	return { ok: false, reason: "path" };
}

export interface PwuPolicy {
	/** pi-web-ui's session directory (PI_CODING_AGENT_DIR/sessions); switch_session may open only files in it. */
	sessionsDir: string;
}

type FieldRule = (value: unknown, policy: PwuPolicy) => boolean;
const isString: FieldRule = (v) => typeof v === "string";
const isNumber: FieldRule = (v) => typeof v === "number" && Number.isFinite(v);
const isBoolean: FieldRule = (v) => typeof v === "boolean";
const anyValue: FieldRule = () => true;

function isSessionFile(value: unknown, policy: PwuPolicy): boolean {
	if (typeof value !== "string" || !value.endsWith(".jsonl")) return false;
	const root = policy.sessionsDir.replace(/\/+$/, "");
	if (!root.startsWith("/") || !value.startsWith(`${root}/`)) return false;
	const rest = value.slice(root.length + 1);
	return rest.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..") && !/[\\\0]/.test(rest);
}

/** Prompt text that pi-web-ui would run as a command (slash commands: model switch, reload, quit...; "!" shell). */
function isPlainPrompt(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const t = value.trim();
	return !t.startsWith("/") && !t.startsWith("!");
}

const WS_MESSAGES: Record<string, { fields: Record<string, FieldRule>; required?: string[] }> = {
	hello: { fields: { clientId: isString, locale: isString } },
	get_state: { fields: {} },
	list_models: { fields: {} },
	list_commands: { fields: {} },
	get_commands: { fields: {} },
	list_projects: { fields: {} },
	new_chat: { fields: {} },
	abort: { fields: {} },
	list_sessions: { fields: { limit: isNumber } },
	prompt: {
		fields: {
			text: isPlainPrompt,
			queue: isBoolean,
			attachments: (v) => Array.isArray(v) && v.length === 0,
			targetConversationId: isString,
		},
		required: ["text"],
	},
	dialog_response: { fields: { id: (v, p) => isString(v, p) || isNumber(v, p), value: anyValue }, required: ["id"] },
	switch_session: { fields: { path: isSessionFile }, required: ["path"] },
	// Picking another running conversation in the list; pi-web-ui only switches to a conversation it already holds.
	switch_conversation: { fields: { id: (v) => typeof v === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(v) }, required: ["id"] },
};

/** Decide one browser -> pi-web-ui WebSocket message (the text of one frame). */
export function decideWsMessage(payload: string, policy: PwuPolicy): { ok: boolean; type?: string; reason?: string } {
	let msg: unknown;
	try {
		msg = JSON.parse(payload);
	} catch {
		return { ok: false, reason: "json" };
	}
	if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { ok: false, reason: "json" };
	const record = msg as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type : undefined;
	const rule = type !== undefined && Object.hasOwn(WS_MESSAGES, type) ? WS_MESSAGES[type] : undefined;
	if (!rule) return { ok: false, type, reason: "type" };
	for (const [key, value] of Object.entries(record)) {
		if (key === "type") continue;
		const check = Object.hasOwn(rule.fields, key) ? rule.fields[key] : undefined;
		if (!check || !check(value, policy)) return { ok: false, type, reason: `field:${key}` };
	}
	for (const key of rule.required ?? []) if (!Object.hasOwn(record, key)) return { ok: false, type, reason: `missing:${key}` };
	return { ok: true, type };
}

const MAX_FRAME_PAYLOAD = 1024 * 1024;

/**
 * Reads the browser -> upstream WebSocket byte stream frame by frame (RFC 6455). Allowed text messages are
 * forwarded as their original bytes, other messages are dropped; anything the gate cannot judge (fragmented,
 * binary, unmasked, compressed/RSV, oversized frames) closes the connection.
 */
export class ClientFrameFilter {
	private buffer = Buffer.alloc(0);
	private closed: string | undefined;
	private readonly policy: PwuPolicy;
	constructor(policy: PwuPolicy) {
		this.policy = policy;
	}

	push(chunk: Buffer): { forward: Buffer[]; dropped: number; dropTypes: string[]; close?: string } {
		const forward: Buffer[] = [];
		const dropTypes: string[] = [];
		if (this.closed) return { forward, dropped: 0, dropTypes, close: this.closed };
		this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);
		const fail = (reason: string) => {
			this.closed = reason;
			this.buffer = Buffer.alloc(0);
			return { forward: [], dropped: dropTypes.length, dropTypes, close: reason };
		};
		for (;;) {
			const b = this.buffer;
			if (b.length < 2) break;
			const fin = (b[0] & 0x80) !== 0;
			const rsv = b[0] & 0x70;
			const opcode = b[0] & 0x0f;
			const masked = (b[1] & 0x80) !== 0;
			let len = b[1] & 0x7f;
			let offset = 2;
			if (rsv !== 0) return fail("rsv");
			if (!masked) return fail("unmasked");
			const control = opcode >= 0x8;
			if (control ? opcode > 0xa || !fin || len > 125 : opcode !== 0x1) return fail(`opcode-${opcode}`);
			if (!fin) return fail("fragmented");
			if (len === 126) {
				if (b.length < 4) break;
				len = b.readUInt16BE(2);
				offset = 4;
			} else if (len === 127) {
				if (b.length < 10) break;
				const big = b.readBigUInt64BE(2);
				if (big > BigInt(MAX_FRAME_PAYLOAD)) return fail("too-large");
				len = Number(big);
				offset = 10;
			}
			if (len > MAX_FRAME_PAYLOAD) return fail("too-large");
			const total = offset + 4 + len;
			if (b.length < total) break;
			const frame = b.subarray(0, total);
			this.buffer = b.subarray(total);
			if (control) {
				forward.push(Buffer.from(frame));
				continue;
			}
			const key = frame.subarray(offset, offset + 4);
			const data = Buffer.allocUnsafe(len);
			for (let i = 0; i < len; i++) data[i] = frame[offset + 4 + i] ^ key[i & 3];
			let text: string;
			try {
				text = new TextDecoder("utf-8", { fatal: true }).decode(data);
			} catch {
				return fail("utf8");
			}
			const verdict = decideWsMessage(text, this.policy);
			if (verdict.ok) forward.push(Buffer.from(frame));
			else dropTypes.push(`${verdict.type ?? "?"}(${verdict.reason})`);
		}
		return { forward, dropped: dropTypes.length, dropTypes };
	}
}

function refuseUpgrade(socket: Duplex, reason?: string): void {
	socket.end(`HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\nforbidden (${reason ?? "denied"})\n`);
}

/** Relay an allowed WebSocket upgrade to pi-web-ui, filtering every browser -> upstream frame. */
function relayWebSocket(req: IncomingMessage, socket: Duplex, head: Buffer, upstreamPort: number, inHeaders: IncomingHttpHeaders, policy: PwuPolicy): void {
	// The gate has already checked Host and Origin; pi-web-ui compares Origin with its own address.
	const headers: IncomingHttpHeaders = { ...inHeaders, host: `127.0.0.1:${upstreamPort}`, origin: `http://127.0.0.1:${upstreamPort}` };
	// No compression: the gate must read every frame as sent.
	delete headers["sec-websocket-extensions"];
	const filter = new ClientFrameFilter(policy);
	const pending: Buffer[] = head.length > 0 ? [head] : [];
	const early = (d: Buffer) => pending.push(d);
	socket.on("data", early);
	socket.on("error", () => socket.destroy());
	const upstream = httpRequest({ host: "127.0.0.1", port: upstreamPort, method: "GET", path: "/ws", headers });
	upstream.on("upgrade", (res, upSocket, upHead) => {
		const lines = [`HTTP/1.1 101 ${res.statusMessage ?? "Switching Protocols"}`];
		for (let i = 0; i < res.rawHeaders.length; i += 2) {
			if (res.rawHeaders[i].toLowerCase() === "sec-websocket-extensions") continue;
			lines.push(`${res.rawHeaders[i]}: ${res.rawHeaders[i + 1]}`);
		}
		socket.write(`${lines.join("\r\n")}\r\n\r\n`);
		if (upHead.length > 0) socket.write(upHead);
		upSocket.pipe(socket);
		const feed = (d: Buffer) => {
			const out = filter.push(d);
			for (const f of out.forward) upSocket.write(f);
			if (out.dropped > 0) console.log(`pi-web-trial gate: ws dropped ${out.dropTypes.join(", ")}`);
			if (out.close) {
				console.log(`pi-web-trial gate: ws closed (${out.close})`);
				socket.destroy();
				upSocket.destroy();
			}
		};
		socket.off("data", early);
		for (const d of pending.splice(0)) feed(d);
		socket.on("data", feed);
		const end = () => {
			socket.destroy();
			upSocket.destroy();
		};
		// Upgraded sockets are half-open capable: an "end" from either side tears down both.
		for (const ev of ["error", "end", "close"]) {
			upSocket.on(ev, end);
			socket.on(ev, end);
		}
	});
	upstream.on("response", (res) => {
		socket.end(`HTTP/1.1 ${res.statusCode ?? 502} ${res.statusMessage ?? ""}\r\nConnection: close\r\n\r\n`);
		res.resume();
	});
	upstream.on("error", () => socket.destroy());
	socket.on("end", () => socket.destroy());
	socket.on("close", () => upstream.destroy());
	upstream.end();
}

function deny(res: ServerResponse, reason?: string): void {
	res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "X-Frame-Options": "DENY" });
	res.end(`forbidden (${reason ?? "denied"})\n`);
}

function relay(req: IncomingMessage, res: ServerResponse, upstreamPort: number, inHeaders: IncomingHttpHeaders): void {
	const headers = { ...inHeaders, host: `127.0.0.1:${upstreamPort}` };
	const upstream = httpRequest({ host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers }, (up) => {
		res.writeHead(up.statusCode ?? 502, { ...up.headers, "x-frame-options": "DENY" });
		up.pipe(res);
	});
	upstream.on("error", () => {
		if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
		res.end("upstream unavailable\n");
	});
	res.on("close", () => upstream.destroy());
	req.pipe(upstream);
}

export interface GateOptions {
	listenPort: number;
	upstreamPort: number;
	publicPort?: number;
	profile?: GateProfile;
	/** required with profile "pwu" */
	pwu?: PwuPolicy;
}

function pwuPolicyOf(profile: GateProfile, pwu: PwuPolicy | undefined): PwuPolicy | undefined {
	if (profile !== "pwu") return undefined;
	if (!pwu?.sessionsDir) throw new Error("profile pwu needs pwu.sessionsDir");
	return pwu;
}

export function startGate(opts: GateOptions): Promise<Server> {
	const publicPort = opts.publicPort ?? opts.listenPort;
	const profile = opts.profile ?? "legacy";
	const policy = pwuPolicyOf(profile, opts.pwu);
	const server = createServer((req, res) => {
		const verdict = checkRequest(req, publicPort, profile);
		if (!verdict.ok) {
			deny(res, verdict.reason);
			return;
		}
		relay(req, res, opts.upstreamPort, req.headers);
	});
	// Upgrade requests (WebSocket): only pi-web-ui's /ws, filtered frame by frame.
	server.on("upgrade", (req, socket, head) => {
		const verdict = checkRequest(req, publicPort, profile);
		if (!verdict.ok || !policy) {
			refuseUpgrade(socket, verdict.reason ?? "upgrade");
			return;
		}
		relayWebSocket(req, socket, head, opts.upstreamPort, req.headers, policy);
	});
	return new Promise((done) => server.listen(opts.listenPort, "127.0.0.1", () => done(server)));
}

// ---- Cloudflare Access port (https://pi-web.b0xp.io) ----
// Rules: Obsidian Projects/pi-web-agent-trial/spec.md「Cloudflare Access 入口」.
// cloudflared already requires the Access JWT; this re-checks it (signature,
// iss, aud, exp/nbf, Owner email) so a missing tunnel setting or a request from
// inside the cluster never reaches the unauthenticated upstream.

export interface AccessConfig {
	/** https://<team>.cloudflareaccess.com */
	teamDomain: string;
	/** AUD tag of the pi-web.b0xp.io Access application */
	aud: string;
	ownerEmails: string[];
	/** https://pi-web.b0xp.io */
	publicOrigin: string;
}

export type KeyLookup = (kid: string) => Promise<KeyObject | undefined>;

const LEEWAY_S = 30;

function configComplete(cfg: AccessConfig): boolean {
	return Boolean(cfg.teamDomain && cfg.aud && cfg.ownerEmails.length > 0 && cfg.publicOrigin);
}

function decodePart(part: string): Record<string, unknown> | undefined {
	try {
		const v = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
		return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
	} catch {
		return undefined;
	}
}

/** The Owner's email (lower case) when the token is a valid Access token for cfg; otherwise undefined. */
export async function verifyAccessJwt(
	token: string | undefined,
	cfg: AccessConfig,
	keyFor: KeyLookup,
	nowMs: number,
): Promise<string | undefined> {
	if (!configComplete(cfg) || typeof token !== "string") return undefined;
	const parts = token.split(".");
	if (parts.length !== 3 || parts.some((p) => p.length === 0)) return undefined;
	const [h, p, s] = parts;
	const header = decodePart(h);
	const payload = decodePart(p);
	if (!header || !payload) return undefined;
	if (header.alg !== "RS256" || typeof header.kid !== "string") return undefined;
	const key = await keyFor(header.kid).catch(() => undefined);
	if (!key) return undefined;
	let valid = false;
	try {
		valid = verify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(s, "base64url"));
	} catch {
		valid = false;
	}
	if (!valid) return undefined;
	const nowS = nowMs / 1000;
	const auds = typeof payload.aud === "string" ? [payload.aud] : payload.aud;
	const email = typeof payload.email === "string" ? payload.email.toLowerCase() : undefined;
	const owners = cfg.ownerEmails.map((e) => e.toLowerCase());
	if (payload.iss !== cfg.teamDomain) return undefined;
	if (!Array.isArray(auds) || !auds.includes(cfg.aud)) return undefined;
	if (typeof payload.exp !== "number" || nowS >= payload.exp + LEEWAY_S) return undefined;
	if (payload.nbf !== undefined && (typeof payload.nbf !== "number" || payload.nbf > nowS + LEEWAY_S)) return undefined;
	if (!email || !owners.includes(email)) return undefined;
	return email;
}

export async function checkAccessRequest(
	req: GateRequest,
	cfg: AccessConfig,
	keyFor: KeyLookup,
	nowMs: number,
	profile: GateProfile = "legacy",
): Promise<{ ok: boolean; reason?: string }> {
	if (!configComplete(cfg)) return { ok: false, reason: "config" };
	let publicHost: string;
	let publicOrigin: string;
	try {
		const u = new URL(cfg.publicOrigin);
		publicHost = u.host.toLowerCase();
		publicOrigin = u.origin.toLowerCase();
	} catch {
		return { ok: false, reason: "config" };
	}
	const verdict = checkHeaders(req, [publicHost], [publicOrigin], profile);
	if (!verdict.ok) return verdict;
	const token = header(req, "cf-access-jwt-assertion");
	const email = await verifyAccessJwt(token, cfg, keyFor, nowMs);
	if (!email) return { ok: false, reason: "access" };
	return { ok: true };
}

/** kid -> key from <teamDomain>/cdn-cgi/access/certs; cached 10 min, unknown kid refetches at most every 30 s. */
export function certsKeyLookup(teamDomain: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): KeyLookup {
	let cache: { at: number; keys: Map<string, KeyObject> } = { at: 0, keys: new Map() };
	let lastAttempt = 0;
	return async (kid) => {
		const t = now();
		const fresh = t - cache.at < 600_000;
		if (fresh && cache.keys.has(kid)) return cache.keys.get(kid);
		if (fresh && t - lastAttempt < 30_000) return undefined;
		lastAttempt = t;
		const res = await fetchImpl(`${teamDomain}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return fresh ? cache.keys.get(kid) : undefined;
		const body = (await res.json()) as { keys?: Array<Record<string, unknown>> };
		const keys = new Map<string, KeyObject>();
		for (const k of body.keys ?? []) {
			if (k.kty !== "RSA" || typeof k.kid !== "string") continue;
			try {
				keys.set(k.kid, createPublicKey({ key: k as JsonWebKey, format: "jwk" }));
			} catch {
				// skip malformed keys
			}
		}
		cache = { at: t, keys };
		return keys.get(kid);
	};
}

export interface AccessGateOptions {
	listenHost: string;
	listenPort: number;
	upstreamPort: number;
	config: AccessConfig;
	keyFor?: KeyLookup;
	now?: () => number;
	profile?: GateProfile;
	pwu?: PwuPolicy;
}

function stripAccessCredentials(headers: IncomingHttpHeaders): IncomingHttpHeaders {
	const out: IncomingHttpHeaders = { ...headers };
	delete out["cf-access-jwt-assertion"];
	delete out["cf-access-authenticated-user-email"];
	delete out["cf-access-client-id"];
	delete out["cf-access-client-secret"];
	if (typeof out.cookie === "string") {
		const kept = out.cookie
			.split(";")
			.map((c) => c.trim())
			.filter((c) => c && !/^CF_Authorization=/i.test(c) && !/^CF_AppSession=/i.test(c));
		if (kept.length > 0) out.cookie = kept.join("; ");
		else delete out.cookie;
	}
	return out;
}

export function startAccessGate(opts: AccessGateOptions): Promise<Server> {
	const keyFor = opts.keyFor ?? certsKeyLookup(opts.config.teamDomain);
	const now = opts.now ?? Date.now;
	const profile = opts.profile ?? "legacy";
	const policy = pwuPolicyOf(profile, opts.pwu);
	const server = createServer((req, res) => {
		checkAccessRequest(req, opts.config, keyFor, now(), profile)
			.catch(() => ({ ok: false, reason: "error" }) as { ok: boolean; reason?: string })
			.then((verdict) => {
				if (!verdict.ok) {
					deny(res, verdict.reason);
					req.resume();
					return;
				}
				relay(req, res, opts.upstreamPort, stripAccessCredentials(req.headers));
			});
	});
	server.on("upgrade", (req, socket, head) => {
		socket.on("error", () => socket.destroy());
		checkAccessRequest(req, opts.config, keyFor, now(), profile)
			.catch(() => ({ ok: false, reason: "error" }) as { ok: boolean; reason?: string })
			.then((verdict) => {
				if (!verdict.ok || !policy) {
					refuseUpgrade(socket, verdict.reason ?? "upgrade");
					return;
				}
				relayWebSocket(req, socket, head, opts.upstreamPort, stripAccessCredentials(req.headers), policy);
			});
	});
	return new Promise((done) => server.listen(opts.listenPort, opts.listenHost, () => done(server)));
}

export function loadAccessConfig(path: string): AccessConfig {
	const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<AccessConfig>;
	return {
		teamDomain: typeof raw.teamDomain === "string" ? raw.teamDomain.replace(/\/+$/, "") : "",
		aud: typeof raw.aud === "string" ? raw.aud : "",
		ownerEmails: Array.isArray(raw.ownerEmails) ? raw.ownerEmails.filter((e): e is string => typeof e === "string" && e.length > 0) : [],
		publicOrigin: typeof raw.publicOrigin === "string" ? raw.publicOrigin : "",
	};
}

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const listenPort = Number(flag(args, "--port") ?? "4317");
	const upstreamPort = Number(flag(args, "--upstream-port") ?? "4318");
	const accessPortRaw = flag(args, "--access-port");
	const accessConfigPath = flag(args, "--access-config");
	const accessPort = accessPortRaw === undefined ? undefined : Number(accessPortRaw);
	const profileRaw = flag(args, "--profile") ?? "legacy";
	const sessionsDir = flag(args, "--sessions-dir");
	const usage =
		"usage: gate.ts --port 4317 --upstream-port 4318 [--profile legacy|pwu --sessions-dir DIR] [--access-port 4319 --access-config access.json]";
	if ((profileRaw !== "legacy" && profileRaw !== "pwu") || (profileRaw === "pwu") !== (sessionsDir !== undefined) || (sessionsDir !== undefined && !sessionsDir.startsWith("/"))) {
		console.error(usage);
		process.exit(2);
	}
	const profile: GateProfile = profileRaw;
	const pwu = sessionsDir === undefined ? undefined : { sessionsDir };
	if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort) || listenPort === upstreamPort) {
		console.error(usage);
		process.exit(2);
	}
	if ((accessPort === undefined) !== (accessConfigPath === undefined) || (accessPort !== undefined && (!Number.isInteger(accessPort) || [listenPort, upstreamPort].includes(accessPort)))) {
		console.error(usage);
		process.exit(2);
	}
	const servers: Server[] = [await startGate({ listenPort, upstreamPort, profile, pwu })];
	console.log(`pi-web-trial gate (${profile}): http://127.0.0.1:${listenPort} -> 127.0.0.1:${upstreamPort}`);
	if (accessPort !== undefined && accessConfigPath !== undefined) {
		const config = loadAccessConfig(accessConfigPath);
		servers.push(await startAccessGate({ listenHost: "0.0.0.0", listenPort: accessPort, upstreamPort, config, profile, pwu }));
		console.log(
			`pi-web-trial access gate: 0.0.0.0:${accessPort} (${config.publicOrigin || "UNCONFIGURED: every request is denied"}) -> 127.0.0.1:${upstreamPort}`,
		);
	}
	const stop = () => {
		for (const s of servers) s.close();
		process.exit(0);
	};
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}
