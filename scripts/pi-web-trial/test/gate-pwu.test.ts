// Expected values come from the spec note
// (Obsidian: Projects/pi-web-agent-trial/spec.md「新本体（pi-web-ui）向けの門番の決まり」), not from the implementation.
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "node:http";
import { connect, type AddressInfo, type Socket } from "node:net";
import { test } from "node:test";
import { checkPwuHttp, checkRequest, ClientFrameFilter, decideWsMessage, startGate } from "../gate/gate.ts";

const SESSIONS = "/home/boxp/.local/share/pi-web-trial/agent-pwu/sessions";
const policy = { sessionsDir: SESSIONS };
const ws = (msg: unknown) => decideWsMessage(JSON.stringify(msg), policy).ok;

test("HTTP: 画面資源と決まった API の GET / HEAD だけ通す", () => {
	for (const url of ["/", "/index.html", "/assets/index-abc.js", "/themes/flow-ink.css", "/icons/icon-192.png", "/favicon.ico", "/manifest.webmanifest", "/api/health", "/api/themes", "/api/locales", "/api/locales/ja", "/api/prompt-templates", "/?x=1"]) {
		assert.equal(checkPwuHttp("GET", url).ok, true, url);
	}
	assert.equal(checkPwuHttp("HEAD", "/").ok, true);
	for (const url of ["/setup", "/api/system-screenshot", "/api/device-center/rooms", "/api/upload", "/api/files/raw", "/api/locales/en", "/api/prompt-templates/x", "/assets/../setup", "/%2e%2e/setup", "//evil", "/assets\\..\\setup", "/assets/%00", "/ws", "/api/healthz"]) {
		assert.equal(checkPwuHttp("GET", url).ok, false, url);
	}
	assert.equal(checkPwuHttp("POST", "/api/prompt-templates").ok, false);
	assert.equal(checkPwuHttp("PUT", "/").ok, false);
});

test("WS: チャットに要る型と項目だけ通す", () => {
	assert.equal(ws({ type: "hello", clientId: "c", locale: "ja" }), true);
	for (const type of ["get_state", "list_models", "list_commands", "get_commands", "list_projects", "new_chat", "abort"]) assert.equal(ws({ type }), true, type);
	assert.equal(ws({ type: "list_sessions", limit: 20 }), true);
	assert.equal(ws({ type: "prompt", text: "りんごを検索して", queue: false, attachments: [] }), true);
	assert.equal(ws({ type: "prompt", text: "hi", queue: true, attachments: [], targetConversationId: "abc" }), true);
	assert.equal(ws({ type: "prompt", text: "hi" }), true);
	assert.equal(ws({ type: "dialog_response", id: "d1", value: true }), true);
	assert.equal(ws({ type: "dialog_response", id: 12, value: "ok" }), true);
	assert.equal(ws({ type: "switch_session", path: `${SESSIONS}/--vault--/2026-11-26T03-28-31-669Z_x.jsonl` }), true);
});

test("WS: それ以外の型・余分な項目・条件外の値は捨てる", () => {
	for (const type of ["list_files", "read_file", "write_file", "terminal_create", "terminal_input", "run_command", "scm_status", "set_model", "refresh_worktrees", "switch_engine", "save_settings", "plugin_job", "unknown"]) {
		assert.equal(ws({ type }), false, type);
	}
	assert.equal(ws({ type: "get_state", path: "/" }), false);
	assert.equal(ws({ type: "new_chat", cwd: "/" }), false);
	assert.equal(ws({ type: "hello", clientId: 1 }), false);
	assert.equal(ws({ type: "list_sessions", limit: "20" }), false);
	assert.equal(ws({ type: "prompt", text: "/model openai/gpt" }), false);
	assert.equal(ws({ type: "prompt", text: "  /pi-web-ui:quit" }), false);
	assert.equal(ws({ type: "prompt", text: "!ls /" }), false);
	assert.equal(ws({ type: "prompt", text: 3 }), false);
	assert.equal(ws({ type: "prompt", text: "見て", attachments: [{ path: "/etc/passwd" }] }), false);
	assert.equal(ws({ type: "prompt", text: "hi", queue: "yes" }), false);
	assert.equal(ws({ type: "prompt", text: "hi", engine: "claude" }), false);
	assert.equal(ws({ type: "dialog_response", id: "3", extra: 1, value: true }), false);
	assert.equal(ws({ type: "dialog_response", id: { x: 1 }, value: true }), false);
	assert.equal(ws({ type: "switch_session", path: "/etc/passwd" }), false);
	assert.equal(ws({ type: "switch_session", path: `${SESSIONS}/../auth.json` }), false);
	assert.equal(ws({ type: "switch_session", path: `${SESSIONS}/../../x.jsonl` }), false);
	assert.equal(ws({ type: "switch_session", path: `${SESSIONS}-other/x.jsonl` }), false);
	assert.equal(ws({ type: "switch_session", path: "x.jsonl" }), false);
	assert.equal(decideWsMessage("not json", policy).ok, false);
	assert.equal(decideWsMessage("[]", policy).ok, false);
	assert.equal(decideWsMessage('"prompt"', policy).ok, false);
});

test("Upgrade は pwu では /ws だけ・Origin 必須で通し、旧本体では通さない", () => {
	const h = (extra: Record<string, string>) => ({ host: "127.0.0.1:4317", upgrade: "websocket", connection: "Upgrade", ...extra });
	const up = (url: string, headers: Record<string, string>, profile?: "pwu") =>
		checkRequest({ method: "GET", url, headers }, 4317, profile).ok;
	assert.equal(up("/ws", h({ origin: "http://127.0.0.1:4317" }), "pwu"), true);
	assert.equal(up("/ws", h({ origin: "http://127.0.0.1:4317", "sec-fetch-site": "same-origin" }), "pwu"), true);
	assert.equal(up("/ws", h({}), "pwu"), false); // Origin 無し
	assert.equal(up("/ws", h({ origin: "https://evil.example" }), "pwu"), false);
	assert.equal(up("/ws?x=1", h({ origin: "http://127.0.0.1:4317" }), "pwu"), false);
	assert.equal(up("/ws/", h({ origin: "http://127.0.0.1:4317" }), "pwu"), false);
	assert.equal(up("/api/ws", h({ origin: "http://127.0.0.1:4317" }), "pwu"), false);
	assert.equal(up("/ws", h({ origin: "http://127.0.0.1:4317", host: "evil.example:4317" }), "pwu"), false);
	assert.equal(up("/ws", h({ origin: "http://127.0.0.1:4317", upgrade: "h2c" }), "pwu"), false);
	assert.equal(up("/ws", h({ origin: "http://127.0.0.1:4317", "sec-fetch-site": "cross-site" }), "pwu"), false);
	assert.equal(up("/ws", h({ origin: "http://127.0.0.1:4317" })), false); // 旧本体
	// pwu でも HTTP は許可リスト
	assert.equal(checkRequest({ method: "GET", url: "/setup", headers: { host: "127.0.0.1:4317" } }, 4317, "pwu").ok, false);
	assert.equal(checkRequest({ method: "GET", url: "/", headers: { host: "127.0.0.1:4317" } }, 4317, "pwu").ok, true);
});

// ---- frames ----
function maskedFrame(opcode: number, payload: Buffer, fin = true, mask = true): Buffer {
	const len = payload.length;
	const head: number[] = [(fin ? 0x80 : 0) | opcode];
	const m = mask ? 0x80 : 0;
	if (len < 126) head.push(m | len);
	else if (len < 65536) head.push(m | 126, len >> 8, len & 0xff);
	else {
		head.push(m | 127, 0, 0, 0, 0);
		head.push((len >>> 24) & 0xff, (len >>> 16) & 0xff, (len >>> 8) & 0xff, len & 0xff);
	}
	if (!mask) return Buffer.concat([Buffer.from(head), payload]);
	const key = Buffer.from([1, 2, 3, 4]);
	const body = Buffer.from(payload.map((b, i) => b ^ key[i % 4]));
	return Buffer.concat([Buffer.from(head), key, body]);
}
const text = (msg: unknown) => maskedFrame(1, Buffer.from(JSON.stringify(msg)));

test("フレーム: 許可した型は元のバイトのまま渡し、それ以外は捨てる。途中で切れたフレームもつなげて読む", () => {
	const f = new ClientFrameFilter(policy);
	const a = text({ type: "get_state" });
	const b = text({ type: "terminal_create" });
	const c = text({ type: "prompt", text: "hi" });
	const all = Buffer.concat([a, b, c]);
	const out1 = f.push(all.subarray(0, 5));
	const out2 = f.push(all.subarray(5));
	assert.equal(out1.close ?? out2.close, undefined);
	assert.deepEqual(Buffer.concat([...out1.forward, ...out2.forward]), Buffer.concat([a, c]));
	assert.equal(out2.dropped, 1);
});

test("フレーム: ping / pong / close は通し、分割・バイナリ・マスク無し・1 MiB 超は接続ごと切る", () => {
	const ping = maskedFrame(9, Buffer.from("p"));
	assert.deepEqual(new ClientFrameFilter(policy).push(ping).forward, [ping]);
	const close = maskedFrame(8, Buffer.from([3, 232]));
	assert.deepEqual(new ClientFrameFilter(policy).push(close).forward, [close]);
	assert.ok(new ClientFrameFilter(policy).push(maskedFrame(1, Buffer.from('{"type":"get_state"}'), false)).close);
	assert.ok(new ClientFrameFilter(policy).push(maskedFrame(0, Buffer.from("x"))).close);
	assert.ok(new ClientFrameFilter(policy).push(maskedFrame(2, Buffer.from("x"))).close);
	assert.ok(new ClientFrameFilter(policy).push(maskedFrame(1, Buffer.from('{"type":"get_state"}'), true, false)).close);
	const big = Buffer.from(JSON.stringify({ type: "prompt", text: "a".repeat(1024 * 1024) }));
	assert.ok(new ClientFrameFilter(policy).push(maskedFrame(1, big)).close);
	// RSV ビット（圧縮）付きも切る
	const rsv = maskedFrame(1, Buffer.from('{"type":"get_state"}'));
	rsv[0] |= 0x40;
	assert.ok(new ClientFrameFilter(policy).push(rsv).close);
	// 切った後は何も渡さない
	const f = new ClientFrameFilter(policy);
	f.push(maskedFrame(2, Buffer.from("x")));
	assert.deepEqual(f.push(text({ type: "get_state" })).forward, []);
});

test("門番(pwu): /ws を本体へつなぎ、許可したメッセージだけ本体に届く。圧縮の申し出は外す", async () => {
	const received: string[] = [];
	let upgradeHeaders: Record<string, unknown> = {};
	const upstream: Server = createServer((_req, res) => res.end("up"));
	upstream.on("upgrade", (req, socket: Socket) => {
		upgradeHeaders = req.headers;
		socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: x\r\n\r\n");
		let buf = Buffer.alloc(0);
		socket.on("data", (d: Buffer) => {
			buf = Buffer.concat([buf, d]);
			// small masked text frames only (payload < 126) in this test
			while (buf.length >= 6 && buf.length >= 6 + (buf[1] & 0x7f)) {
				const len = buf[1] & 0x7f;
				const key = buf.subarray(2, 6);
				received.push(Buffer.from(buf.subarray(6, 6 + len).map((b, i) => b ^ key[i % 4])).toString());
				buf = buf.subarray(6 + len);
			}
		});
	});
	await new Promise<void>((r) => upstream.listen(0, "127.0.0.1", r));
	const upPort = (upstream.address() as AddressInfo).port;
	const gate = await startGate({ listenPort: 0, upstreamPort: upPort, publicPort: 4317, profile: "pwu", pwu: policy });
	const gatePort = (gate.address() as AddressInfo).port;
	try {
		const sock = connect(gatePort, "127.0.0.1");
		await new Promise<void>((r) => sock.on("connect", () => r()));
		const chunks: Buffer[] = [];
		sock.on("data", (d) => chunks.push(d));
		sock.write(
			"GET /ws HTTP/1.1\r\nHost: 127.0.0.1:4317\r\nOrigin: http://127.0.0.1:4317\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
				"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Extensions: permessage-deflate\r\n\r\n",
		);
		await new Promise((r) => setTimeout(r, 100));
		assert.match(Buffer.concat(chunks).toString("latin1"), /^HTTP\/1\.1 101/);
		assert.equal(upgradeHeaders["sec-websocket-extensions"], undefined);
		assert.equal(upgradeHeaders.host, `127.0.0.1:${upPort}`);
		assert.equal(upgradeHeaders.origin, `http://127.0.0.1:${upPort}`); // checked by the gate, rewritten for the upstream
		sock.write(Buffer.concat([text({ type: "terminal_create" }), text({ type: "get_state" }), text({ type: "prompt", text: "!id" }), text({ type: "prompt", text: "hi" })]));
		await new Promise((r) => setTimeout(r, 150));
		assert.deepEqual(received, ['{"type":"get_state"}', '{"type":"prompt","text":"hi"}']);
		sock.destroy();

		// Origin 無しの Upgrade は本体へ届かず 403
		upgradeHeaders = {};
		const s2 = connect(gatePort, "127.0.0.1");
		await new Promise<void>((r) => s2.on("connect", () => r()));
		const c2: Buffer[] = [];
		s2.on("data", (d) => c2.push(d));
		s2.write("GET /ws HTTP/1.1\r\nHost: 127.0.0.1:4317\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n");
		await new Promise((r) => setTimeout(r, 100));
		assert.match(Buffer.concat(c2).toString("latin1"), /^HTTP\/1\.1 403/);
		assert.deepEqual(upgradeHeaders, {});
		s2.destroy();

		// HTTP の許可リスト
		const get = (path: string) =>
			new Promise<number>((r) => httpRequest({ port: gatePort, host: "127.0.0.1", path, headers: { host: "127.0.0.1:4317" } }, (res) => { res.resume(); r(res.statusCode ?? 0); }).end());
		assert.equal(await get("/"), 200);
		assert.equal(await get("/setup"), 403);
	} finally {
		gate.closeAllConnections();
		gate.close();
		upstream.closeAllConnections();
		upstream.close();
	}
});
