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
//   node gate.ts --port 4317 --upstream-port 4318 [--access-port 4319 --access-config access.json]
import { createPublicKey, verify, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
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

/** Host / Origin / Sec-Fetch-Site / Upgrade rules shared by both entrances. */
function checkHeaders(req: GateRequest, allowedHosts: string[], allowedOrigins: string[]): { ok: boolean; reason?: string } {
	const host = header(req, "host")?.toLowerCase();
	if (!host || !allowedHosts.includes(host)) return { ok: false, reason: "host" };

	if (header(req, "upgrade") !== undefined) return { ok: false, reason: "upgrade" };

	const origin = header(req, "origin");
	if (origin !== undefined && !allowedOrigins.includes(origin.toLowerCase())) return { ok: false, reason: "origin" };

	const method = (req.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD" && origin === undefined) return { ok: false, reason: "origin-required" };

	const site = header(req, "sec-fetch-site");
	if (site !== undefined && site !== "same-origin" && site !== "none" && !isTopLevelPageNavigation(req, method))
		return { ok: false, reason: "sec-fetch-site" };

	return { ok: true };
}

export function checkRequest(req: GateRequest, publicPort: number): { ok: boolean; reason?: string } {
	const allowedHosts = [`127.0.0.1:${publicPort}`, `localhost:${publicPort}`];
	return checkHeaders(req, allowedHosts, allowedHosts.map((h) => `http://${h}`));
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
}

export function startGate(opts: GateOptions): Promise<Server> {
	const publicPort = opts.publicPort ?? opts.listenPort;
	const server = createServer((req, res) => {
		const verdict = checkRequest(req, publicPort);
		if (!verdict.ok) {
			deny(res, verdict.reason);
			return;
		}
		relay(req, res, opts.upstreamPort, req.headers);
	});
	// Upgrade requests (WebSocket) are never relayed.
	server.on("upgrade", (_req, socket) => {
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
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
	const verdict = checkHeaders(req, [publicHost], [publicOrigin]);
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
	const server = createServer((req, res) => {
		checkAccessRequest(req, opts.config, keyFor, now())
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
	server.on("upgrade", (_req, socket) => {
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
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
	const usage = "usage: gate.ts --port 4317 --upstream-port 4318 [--access-port 4319 --access-config access.json]";
	if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort) || listenPort === upstreamPort) {
		console.error(usage);
		process.exit(2);
	}
	if ((accessPort === undefined) !== (accessConfigPath === undefined) || (accessPort !== undefined && (!Number.isInteger(accessPort) || [listenPort, upstreamPort].includes(accessPort)))) {
		console.error(usage);
		process.exit(2);
	}
	const servers: Server[] = [await startGate({ listenPort, upstreamPort })];
	console.log(`pi-web-trial gate: http://127.0.0.1:${listenPort} -> 127.0.0.1:${upstreamPort}`);
	if (accessPort !== undefined && accessConfigPath !== undefined) {
		const config = loadAccessConfig(accessConfigPath);
		servers.push(await startAccessGate({ listenHost: "0.0.0.0", listenPort: accessPort, upstreamPort, config }));
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
