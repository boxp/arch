// BOXP-714: pure decision logic for the Pi Web trial guard extension.
// Spec (current): Obsidian vault Projects/pi-web-agent-trial/spec.md
// No Pi imports here so that `node --test` can load it directly.
import { lstatSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

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
/**
 * Argument names each tool may receive (spec「道具の引数の決まり」). Any other name is refused: pi-web-ui's
 * read takes `file_path` as an alias of `path`, so a check that looks only at `path` would be bypassed.
 */
export const TOOL_ARGUMENTS: Readonly<Record<string, ReadonlySet<string>>> = {
	read: new Set(["path", "offset", "limit"]),
	grep: new Set(["pattern", "path", "glob", "ignoreCase", "literal", "context", "limit"]),
	find: new Set(["pattern", "path", "limit"]),
	ls: new Set(["path", "limit"]),
	write: new Set(["path", "content"]),
	edit: new Set(["path", "edits", "oldText", "newText", "soft"]),
	web_search: new Set(["query"]),
};
const WRITE_TOOLS = new Set(["write", "edit"]);
export const MAX_QUERY_CHARS = 120;
export const SHARED_RUN_CHARS = 16;
const MAX_MEMORY_CHARS = 4 * 1024 * 1024;

/**
 * `confirmQuery`: the exact text that will leave the machine. The caller must show it to the
 * Owner and send it only after an explicit confirmation (no UI or cancel -> block).
 */
export type Decision =
	| { allow: true; confirmQuery?: string; rewrite?: Record<string, unknown> }
	| { allow: false; reason: string };

/** Applied to grep input: rg runs with --hidden and recurses, so hidden entries must be excluded. */
export const GREP_EXCLUDE_HIDDEN_GLOB = "!.*";

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
	private readonly keys = new Set<string>();
	private size = 0;
	/** Set once the cap is exceeded; never cleared. web_search is refused from then on. */
	saturated = false;

	private readonly maxChars: number;

	constructor(maxChars = MAX_MEMORY_CHARS) {
		this.maxChars = maxChars;
	}

	/** `key` (tool call id) makes repeated adds of the same tool result count once. */
	add(text: string, key?: string): void {
		if (key !== undefined) {
			if (this.keys.has(key)) return;
			this.keys.add(key);
		}
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

/**
 * Read memories kept per chat (session id): one Pi Web process serves many chats, so text read in
 * one chat must not block searches in another, and a saturated chat must not stop new chats.
 */
export class SessionReadMemories {
	private readonly bySession = new Map<string, ReadMemory>();
	private readonly maxChars: number;

	constructor(maxChars = MAX_MEMORY_CHARS) {
		this.maxChars = maxChars;
	}

	forSession(sessionId: string): ReadMemory {
		let memory = this.bySession.get(sessionId);
		if (!memory) {
			memory = new ReadMemory(this.maxChars);
			this.bySession.set(sessionId, memory);
		}
		return memory;
	}
}

const READ_RESULT_TOOLS = READ_TOOLS;
const UNICODE_SPACES = /[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g;

/**
 * Rebuild the read memory from the chat's saved session entries (survives a server restart).
 * Only read/grep/find/ls results are remembered; each tool call counts once.
 */
export function rememberSessionReads(memory: ReadMemory, entries: readonly unknown[]): void {
	for (const entry of entries) {
		const e = entry as { type?: string; message?: { role?: string; toolName?: string; toolCallId?: string; content?: unknown } };
		const m = e?.type === "message" ? e.message : undefined;
		if (!m || m.role !== "toolResult" || !READ_RESULT_TOOLS.has(m.toolName ?? "") || !Array.isArray(m.content)) continue;
		const text = m.content
			.filter((part: { type?: string; text?: unknown }) => part?.type === "text" && typeof part.text === "string")
			.map((part: { text: string }) => part.text)
			.join("\n");
		memory.add(text, m.toolCallId);
	}
}

/**
 * Resolve like Pi's tools (unicode spaces, `@`, `~`, `file://` URLs, cwd), then follow symlinks
 * for the part that exists. Throws when a `file://` URL cannot be converted, or when an existing
 * entry cannot be resolved (a broken symlink, a loop): its target is unknown, so callers deny (fail-closed).
 */
export function resolveGuardPath(raw: string, cwd: string, home: string): string {
	let p = raw.replace(UNICODE_SPACES, " ");
	if (p.startsWith("@")) p = p.slice(1);
	if (p === "~") p = home;
	else if (p.startsWith("~/")) p = join(home, p.slice(2));
	else if (/^file:\/\//.test(p)) p = fileURLToPath(p);
	const absolute = isAbsolute(p) ? resolve(p) : resolve(cwd, p);
	let existing = absolute;
	const rest: string[] = [];
	while (!entryExists(existing)) {
		const parent = dirname(existing);
		if (parent === existing) break;
		rest.unshift(basename(existing));
		existing = parent;
	}
	// No fallback to the lexical path: a dangling link would let a write create its target anywhere.
	const real = realpathSync(existing);
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

function safeResolve(raw: string, ctx: GuardContext): string | undefined {
	try {
		return resolveGuardPath(raw, ctx.cwd, ctx.home);
	} catch {
		return undefined;
	}
}

function deny(reason: string): Decision {
	return { allow: false, reason };
}

export function decideToolCall(toolName: string, input: Record<string, unknown>, ctx: GuardContext): Decision {
	if (!ALLOWED_TOOLS.has(toolName)) {
		return deny(`Tool "${toolName}" is disabled in the Pi Web trial (allowed: ${[...ALLOWED_TOOLS].join(", ")}).`);
	}
	const known = TOOL_ARGUMENTS[toolName];
	const unknown = Object.keys(input).filter((key) => !known?.has(key));
	if (unknown.length > 0) return deny(`Unknown argument(s) for ${toolName}: ${unknown.join(", ")}. Use only: ${[...(known ?? [])].join(", ")}.`);
	const vault = realRoot(ctx.vaultRoot);

	if (READ_TOOLS.has(toolName)) {
		const raw = input.path ?? ".";
		if (typeof raw !== "string") return deny("path must be a string.");
		const target = safeResolve(raw, ctx);
		if (target === undefined) return deny(`Unsupported path: ${raw}`);
		if (!inside(vault, target)) return deny(`Only the Obsidian vault can be read in this trial: ${raw}`);
		if (hasHiddenSegment(vault, target)) return deny(`Hidden folders in the vault are not readable: ${raw}`);
		// pi-web-ui's read lists a folder, and that listing would skip the output filter for listings.
		if (toolName === "read" && isDirectory(target)) return deny(`read takes a file; use ls to list the folder ${raw}.`);
		if (toolName === "grep") {
			// Pi's grep recurses with --hidden; one exclude glob keeps .obsidian etc. out. A model-given
			// glob would replace it (only one glob is accepted), so it is refused.
			if (input.glob !== undefined) return deny("grep with glob is not available in this trial; omit glob and filter by path or pattern instead.");
			return { allow: true, rewrite: { glob: GREP_EXCLUDE_HIDDEN_GLOB } };
		}
		return { allow: true };
	}

	if (WRITE_TOOLS.has(toolName)) {
		const raw = input.path;
		if (typeof raw !== "string" || raw === "") return deny("path must be a non-empty string.");
		const sandbox = realRoot(ctx.sandboxRoot);
		const target = safeResolve(raw, ctx);
		if (target === undefined || target === sandbox || !inside(sandbox, target) || hasHiddenSegment(sandbox, target)) {
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


// ---------------------------------------------------------------------------
// Output filter (fail-closed). The path checks above only see where a tool starts; grep/find/ls then
// walk the tree themselves (rg/fd run with --hidden). Every line of their output that names an entry
// with a hidden segment is dropped here, whatever route the tool took to reach it. Lines whose shape is
// not known are dropped too, and a traversing tool without a known output shape is withheld entirely.
// ---------------------------------------------------------------------------

/** Tools whose output is not a listing of the tree (their target path was fully checked before the call). */
const UNFILTERED_OUTPUT_TOOLS = new Set(["read", "write", "edit", "web_search"]);
/** Fixed messages the listing tools print instead of entries. */
const FIXED_OUTPUT_LINES = new Set(["No matches found", "No files found matching pattern", "(empty directory)"]);
export const NO_VISIBLE_ENTRIES = "(no visible entries; hidden entries are not shown in this trial)";
/** grep match `path:N: text` and context `path-N- text`. */
const GREP_MARKER = /(?::\d+:|-\d+-)(?= |$)/g;

function pathHasHiddenSegment(path: string): boolean {
	return path.split("/").some((segment) => segment.startsWith("."));
}

function entryPath(toolName: string, line: string): string | undefined {
	if (toolName === "grep") {
		// The path may itself contain something like "-1- ": judge the longest candidate prefix, so a
		// hidden segment in any candidate drops the line (a hidden-looking body may be dropped too).
		const ends = [...line.matchAll(GREP_MARKER)].map((m) => m.index);
		return ends.length ? line.slice(0, ends[ends.length - 1]) : undefined;
	}
	return line; // find: relative path, ls: name (directories end with "/")
}

/**
 * Filter the text output of a tool before the model (and the read memory) sees it.
 * Returns undefined when the whole output must be withheld.
 */
export function filterToolOutput(toolName: string, text: string): string | undefined {
	if (UNFILTERED_OUTPUT_TOOLS.has(toolName)) return text;
	if (!READ_TOOLS.has(toolName)) return undefined;
	// Entries come first; tools append notices as "\n\n[...]" at the end.
	const noticeAt = text.search(/\n\n\[[^\n]*\]$/);
	const body = noticeAt === -1 ? text : text.slice(0, noticeAt);
	const notice = noticeAt === -1 ? "" : text.slice(noticeAt);
	const kept: string[] = [];
	let entries = 0;
	for (const line of body.split("\n")) {
		if (line === "") continue;
		if (FIXED_OUTPUT_LINES.has(line)) {
			kept.push(line);
			continue;
		}
		entries++;
		const path = entryPath(toolName, line);
		if (path === undefined || pathHasHiddenSegment(path)) continue;
		kept.push(line);
	}
	if (kept.length === 0 && entries > 0) return NO_VISIBLE_ENTRIES + notice;
	return kept.join("\n") + notice;
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

/** True when the entry itself exists, including a symlink whose target is missing (unlike existsSync). */
function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

function entryExists(path: string): boolean {
	try {
		lstatSync(path);
		return true;
	} catch {
		return false;
	}
}
