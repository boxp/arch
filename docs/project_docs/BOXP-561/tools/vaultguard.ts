// BOXP-561 長時間評価: 本番 vault を変更しうる tool 呼び出しを「実行前に」拒否する pi 拡張（long_run.sh が -e で読み込む）。
// OS レベルの一次防御は landlock_exec.py（pi と全子プロセスから本番 vault の読み書きをカーネルで拒否）。
// 本拡張はその手前で、明示的に vault を指す tool 呼び出しを分かりやすい理由付きで止める補助層。判定できない場合は拒否する（fail closed）。
// - write/edit: 対象パスを cwd 基準で解決し、存在する最も近い親を realpath して本番 vault 配下なら拒否
// - bash: コマンド文字列に本番 vault を指しうるパス要素（obsidian-headless / Documents とその glob）を含めば読み書きを問わず拒否
//   （bash の書込み先は静的に判定しきれないため。評価課題の資料はすべて隔離コピー側にある）
//   変数の組み立て等で文字列照合を逃れる経路は landlock_exec.py が OS で拒否する。vaultwatch.sh（事後 ABORT）と guard.bb（digest 照合）は二次防御
import * as fs from "node:fs";
import * as path from "node:path";

const VAULT_ROOT = process.env.BOXP561_PROTECTED_ROOT || "/home/boxp/Documents/obsidian-headless";
// obsidian-task-board（scratch vault 向け task-board.bb）は T1 で正当に使うので、本番 vault のパス要素とその glob 形だけを拒否する
const BASH_DENY = /obsidian-head|documents/i;
// 本番 vault パスの各要素（home / boxp / Documents / obsidian-headless …）。glob の各セグメントがこのどれかに一致しうるなら拒否する
// （`cd /home/boxp; rm -rf Doc*/obs*/BOXP` のような相対 glob や `*` 単独も対象。大文字小文字は nocaseglob を考慮し無視）
const VAULT_PARTS = Array.from(new Set(
  [VAULT_ROOT, "/home/boxp/Documents/obsidian-headless"].flatMap((r) => r.split("/")).filter((x) => x !== ""),
));

function globSegmentRegex(seg: string): RegExp | undefined {
  let re = "";
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === "*") re += ".*";
    else if (ch === "?") re += ".";
    else if (ch === "[") {
      const end = seg.indexOf("]", i + 2);
      if (end < 0) return undefined; // 解釈できない括弧は呼び出し側で拒否
      let body = seg.slice(i + 1, end);
      if (body.startsWith("!") || body.startsWith("^")) body = "^" + body.slice(1);
      re += "[" + body.replace(/\\/g, "\\\\") + "]";
      i = end;
    } else re += ch.replace(/[.+^${}()|\\\]]/g, "\\$&");
  }
  return new RegExp("^" + re + "$", "i");
}

// glob を含むセグメントが本番 vault のパス要素に一致しうるかを判定する（判定不能は一致扱い）
export function globHitsVault(command: string): boolean {
  const tokens = command.split(/[\s;|&()<>=:,{}`]+/);
  for (const tok of tokens) {
    if (!/[*?[]/.test(tok)) continue;
    for (const seg of tok.split("/")) {
      if (!/[*?[]/.test(seg)) continue;
      let re: RegExp | undefined;
      try {
        re = globSegmentRegex(seg);
      } catch {
        return true;
      }
      if (!re) return true;
      if (VAULT_PARTS.some((part) => re!.test(part))) return true;
    }
  }
  return false;
}

function realish(p: string): string {
  let cur = p;
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.join(cur, ...rest.reverse());
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

let rootReal = VAULT_ROOT;
try {
  rootReal = fs.realpathSync(VAULT_ROOT);
} catch {}

export function isProtectedPath(p: string, cwd: string): boolean {
  const abs = realish(path.resolve(cwd, p.replace(/^~(?=\/|$)/, process.env.HOME || "~")));
  return abs === rootReal || abs.startsWith(rootReal + path.sep) || abs === VAULT_ROOT || abs.startsWith(VAULT_ROOT + path.sep);
}

export function decide(toolName: string, input: any, cwd: string): string | undefined {
  try {
    if (toolName === "write" || toolName === "edit") {
      const p = input?.path ?? input?.file_path;
      if (typeof p !== "string" || p === "") return "path を判定できないため拒否しました";
      if (isProtectedPath(p, cwd)) return `本番 vault 配下 (${p}) への書込みは評価中は禁止です`;
      return undefined;
    }
    if (toolName === "read" || toolName === "grep" || toolName === "find" || toolName === "ls") {
      // 読取り系も本番 vault 配下は拒否する（合成課題の汚染・私的本文の混入を防ぐ）。path 省略は cwd を対象とみなす
      const p = input?.path ?? input?.file_path ?? ".";
      if (typeof p !== "string") return "path を判定できないため拒否しました";
      if (isProtectedPath(p, cwd)) return `本番 vault 配下 (${p}) の参照は評価中は禁止です`;
      return undefined;
    }
    if (toolName === "bash") {
      const c = input?.command;
      if (typeof c !== "string") return "command を判定できないため拒否しました";
      // 引用符・バックスラッシュによる分割（Doc"uments"、D\ocuments 等）は除去してから照合する
      const norm = c.replace(/["'\\]/g, "");
      if (BASH_DENY.test(norm) || globHitsVault(norm)) return "評価中は本番 vault を指しうるコマンドは実行できません。作業ディレクトリ内の資料だけを使ってください";
      return undefined;
    }
    return undefined;
  } catch {
    return "安全判定に失敗したため拒否しました";
  }
}

export default function (pi: any) {
  pi.on("tool_call", async (event: any, ctx: any) => {
    const reason = decide(event.toolName, event.input, ctx?.cwd || process.cwd());
    if (reason) return { block: true, reason };
    return undefined;
  });
}
