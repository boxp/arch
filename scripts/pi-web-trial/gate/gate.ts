// BOXP-714: Host/Origin gate in front of pi-web-agent.
//
// pi-web-agent's API has no authentication and does not check Host/Origin, so
// binding to 127.0.0.1 alone is not enough: while the Owner's SSH forward is
// open, a malicious site can use DNS rebinding to read chats and notes. This
// gate listens on the public port (127.0.0.1:4317), relays only requests whose
// Host/Origin/Sec-Fetch-Site are the local origin, and forwards them to the
// upstream on an internal port (127.0.0.1:4318). Rules: Obsidian
// Projects/pi-web-agent-trial/spec.md「入口の門番」.
//
//   node gate.ts --port 4317 --upstream-port 4318
import { createServer, request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";

export interface GateRequest {
	method?: string;
	headers: IncomingHttpHeaders | Record<string, string | undefined>;
}

export function checkRequest(req: GateRequest, publicPort: number): { ok: boolean; reason?: string } {
	const header = (name: string): string | undefined => {
		const v = (req.headers as Record<string, unknown>)[name];
		return Array.isArray(v) ? undefined : typeof v === "string" ? v : undefined;
	};
	const allowedHosts = [`127.0.0.1:${publicPort}`, `localhost:${publicPort}`];
	const host = header("host")?.toLowerCase();
	if (!host || !allowedHosts.includes(host)) return { ok: false, reason: "host" };

	if (header("upgrade") !== undefined) return { ok: false, reason: "upgrade" };

	const origin = header("origin");
	const allowedOrigins = allowedHosts.map((h) => `http://${h}`);
	if (origin !== undefined && !allowedOrigins.includes(origin.toLowerCase())) return { ok: false, reason: "origin" };

	const method = (req.method ?? "GET").toUpperCase();
	if (method !== "GET" && method !== "HEAD" && origin === undefined) return { ok: false, reason: "origin-required" };

	const site = header("sec-fetch-site");
	if (site !== undefined && site !== "same-origin" && site !== "none") return { ok: false, reason: "sec-fetch-site" };

	return { ok: true };
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
			res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8", "X-Frame-Options": "DENY" });
			res.end(`forbidden (${verdict.reason})\n`);
			return;
		}
		const headers = { ...req.headers, host: `127.0.0.1:${opts.upstreamPort}` };
		const upstream = httpRequest(
			{ host: "127.0.0.1", port: opts.upstreamPort, method: req.method, path: req.url, headers },
			(up) => {
				res.writeHead(up.statusCode ?? 502, { ...up.headers, "x-frame-options": "DENY" });
				up.pipe(res);
			},
		);
		upstream.on("error", () => {
			if (!res.headersSent) res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8" });
			res.end("upstream unavailable\n");
		});
		res.on("close", () => upstream.destroy());
		req.pipe(upstream);
	});
	// Upgrade requests (WebSocket) are never relayed.
	server.on("upgrade", (_req, socket) => {
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
	});
	return new Promise((done) => server.listen(opts.listenPort, "127.0.0.1", () => done(server)));
}

function flag(args: string[], name: string): string | undefined {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
}

if (import.meta.main) {
	const args = process.argv.slice(2);
	const listenPort = Number(flag(args, "--port") ?? "4317");
	const upstreamPort = Number(flag(args, "--upstream-port") ?? "4318");
	if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort) || listenPort === upstreamPort) {
		console.error("usage: gate.ts --port 4317 --upstream-port 4318");
		process.exit(2);
	}
	const server = await startGate({ listenPort, upstreamPort });
	console.log(`pi-web-trial gate: http://127.0.0.1:${listenPort} -> 127.0.0.1:${upstreamPort}`);
	const stop = () => server.close(() => process.exit(0));
	process.on("SIGINT", stop);
	process.on("SIGTERM", stop);
}
