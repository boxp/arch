#!/usr/bin/env bash
set -euo pipefail

# End-to-end check for BOXP-307 against a deployed Novel Board runner and the
# real local model: a work groomed from Backlog, moved back from Draft to
# Backlog the way the Kanban UI does it (line moved verbatim), is re-groomed
# under the same NOVEL id with the same management note.
#
# Everything runs in a throw-away vault and private root created here; the
# live vault and the live runner state are never read or written. The fixture
# is synthetic and non-explicit. No manuscript, illustration or publication is
# started (image / cloud agents are pointed at /bin/false).
#
# Usage (inside the novel-board-runner container, or anywhere bb and the model
# endpoint are reachable):
#   tests/codex-workspace/novel-board-regroom-e2e.sh
# Env: NOVEL_BOARD_RUNNER (default /opt/codex-workspace/novel-board/novel_board_runner.bb),
#      NOVEL_BOARD_SEED (default <runner dir>/vault-seed),
#      CODEX_NOVEL_BOARD_LOCALLLM_BASE_URL / _MODEL (default: cluster llama-server),
#      KEEP_TMP=1 to keep the temporary vault.

RUNNER="${NOVEL_BOARD_RUNNER:-/opt/codex-workspace/novel-board/novel_board_runner.bb}"
SEED="${NOVEL_BOARD_SEED:-$(dirname "${RUNNER}")/vault-seed}"
[[ -f "${RUNNER}" ]] || { echo "runner not found: ${RUNNER}" >&2; exit 2; }
[[ -d "${SEED}" ]] || { echo "vault seed not found: ${SEED}" >&2; exit 2; }

TMP="$(mktemp -d)"
trap '[[ -n "${KEEP_TMP:-}" ]] || rm -rf "${TMP}"' EXIT
VAULT="${TMP}/vault"
STATE="${TMP}/state"
BOARD="${VAULT}/Boards/Novel Board.md"
mkdir -p "${VAULT}/Boards" "${VAULT}/Novels" "${VAULT}/Templates" "${VAULT}/ひとはこさんバース/世界観設定" "${VAULT}/ひとはこさんバース/キャラ設定"
cp "${SEED}/Boards/Novel Board.md" "${BOARD}"
cp "${SEED}/Templates/Novel Management.md" "${VAULT}/Templates/Novel Management.md"
cp "${SEED}/Novels/README.md" "${VAULT}/Novels/README.md"
cat >"${VAULT}/ひとはこさんバース/世界観設定/README.md" <<'EOF'
# 世界観（E2E 合成設定）

- 舞台は海辺の町にある星見ヶ丘学園。
- 文化祭は毎年 11 月、校舎の屋上から灯台が見える。
EOF
cat >"${VAULT}/ひとはこさんバース/キャラ設定/星野みら.md" <<'EOF'
---
aliases: [みら]
---
# 星野みら

星見ヶ丘学園 2 年。天文部。口癖は「まだ見える」。
EOF

export CODEX_NOVEL_BOARD_VAULT="${VAULT}"
export CODEX_NOVEL_BOARD_ROOT="${STATE}"
export CODEX_NOVEL_BOARD_OWNER_ID="regroom-e2e-$(date -u +%Y%m%dT%H%M%SZ)"
export CODEX_NOVEL_BOARD_LOCALLLM_BASE_URL="${CODEX_NOVEL_BOARD_LOCALLLM_BASE_URL:-http://llama-server.local-llm.svc.cluster.local:8080/v1}"
export CODEX_NOVEL_BOARD_LOCALLLM_MODEL="${CODEX_NOVEL_BOARD_LOCALLLM_MODEL:-gemma4-26b}"
export CODEX_NOVEL_BOARD_IMAGE_SCRIPT=/bin/false
export CODEX_NOVEL_BOARD_CLAUDE_BIN=/bin/false
export CODEX_NOVEL_BOARD_CODEX_BIN=/bin/false
export CODEX_NOVEL_BOARD_SETTING_ROOTS="ひとはこさんバース"
export CODEX_NOVEL_BOARD_REQUIRED_SETTINGS="ひとはこさんバース/世界観設定/README.md"

fail() { echo "FAIL: $*" >&2; exit 1; }
tick() { bb "${RUNNER}" tick >>"${TMP}/runner.log" 2>&1; }
lane_of() { awk -v id="$1" '/^## /{lane=substr($0,4)} index($0,"[[Novels/" id "|")>0 {print lane; exit}' "${BOARD}"; }
card_line() { grep -F "[[Novels/$1|" "${BOARD}"; }
note_count() { find "${VAULT}/Novels" -maxdepth 1 -name 'NOVEL-*.md' | wc -l; }
run_count() { find "${STATE}/runs/$1" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l; }
latest_run_id() { find "${STATE}/runs/$1" -mindepth 1 -maxdepth 1 -type d | sort | tail -n 1 | xargs -r basename; }
section() { sed -n "/^## $2\$/,/^## /p" "${VAULT}/Novels/$1.md"; }
move_line_to_lane() { # id lane : moves the card line verbatim (what the Kanban UI does)
  local line; line="$(card_line "$1")"
  awk -v skip="${line}" '$0 != skip' "${BOARD}" >"${BOARD}.tmp"
  LINE="${line}" awk -v lane="## $2" '{ print } $0 == lane { print ""; print ENVIRON["LINE"] }' "${BOARD}.tmp" >"${BOARD}" && rm -f "${BOARD}.tmp"
}
set_assignee() { sed -i -E "/\[\[Novels\/$1\|/s/assignee::[^ ]+/assignee::$2/" "${BOARD}"; }

echo "== 1. Backlog title-only card -> scaffold -> groom (real model)"
TITLE="再整理E2E 灯台の見える文化祭"
sed -i "/^## Backlog$/a - [ ] ${TITLE} assignee::localllm" "${BOARD}"
START="$(date +%s)"
tick
ID="$(grep -o 'NOVEL-[0-9]*: '"${TITLE}" "${BOARD}" | head -n 1 | cut -d: -f1)"
[[ -n "${ID}" ]] || fail "scaffold did not happen: $(grep -F "${TITLE}" "${BOARD}")"
[[ "$(lane_of "${ID}")" == "Draft" ]] || fail "first groom should reach Draft: $(card_line "${ID}")"
[[ "$(note_count)" == "1" ]] || fail "one note expected after scaffold"
FIRST="$(latest_run_id "${ID}")"
echo "   ${ID} groomed in $(( $(date +%s) - START ))s (run ${FIRST})"

echo "== 2. Draft -> Backlog (line moved verbatim), assignee localllm -> re-groom (real model)"
move_line_to_lane "${ID}" Backlog
grep -Fq "status::draft" <<<"$(card_line "${ID}")" || fail "fixture: moved line should still say status::draft"
set_assignee "${ID}" localllm
START="$(date +%s)"
tick
[[ "$(lane_of "${ID}")" == "Draft" ]] || fail "re-groom should hand back to Draft: $(card_line "${ID}")"
grep -Fq "[[Novels/${ID}|${ID}: ${TITLE}]] #novel status::draft assignee::boxp" "${BOARD}" || fail "card must be canonical Draft/boxp: $(card_line "${ID}")"
[[ "$(note_count)" == "1" ]] || fail "re-groom must not add a note"
[[ "$(grep -c "\[\[Novels/${ID}|" "${BOARD}")" == "1" ]] || fail "one card expected"
! grep -q "NOVEL-2" "${BOARD}" || fail "no second id may appear"
[[ "$(run_count "${ID}")" == "2" ]] || fail "two groom runs expected, got $(run_count "${ID}")"
SECOND="$(latest_run_id "${ID}")"
section "${ID}" "Run History" | grep -F "run ${SECOND} started: action=groom" | grep -Fq "既存作品の再整理" || fail "re-groom label missing in Run History"
section "${ID}" "Change History" | grep -Fq "Backlog からの再整理で Requirements / Outline を更新（同じ ${ID}" || fail "re-groom missing in Change History"
section "${ID}" "Reference Context" | grep -Fq "${SECOND}" || fail "Reference Context must be replaced by the second run"
! section "${ID}" "Reference Context" | grep -Fq "${FIRST}" || fail "Reference Context must not keep the first run"
grep -Fq "status: draft" "${VAULT}/Novels/${ID}.md" || fail "frontmatter must follow the lane"
[[ ! -e "${STATE}/work/${ID}/manuscript.md" ]] || fail "no manuscript may be written"
[[ ! -d "${VAULT}/Novels/Drafts" ]] || fail "no draft folder may be created"
[[ ! -d "${STATE}/published" ]] || [[ -z "$(ls -A "${STATE}/published")" ]] || fail "nothing may be published"
echo "   ${ID} re-groomed in $(( $(date +%s) - START ))s (run ${SECOND})"

echo "== summary (counts only)"
echo "   id=${ID} notes=$(note_count) cards=$(grep -c "\[\[Novels/${ID}|" "${BOARD}") runs=$(run_count "${ID}") lane=$(lane_of "${ID}")"
echo "   run history: $(section "${ID}" "Run History" | grep -c '^- ') entries; reference context: $(section "${ID}" "Reference Context" | grep -c '^- ') lines"
grep -F "finished: action=groom" "${VAULT}/Novels/${ID}.md" | sed -E 's/^- [^ ]+ //' | cut -c1-200
echo "PASS: same id re-groomed twice with the real model; live vault untouched (temporary vault ${VAULT})"
