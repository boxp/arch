// Expected values come from the spec note
// (Obsidian: Projects/pi-web-agent-trial/spec.md), not from the implementation.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	ALLOWED_TOOLS,
	type GuardContext,
	decideToolCall,
	parseDuckDuckGoHtml,
	ReadMemory,
	SessionReadMemories,
	rememberSessionReads,
	filterToolOutput,
} from "../extension/guard.ts";

function setup(): GuardContext {
	const base = mkdtempSync(join(tmpdir(), "pi-web-trial-"));
	const home = join(base, "home");
	const vault = join(home, "vault");
	const sandbox = join(vault, "Projects", "pi-web-agent-trial", "sandbox");
	mkdirSync(sandbox, { recursive: true });
	mkdirSync(join(vault, "Projects", "kohako-home"), { recursive: true });
	mkdirSync(join(vault, ".obsidian"), { recursive: true });
	mkdirSync(join(home, ".config", "gh"), { recursive: true });
	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	writeFileSync(join(vault, "Projects", "kohako-home", "README.md"), "x");
	writeFileSync(join(home, ".config", "gh", "hosts.yml"), "secret");
	symlinkSync(join(home, ".config"), join(vault, "Projects", "escape"));
	return { cwd: vault, home, vaultRoot: vault, sandboxRoot: sandbox, memory: new ReadMemory() };
}

const allowed = (r: { allow: boolean }) => assert.equal(r.allow, true, JSON.stringify(r));
const blocked = (r: { allow: boolean }) => assert.equal(r.allow, false, JSON.stringify(r));

test("使える道具は 7 つで bash は含まない", () => {
	assert.deepEqual([...ALLOWED_TOOLS].sort(), ["edit", "find", "grep", "ls", "read", "web_search", "write"]);
	const ctx = setup();
	blocked(decideToolCall("bash", { command: "ls" }, ctx));
	blocked(decideToolCall("some_other_tool", {}, ctx));
});

test("read/grep/find/ls: vault 内は通す", () => {
	const ctx = setup();
	allowed(decideToolCall("read", { path: "Projects/kohako-home/README.md" }, ctx));
	allowed(decideToolCall("read", { path: "@Projects/kohako-home/README.md" }, ctx));
	allowed(decideToolCall("grep", { pattern: "コハコ" }, ctx));
	allowed(decideToolCall("find", { pattern: "*.md", path: "Projects" }, ctx));
	allowed(decideToolCall("ls", {}, ctx));
	allowed(decideToolCall("read", { path: join(ctx.vaultRoot, "Projects/not-yet.md") }, ctx));
});

test("read/grep/find/ls: vault 外・隠し段・vault 外への symlink は止める", () => {
	const ctx = setup();
	blocked(decideToolCall("read", { path: "~/.config/gh/hosts.yml" }, ctx));
	blocked(decideToolCall("read", { path: "../.pi/agent/auth.json" }, ctx));
	blocked(decideToolCall("read", { path: ".obsidian/workspace.json" }, ctx));
	blocked(decideToolCall("grep", { pattern: "token", path: ".obsidian" }, ctx));
	blocked(decideToolCall("ls", { path: ".." }, ctx));
	blocked(decideToolCall("find", { pattern: "*", path: "/" }, ctx));
	blocked(decideToolCall("read", { path: "Projects/escape/gh/hosts.yml" }, ctx));
	blocked(decideToolCall("read", { path: 42 }, ctx));
});

test("write/edit: sandbox 内の .md だけ通す", () => {
	const ctx = setup();
	allowed(decideToolCall("write", { path: "Projects/pi-web-agent-trial/sandbox/trial-log.md", content: "x" }, ctx));
	allowed(decideToolCall("edit", { path: "Projects/pi-web-agent-trial/sandbox/trial-log.md" }, ctx));
	blocked(decideToolCall("write", { path: "Projects/kohako-home/README.md", content: "x" }, ctx));
	blocked(decideToolCall("edit", { path: "Projects/pi-web-agent-trial/sandbox/../../x.md" }, ctx));
	blocked(decideToolCall("write", { path: "Projects/pi-web-agent-trial/sandbox/a.txt", content: "x" }, ctx));
	blocked(decideToolCall("write", { path: "Projects/pi-web-agent-trial/sandbox", content: "x" }, ctx));
	blocked(decideToolCall("write", { path: "~/.pi/agent/models.json", content: "x" }, ctx));
});

test("web_search: 1〜120 文字", () => {
	const ctx = setup();
	allowed(decideToolCall("web_search", { query: "llama.cpp router mode" }, ctx));
	allowed(decideToolCall("web_search", { query: "あ".repeat(120) }, ctx));
	blocked(decideToolCall("web_search", { query: "あ".repeat(121) }, ctx));
	blocked(decideToolCall("web_search", { query: "   " }, ctx));
	blocked(decideToolCall("web_search", {}, ctx));
});

test("web_search: 読んだ本文と 16 文字以上同じ並びは読んだ後だけ止める", () => {
	const ctx = setup();
	const q = "家のコハコが待機中に浮く椅子へ腰かける 仕組み";
	allowed(decideToolCall("web_search", { query: q }, ctx));
	ctx.memory.add("# 椅子\n\n家のコハコが待機中に浮く椅子へ腰かける・立つ決まり");
	blocked(decideToolCall("web_search", { query: q }, ctx));
	// 15 文字の一致は通す
	allowed(decideToolCall("web_search", { query: "家のコハコが待機中に浮く椅子へ 仕組み" }, ctx));
	allowed(decideToolCall("web_search", { query: "llama.cpp router mode" }, ctx));
});

test("web_search: 比較は小文字化・空白の連続を 1 つにして行う", () => {
	const ctx = setup();
	ctx.memory.add("Private   Project NAME alpha beta gamma");
	blocked(decideToolCall("web_search", { query: "private project name alpha" }, ctx));
});

test("DuckDuckGo HTML から上位 8 件の題名・URL・抜粋を取り出す", () => {
	const html = readFileSync(new URL("./fixtures/ddg-llama-cpp.html", import.meta.url), "utf8");
	const results = parseDuckDuckGoHtml(html);
	assert.equal(results.length, 8);
	assert.equal(results[0].url, "https://github.com/ggml-org/llama.cpp");
	assert.equal(results[0].title, "GitHub - ggml-org/llama.cpp: LLM inference in C/C++");
	assert.match(results[0].snippet, /^LLM inference in C\/C\+\+/);
	assert.equal(results[1].url, "https://llama-cpp.com/");
	assert.match(results[1].snippet, /^Llama\.cpp \(LLaMA C\+\+\)/);
	assert.deepEqual(parseDuckDuckGoHtml("<html>anomaly</html>"), []);
});

test("web_search: 通る検索語は必ず本人確認つき（検索語をそのまま見せる）", () => {
	const ctx = setup();
	const before = decideToolCall("web_search", { query: "  llama.cpp router mode " }, ctx);
	assert.deepEqual(before, { allow: true, confirmQuery: "llama.cpp router mode" });
	// 読んだ後の 16 文字未満の私的な語句も自動では通さず確認に回る
	ctx.memory.add("相談相手は山田花子さん");
	const after = decideToolCall("web_search", { query: "山田花子" }, ctx);
	assert.deepEqual(after, { allow: true, confirmQuery: "山田花子" });
	// 読み書き系は確認なし
	assert.deepEqual(decideToolCall("ls", {}, ctx), { allow: true });
});

test("web_search: 記録が上限を超えたら古い本文を捨てず、以後の検索を止める", () => {
	const ctx = setup();
	const memory = new ReadMemory(100);
	ctx.memory = memory;
	memory.add("最初に読んだ私的な本文はここにあります abcdefg");
	memory.add("x".repeat(120));
	assert.equal(memory.saturated, true);
	blocked(decideToolCall("web_search", { query: "最初に読んだ私的な本文はここにあります" }, ctx));
	blocked(decideToolCall("web_search", { query: "llama.cpp router mode" }, ctx));
	// 読み取り系は引き続き通す
	allowed(decideToolCall("ls", {}, ctx));
});

test("read/grep/find/ls: file:// URL も Pi と同じくファイルパスに直して判定する", () => {
	const ctx = setup();
	blocked(decideToolCall("read", { path: "file:///etc/passwd" }, ctx));
	blocked(decideToolCall("ls", { path: `file://${ctx.home}/.config/gh` }, ctx));
	blocked(decideToolCall("read", { path: "file://remote-host/etc/passwd" }, ctx));
	allowed(decideToolCall("read", { path: `file://${ctx.vaultRoot}/Projects/kohako-home/README.md` }, ctx));
	blocked(decideToolCall("read", { path: `@file://${ctx.vaultRoot}/.obsidian/workspace.json` }, ctx));
});

test("grep: glob 無しなら隠し段を除く !.* を付けて通し、glob 付きは止める", () => {
	const ctx = setup();
	assert.deepEqual(decideToolCall("grep", { pattern: "token" }, ctx), { allow: true, rewrite: { glob: "!.*" } });
	assert.deepEqual(decideToolCall("grep", { pattern: "x", path: "Projects" }, ctx), {
		allow: true,
		rewrite: { glob: "!.*" },
	});
	blocked(decideToolCall("grep", { pattern: "token", glob: "*.md" }, ctx));
	blocked(decideToolCall("grep", { pattern: "token", glob: "!.*" }, ctx));
	// read/find/ls は書き換えなし
	assert.deepEqual(decideToolCall("find", { pattern: "*.md" }, ctx), { allow: true });
});

test("web_search: 再起動後も会話記録に残った読取結果から判定する（同じ呼び出しは 1 回だけ数える）", () => {
	const ctx = setup();
	const entries = [
		{ type: "message", message: { role: "user", content: "家のコハコが待機中に浮く椅子へ腰かける" } },
		{
			type: "message",
			message: {
				role: "toolResult",
				toolCallId: "c1",
				toolName: "read",
				content: [{ type: "text", text: "家のコハコが待機中に浮く椅子へ腰かける・立つ決まり" }],
			},
		},
		{
			type: "message",
			message: { role: "toolResult", toolCallId: "c2", toolName: "web_search", content: [{ type: "text", text: "llama.cpp router mode docs" }] },
		},
		{ type: "model_change" },
	];
	rememberSessionReads(ctx.memory, entries);
	blocked(decideToolCall("web_search", { query: "家のコハコが待機中に浮く椅子へ腰かける 仕組み" }, ctx));
	// read 以外（ユーザー発言・web_search 結果）は記録しない
	assert.deepEqual(decideToolCall("web_search", { query: "llama.cpp router mode docs" }, ctx), {
		allow: true,
		confirmQuery: "llama.cpp router mode docs",
	});
	// 同じ toolCallId は二重に数えない（何度作り直しても上限に近づかない）
	const memory = new ReadMemory(60);
	memory.add("家のコハコが待機中に浮く椅子へ腰かける・立つ決まり", "c1");
	rememberSessionReads(memory, entries);
	rememberSessionReads(memory, entries);
	assert.equal(memory.saturated, false);
});

test("出力: find/ls/grep の結果から隠し段（. で始まる名前）を含む行は道具の走査の仕方に依らず落とす", () => {
	// find: 1 行 1 パス（検索開始地点からの相対）
	assert.equal(
		filterToolOutput("find", ".obsidian/workspace.json\nProjects/a.md\nProjects/.trash/b.md\n.git/\nnotes/.hidden\nc.md"),
		"Projects/a.md\nc.md",
	);
	// ls: 1 行 1 名前（ディレクトリは末尾 /）
	assert.equal(filterToolOutput("ls", ".obsidian/\n.DS_Store\nProjects/\nREADME.md"), "Projects/\nREADME.md");
	// grep: 「パス:行番号: 本文」と前後行の「パス-行番号- 本文」
	assert.equal(
		filterToolOutput(
			"grep",
			".obsidian/plugins/x/data.json:3: token=abc\nProjects/a.md:1: コハコ\nProjects/a.md-2- 次の行\nProjects/.trash/b.md:4: 私的\nsub/.cfg-5- 秘密",
		),
		"Projects/a.md:1: コハコ\nProjects/a.md-2- 次の行",
	);
	// 本文側の .（例: 拡張子や「...」）は落とさない
	assert.equal(filterToolOutput("grep", "a.md:1: see ./.obsidian later"), "a.md:1: see ./.obsidian later");
});

test("出力: 形の分からない行は落とし（fail-closed）、道具の決まった文言と末尾の [注記] は残す", () => {
	assert.equal(filterToolOutput("grep", "no-line-number-here\nProjects/a.md:1: x"), "Projects/a.md:1: x");
	assert.equal(filterToolOutput("grep", "No matches found"), "No matches found");
	assert.equal(filterToolOutput("find", "No files found matching pattern"), "No files found matching pattern");
	assert.equal(filterToolOutput("ls", "(empty directory)"), "(empty directory)");
	assert.equal(
		filterToolOutput("find", "a.md\n.x/b.md\n\n[1000 results limit reached. Use limit=2000 for more, or refine pattern]"),
		"a.md\n\n[1000 results limit reached. Use limit=2000 for more, or refine pattern]",
	);
	// 全部落ちたら「隠し項目を除いた」旨だけ返す（名前は出さない）
	assert.equal(filterToolOutput("ls", ".obsidian/\n.git/"), "(no visible entries; hidden entries are not shown in this trial)");
	// read は開始地点の判定だけで足りる（走査しない）ので本文はそのまま
	assert.equal(filterToolOutput("read", ".obsidian 本文\n.x"), ".obsidian 本文\n.x");
	// 走査する道具で出力の形を知らないものは丸ごと伏せる
	assert.equal(filterToolOutput("unknown_listing", "a\nb"), undefined);
});

test("出力: grep のパスに行番号に似た並びがあっても、隠し段が見える候補が一つでもあれば落とす", () => {
	// パス "a-1- b/.x/c.md" か "a" か区別できない → 長い方の候補で判定して落とす
	assert.equal(filterToolOutput("grep", "a-1- b/.x/c.md:3: 秘密\nok.md:2: x"), "ok.md:2: x");
});

test("web_search: 読んだ本文の記録と上限超過の印はチャット（セッション ID）ごとに分ける", () => {
	const ctx = setup();
	const memories = new SessionReadMemories(100);
	const note = "チャットAで読んだ私的なノートの一文はこれです";
	memories.forSession("A").add(note);
	// A の中では止まる
	blocked(decideToolCall("web_search", { query: note }, { ...ctx, memory: memories.forSession("A") }));
	// 別チャット B では A の記録で止めない（本人確認へ進む）
	allowed(decideToolCall("web_search", { query: note }, { ...ctx, memory: memories.forSession("B") }));
	// A が上限を超えても新しいチャット C は止めない、A は引き続き止める
	memories.forSession("A").add("x".repeat(120));
	assert.equal(memories.forSession("A").saturated, true);
	blocked(decideToolCall("web_search", { query: "llama.cpp router mode" }, { ...ctx, memory: memories.forSession("A") }));
	allowed(decideToolCall("web_search", { query: "llama.cpp router mode" }, { ...ctx, memory: memories.forSession("C") }));
	// 同じ ID は同じ記録を返す
	assert.equal(memories.forSession("A"), memories.forSession("A"));
});
