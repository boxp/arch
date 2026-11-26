// BOXP-714: pure decision logic for the Pi Web trial guard extension.
// Spec (current): Obsidian vault Projects/pi-web-agent-trial/spec.md
// No Pi imports here so that `node --test` can load it directly.
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
	"read",
	"grep",
	"find",
	"ls",
	"write",
	"edit",
	"web_search",
]);

const READ_TOOLS = new Set(["read", "grep", "find", "ls"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
export const MAX_QUERY_CHARS = 120;
export const SHARED_RUN_CHARS = 16;
const MAX_MEMORY_CHARS = 4 * 1024 * 1024;

/**
 * `confirmQuery`: the exact text that will leave the machine. The caller must show it to the
 * Owner and send it only after an explicit confirmation (no UI or cancel -> block).
 */
export type Decision = { allow: true; confirmQuery?: string } | { allow: false; reason: string };

export interface GuardContext {
	cwd: string;
	home: string;
	vaultRoot: string;
	sandboxRoot: string;
	memory: ReadMemory;
}

function normalizeText(text: string): string {
	return text.toLowerCase().replace(/\s+/g, " ");
}

/** Text returned by read-type tools in this chat process (normalized). */
export class ReadMemory {
	private chunks: string[] = [];
	private size = 0;
	/** Set once the cap is exceeded; never cleared. web_search is refused from then on. */
	saturated = false;

	private readonly maxChars: number;

	constructor(maxChars = MAX_MEMORY_CHARS) {
		this.maxChars = maxChars;
	}

	add(text: string): void {
		const normalized = normalizeText(text);
		if (!normalized) return;
		// Never drop old text (that would let it pass the check later): stop searching instead.
		if (this.saturated || this.size + normalized.length > this.maxChars) {
			this.saturated = true;
			return;
		}
		this.chunks.push(normalized);
		this.size += normalized.length;
	}

	/** True when `query` shares a run of at least `n` characters with remembered text. */
	sharesRun(query: string, n = SHARED_RUN_CHARS): boolean {
		const chars = Array.from(normalizeText(query));
		if (chars.length < n) return false;
		for (let i = 0; i + n <= chars.length; i++) {
			const window = chars.slice(i, i + n).join("");
			if (this.chunks.some((chunk) => chunk.includes(window))) return true;
		}
		return false;
	}
}

/** Resolve like Pi's tools, then follow symlinks for the part that exists. */
export function resolveGuardPath(raw: string, cwd: string, home: string): string {
	let p = raw.startsWith("@") ? raw.slice(1) : raw;
	if (p === "~") p = home;
	else if (p.startsWith("~/")) p = join(home, p.slice(2));
	const absolute = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
	let existing = absolute;
	const rest: string[] = [];
	while (!existsSync(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		rest.unshift(basename(existing));
		existing = parent;
	}
	let real = existing;
	try {
		real = realpathSync(existing);
	} catch {
		// keep the lexical path
	}
	return rest.length ? join(real, ...rest) : real;
}

function realRoot(root: string): string {
	try {
		return realpathSync(root);
	} catch {
		return resolve(root);
	}
}

function inside(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function hasHiddenSegment(root: string, target: string): boolean {
	const rel = relative(root, target);
	return rel !== "" && rel.split(sep).some((segment) => segment.startsWith("."));
}

function deny(reason: string): Decision {
	return { allow: false, reason };
}

export function decideToolCall(toolName: string, input: Record<string, unknown>, ctx: GuardContext): Decision {
	if (!ALLOWED_TOOLS.has(toolName)) {
		return deny(`Tool "${toolName}" is disabled in the Pi Web trial (allowed: ${[...ALLOWED_TOOLS].join(", ")}).`);
	}
	const vault = realRoot(ctx.vaultRoot);

	if (READ_TOOLS.has(toolName)) {
		const raw = input.path ?? ".";
		if (typeof raw !== "string") return deny("path must be a string.");
		const target = resolveGuardPath(raw, ctx.cwd, ctx.home);
		if (!inside(vault, target)) return deny(`Only the Obsidian vault can be read in this trial: ${raw}`);
		if (hasHiddenSegment(vault, target)) return deny(`Hidden folders in the vault are not readable: ${raw}`);
		return { allow: true };
	}

	if (WRITE_TOOLS.has(toolName)) {
		const raw = input.path;
		if (typeof raw !== "string" || raw === "") return deny("path must be a non-empty string.");
		const sandbox = realRoot(ctx.sandboxRoot);
		const target = resolveGuardPath(raw, ctx.cwd, ctx.home);
		if (target === sandbox || !inside(sandbox, target) || hasHiddenSegment(sandbox, target)) {
			return deny(`Writing is limited to ${relative(vault, sandbox) || sandbox}/ in this trial: ${raw}`);
		}
		if (!target.endsWith(".md")) return deny(`Only Markdown (.md) files can be written: ${raw}`);
		return { allow: true };
	}

	// web_search
	const query = typeof input.query === "string" ? input.query.trim() : "";
	const length = Array.from(query).length;
	if (length === 0) return deny("query must not be empty.");
	if (length > MAX_QUERY_CHARS) return deny(`query must be at most ${MAX_QUERY_CHARS} characters (got ${length}).`);
	if (ctx.memory.saturated) {
		return deny("Too much note text was read in this chat to check web_search queries. Start a new chat to search the web.");
	}
	if (ctx.memory.sharesRun(query)) {
		return deny(
			`The query repeats ${SHARED_RUN_CHARS}+ characters of note text read in this chat. Do not send note contents to the web; use short general keywords instead.`,
		);
	}
	// Short private phrases cannot be told apart automatically: the Owner confirms every query.
	return { allow: true, confirmQuery: query };
}

export interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

function decodeEntities(text: string): string {
	return text
		.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
		.replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number.parseInt(d, 10)))
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&");
}

function stripTags(html: string): string {
	return decodeEntities(html.replace(/<[^>]*>/g, ""))
		.replace(/\s+/g, " ")
		.trim();
}

function unwrapDuckDuckGoUrl(href: string): string {
	const decoded = decodeEntities(href);
	try {
		const url = new URL(decoded, "https://duckduckgo.com");
		const target = url.hostname.endsWith("duckduckgo.com") ? url.searchParams.get("uddg") : null;
		return target ?? url.toString();
	} catch {
		return decoded;
	}
}

/** Parse the DuckDuckGo HTML endpoint (html.duckduckgo.com/html/). */
export function parseDuckDuckGoHtml(html: string, limit = 8): SearchResult[] {
	const results: SearchResult[] = [];
	const linkPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
	const links = [...html.matchAll(linkPattern)];
	for (let i = 0; i < links.length && results.length < limit; i++) {
		const match = links[i];
		const end = i + 1 < links.length ? links[i + 1].index : html.length;
		const block = html.slice(match.index, end);
		const snippet = /class="result__snippet"[^>]*>([\s\S]*?)<\/a>/.exec(block);
		const url = unwrapDuckDuckGoUrl(match[1]);
		if (!/^https?:\/\//.test(url)) continue;
		results.push({ title: stripTags(match[2]), url, snippet: snippet ? stripTags(snippet[1]) : "" });
	}
	return results;
}
