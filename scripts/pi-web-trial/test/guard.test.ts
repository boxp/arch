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
