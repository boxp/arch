#!/usr/bin/env bash
set -euo pipefail

# Tests for localllm_source_check.bb (BOXP-287): the metadata-only check that a
# `docs-mode: create` run read the intended real setting folder and nothing
# from the synthetic fixtures. Audits here are synthetic.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CHECK="${ROOT_DIR}/docker/codex-workspace/task-board/localllm_source_check.bb"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

fail() { echo "error: $*" >&2; exit 1; }

write_audit() {  # $1 file, $2 status, $3 read-paths edn vector, $4 sources edn vector, [$5 mode]
  cat >"$1" <<EDN
{:ticket-id "BOXP-0" :run-id "run-1" :status $2 :mode "${5:-create}" :docs-kind "monster"
 :docs-sources ["World"] :sources $4
 :summary "SECRET-SUMMARY-MUST-NOT-PRINT"
 :create {:path "Projects/task-board-localllm-docs/proposals/monsters/x.md"}
 :research {:read-paths $3 :corpus-notes 28 :corpus-chars 1000 :corpus-excluded 0
            :corpus-redacted-lines 0 :rounds 3 :searches 1 :lists 0 :reads 4 :stop :finished
            :search-hit-paths ["Projects/task-board-localllm-docs/refs/setting/world/x.md" "World/a.md"]
            :evidence-keys ["World/a.md## SECRET-HEADING"]}}
EDN
}

# 1. PASS: all reads / sources inside the allowed folder, required notes read.
write_audit "${TMP}/ok.edn" ':review' '["World/rules/monsters.md" "World/chars/a.md" "World/chars/b.md"]' '["World/rules/monsters.md" "World/chars/a.md"]'
out="$(bb "${CHECK}" "${TMP}/ok.edn" --allow World --require "World/rules/monsters,World/chars/a.md")" || fail "expected PASS exit, got $?: ${out}"
grep -q "RESULT: PASS" <<<"${out}" || fail "expected RESULT: PASS: ${out}"
grep -q "SECRET" <<<"${out}" && fail "check printed summary / heading text"
grep -q "created: Projects/task-board-localllm-docs/proposals/monsters/x.md" <<<"${out}" || fail "expected created path: ${out}"
echo "PASS: clean audit passes and prints no text fields"

# 2. FAIL: a cited source comes from the synthetic fixture (default forbid list)
#    even though it is also under an over-wide allow prefix.
write_audit "${TMP}/fixture.edn" ':review' '["World/rules/monsters.md" "Projects/task-board-localllm-docs/refs/setting/world/x.md"]' '["Projects/task-board-localllm-docs/refs/setting/world/x.md"]'
set +e; out="$(bb "${CHECK}" "${TMP}/fixture.edn" --allow "World,Projects/task-board-localllm-docs")"; rc=$?; set -e
[[ "${rc}" -eq 1 ]] || fail "expected exit 1 for fixture source, got ${rc}: ${out}"
grep -q "FAIL reads-not-forbidden" <<<"${out}" || fail "expected forbidden read failure: ${out}"
grep -q "FAIL sources-allowed" <<<"${out}" || fail "expected forbidden source failure: ${out}"
echo "PASS: synthetic fixture read / source is rejected"

# 3. FAIL: required rules note only appears in search hits, not in read-paths.
write_audit "${TMP}/unread.edn" ':review' '["World/chars/a.md"]' '["World/chars/a.md"]'
set +e; out="$(bb "${CHECK}" "${TMP}/unread.edn" --allow World --require World/rules/monsters.md)"; rc=$?; set -e
[[ "${rc}" -eq 1 ]] || fail "expected exit 1 for unread required note, got ${rc}: ${out}"
grep -q 'FAIL required-read: required=1 missing=1 \["World/rules/monsters.md"\]' <<<"${out}" || fail "expected missing required note: ${out}"
echo "PASS: required note that was only searched, not read, fails"

# 4. FAIL: cited source outside the allowed folder / not read; status not review.
write_audit "${TMP}/outside.edn" ':blocked' '["World/chars/a.md"]' '["Novels/draft.md"]'
set +e; out="$(bb "${CHECK}" "${TMP}/outside.edn" --allow World)"; rc=$?; set -e
[[ "${rc}" -eq 1 ]] || fail "expected exit 1, got ${rc}: ${out}"
grep -q "FAIL status-review" <<<"${out}" || fail "expected status failure: ${out}"
grep -q "FAIL sources-allowed: outside-allow=1" <<<"${out}" || fail "expected outside source failure: ${out}"
grep -q "FAIL sources-were-read: cited-but-unread=1" <<<"${out}" || fail "expected unread source failure: ${out}"
echo "PASS: source outside the allowed folder and non-review status fail"

# 4b. FAIL: a propose / transcribe audit never passes the create check.
write_audit "${TMP}/propose.edn" ':review' '["World/chars/a.md"]' '["World/chars/a.md"]' propose
set +e; out="$(bb "${CHECK}" "${TMP}/propose.edn" --allow World)"; rc=$?; set -e
[[ "${rc}" -eq 1 ]] || fail "expected exit 1 for non-create mode, got ${rc}: ${out}"
grep -q 'FAIL mode-create: mode="propose"' <<<"${out}" || fail "expected mode failure: ${out}"
echo "PASS: non-create audit fails"

# 5. JSON output carries the same verdict and no text fields; usage errors exit 2.
out="$(bb "${CHECK}" "${TMP}/ok.edn" --allow World --json)"
grep -q '"pass?":true' <<<"${out}" || fail "expected json pass: ${out}"
grep -q "SECRET" <<<"${out}" && fail "json printed text fields"
set +e; bb "${CHECK}" --allow World >/dev/null 2>&1; rc=$?; set -e
[[ "${rc}" -eq 2 ]] || fail "expected usage exit 2, got ${rc}"
set +e; bb "${CHECK}" "${TMP}/missing.edn" --allow World >/dev/null 2>&1; rc=$?; set -e
[[ "${rc}" -eq 2 ]] || fail "expected exit 2 for unreadable audit, got ${rc}"
echo "PASS: json output and usage errors"

echo "all localllm_source_check tests passed"
