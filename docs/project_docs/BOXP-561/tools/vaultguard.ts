// BOXP-561 長時間評価: 本番 vault を変更しうる tool 呼び出しを「実行前に」拒否する pi 拡張（long_run.sh が -e で読み込む）。
// vaultwatch.sh は実行開始後の事後検出なので、こちらが一次防御。判定できない場合は拒否する（fail closed）。
// - write/edit: 対象パスを cwd 基準で解決し、存在する最も近い親を realpath して本番 vault 配下なら拒否
// - bash: コマンド文字列に本番 vault を指しうるパス要素（obsidian-headless / Documents とその glob）を含めば読み書きを問わず拒否
//   （bash の書込み先は静的に判定しきれないため。評価課題の資料はすべて隔離コピー側にある）
//   変数の組み立て等で文字列照合を逃れる経路は残るため、vaultwatch.sh（事後 ABORT）と guard.bb（区間前後の digest 照合）を併用する
import * as fs from "node:fs";
import * as path from "node:path";

const VAULT_ROOT = process.env.BOXP561_PROTECTED_ROOT || "/home/boxp/Documents/obsidian-headless";
// obsidian-task-board（scratch vault 向け task-board.bb）は T1 で正当に使うので、本番 vault のパス要素とその glob 形だけを拒否する
const BASH_DENY = /obsidian-head|documents|\/doc[^/\s]*[*?[]|\/obs[^/\s]*[*?[]/i;

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
    if (toolName === "bash") {
      const c = input?.command;
      if (typeof c !== "string") return "command を判定できないため拒否しました";
      if (BASH_DENY.test(c)) return "評価中は本番 vault を指しうるコマンドは実行できません。作業ディレクトリ内の資料だけを使ってください";
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
