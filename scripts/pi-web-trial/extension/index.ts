// BOXP-714: Pi Web trial guard extension.
// - keeps only the trial tools active (no bash)
// - blocks file tools outside the Obsidian vault / writes outside the sandbox
// - adds a `web_search` tool (DuckDuckGo HTML, query only, no page fetch)
// - blocks queries that copy note text read in this chat
// Spec (current): Obsidian vault Projects/pi-web-agent-trial/spec.md
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ALLOWED_TOOLS, decideToolCall, type GuardContext, parseDuckDuckGoHtml, ReadMemory } from "./guard.ts";

const SEARCH_URL = "https://html.duckduckgo.com/html/";
const SEARCH_TIMEOUT_SECONDS = 15;
const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);

export default function piWebTrialGuard(pi: ExtensionAPI) {
	const vaultRoot = process.env.PI_WEB_TRIAL_VAULT ?? join(homedir(), "Documents/obsidian-headless/BOXP");
	const sandboxRoot = process.env.PI_WEB_TRIAL_SANDBOX ?? join(vaultRoot, "Projects/pi-web-agent-trial/sandbox");
	const memory = new ReadMemory();
	const context = (cwd: string): GuardContext => ({ cwd, home: homedir(), vaultRoot, sandboxRoot, memory });

	pi.registerTool({
		name: "web_search",
		label: "Web search",
		description:
			"Search the public web (DuckDuckGo) and return up to 8 results (title, URL, snippet). Send short general keywords only.",
		promptSnippet: "Search the public web for short keyword queries",
		promptGuidelines: [
			"Use web_search only with short general keywords (max 120 characters).",
			"Never put text from Obsidian notes or files into web_search queries; notes are private.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "Short search keywords (max 120 characters)" }),
		}),
		async execute(_toolCallId, params, signal) {
			// curl instead of fetch: DuckDuckGo answers Node fetch with its bot check page.
			// Arguments are passed as an array (no shell); "q=<query>" is the literal form of --data-urlencode.
			const html = await new Promise<string>((resolve, reject) => {
				execFile(
					"curl",
					["-q", "-sS", "--fail", "--proto", "=https", "--max-time", String(SEARCH_TIMEOUT_SECONDS), "-A", "Mozilla/5.0",
					 "-X", "POST", "--data-urlencode", `q=${params.query.trim()}`, SEARCH_URL],
					{ signal, maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH ?? "/usr/bin:/bin" } },
					(error, stdout) => (error ? reject(new Error(`web_search failed: ${error.message}`)) : resolve(stdout)),
				);
			});
			const results = parseDuckDuckGoHtml(html);
			if (results.length === 0) throw new Error("web_search returned no results (or the search engine refused the request).");
			const text = results
				.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`)
				.join("\n");
			return { content: [{ type: "text", text }], details: { engine: "duckduckgo-html", count: results.length } };
		},
	});

	pi.on("session_start", () => {
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		pi.setActiveTools([...ALLOWED_TOOLS].filter((name) => available.has(name)));
	});

	pi.on("tool_call", (event, ctx) => {
		const decision = decideToolCall(event.toolName, event.input as Record<string, unknown>, context(ctx.cwd));
		if (decision.allow) return undefined;
		if (ctx.hasUI) ctx.ui.notify(`Blocked: ${decision.reason}`, "warning");
		return { block: true, reason: decision.reason };
	});

	pi.on("tool_result", (event) => {
		if (!READ_TOOLS.has(event.toolName)) return undefined;
		for (const part of event.content) {
			if (part.type === "text") memory.add(part.text);
		}
		return undefined;
	});
}
