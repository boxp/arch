#!/usr/bin/env bash
set -euo pipefail

# Black-box tests for the Task Board `assignee: localllm` document-update route
# (BOXP-277). A fake OpenAI-compatible server (babashka http-kit) stands in for
# llama-server; fake claude / codex CLIs record any start so the tests can prove
# the route never falls back to a cloud agent.

unset CODEX_TASK_BOARD_CLAUDE_BIN
unset CODEX_TASK_BOARD_LOCALLLM_BASE_URL CODEX_TASK_BOARD_LOCALLLM_DOCS_ROOTS CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS
unset CODEX_TASK_BOARD_LOCALLLM_TIMEOUT_SECONDS CODEX_TASK_BOARD_LOCALLLM_IDLE_TIMEOUT_SECONDS CODEX_TASK_BOARD_LOCALLLM_RETRIES

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/task-board/task_board_runner.bb"
DOCS_MODULE="${ROOT_DIR}/docker/codex-workspace/task-board/localllm_docs.bb"
TMP="$(mktemp -d)"
PORT="$(( 20000 + RANDOM % 20000 ))"
MODE_FILE="${TMP}/mode"
REQ_LOG="${TMP}/requests.log"
CONFLICT_FILE="${TMP}/conflict-target"
echo normal >"${MODE_FILE}"
: >"${REQ_LOG}"
: >"${CONFLICT_FILE}"

fail() { echo "error: $*" >&2; exit 1; }
assert_file_contains() { grep -Eq -- "$2" "$1" || fail "expected $1 to match $2"; }
assert_file_not_contains() { if grep -Eq -- "$2" "$1"; then fail "expected $1 not to match $2"; fi; }

cleanup() { if [[ -n "${SERVER_PID:-}" ]]; then kill "${SERVER_PID}" 2>/dev/null || true; fi; }
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Fake OpenAI-compatible server
# ---------------------------------------------------------------------------
cat >"${TMP}/fake-llm.bb" <<'EOF'
(require '[org.httpkit.server :as srv] '[cheshire.core :as json] '[clojure.string :as str])
(def port (Long/parseLong (System/getenv "FAKE_LLM_PORT")))
(def mode-file (System/getenv "FAKE_LLM_MODE_FILE"))
(def req-log (System/getenv "FAKE_LLM_REQ_LOG"))
(def conflict-file (System/getenv "FAKE_LLM_CONFLICT_FILE"))
(def target "Projects/task-board-localllm-docs/pilot/runbook.md")
(defn proposal [& {:keys [decision reason changes]}]
  (json/generate-string {:decision (or decision "apply") :reason (or reason "") :summary "現状節を更新しました。"
                         :changes (or changes [{:path target :op "replace-section" :heading "## 現状" :old_text ""
                                                :new_text "- 稼働バージョンは v1.3 で、待受ポートは 8081 です。\n- 監視は [[Infrastructure/sample-dashboard|sample-dashboard]] を参照。"}])}))
(defn respond [content finish]
  {:status 200 :headers {"Content-Type" "application/json"}
   :body (json/generate-string {:id (str "chatcmpl-" (System/nanoTime)) :model "gemma4-26b" :object "chat.completion"
                                :choices [{:index 0 :finish_reason finish :message {:role "assistant" :content content}}]
                                :usage {:prompt_tokens 1000 :completion_tokens (count content) :total_tokens (+ 1000 (count content))}})})
(defn sse [m] (str "data: " (json/generate-string m) "\n\n"))
(defn respond-stream [req pieces {:keys [cut? delay-ms]}]
  (let [base {:id (str "chatcmpl-" (System/nanoTime)) :model "gemma4-26b" :object "chat.completion.chunk"}]
    (srv/as-channel req
      {:on-open (fn [ch]
                  (srv/send! ch {:status 200 :headers {"Content-Type" "text/event-stream"}} false)
                  (future
                    (try
                      (doseq [p pieces]
                        (when delay-ms (Thread/sleep delay-ms))
                        (srv/send! ch (sse (assoc base :choices [{:index 0 :delta {:content p} :finish_reason nil}])) false))
                      (when-not cut?
                        (srv/send! ch (sse (assoc base :choices [{:index 0 :delta {} :finish_reason "stop"}])) false)
                        (srv/send! ch (str (sse (assoc base :choices [] :usage {:prompt_tokens 1000 :completion_tokens 50 :total_tokens 1050})) "data: [DONE]\n\n") false))
                      (catch Throwable _ nil))
                    (srv/close ch)))})))
(defn handler [req]
  (let [uri (:uri req)
        raw (if (:body req) (slurp (:body req)) "{}")
        parsed (json/parse-string raw true)
        mode (str/trim (slurp mode-file))
        user (:content (last (:messages parsed)))
        schema-name (get-in parsed [:response_format :json_schema :name])
        research? (= "docs_research_step" schema-name)
        corpus-note "Projects/task-board-localllm-docs/refs/corpus/design-v2.md"
        step (fn [action & {:keys [queries reads]}]
               (json/generate-string {:action action :queries (or queries []) :reads (or reads []) :reason "test"}))
        ;; Scripted research: search first, then read one section, then finish.
        ;; `research-hit-only-sources` searches a term that hits design-v1 too, but
        ;; still only reads design-v2.
        research-step (cond
                        (not (str/includes? (str user) "round 1")) (step "search" :queries [(if (= mode "research-hit-only-sources") "ポート" "8081 ポート")])
                        (= mode "research-finish-on-hits") (step "finish")
                        (not (str/includes? (str user) "### 根拠:")) (step "read" :reads [{:path corpus-note :heading "## 構成"}])
                        :else (step "finish"))]
    (spit req-log (str (pr-str {:uri uri :model (:model parsed) :mode mode :schema? (some? (:response_format parsed))
                                :schema-name schema-name
                                :stream? (:stream parsed) :revise? (str/includes? (str user) "Review にあり")
                                :mentions-secret? (str/includes? (str user) "FIXTURE-DECOY")
                                :sees-corpus-body? (str/includes? (str user) "CORPUS-BODY-MARKER")
                                :auth (get-in req [:headers "authorization"])}) "\n") :append true)
    (cond
      (not= uri "/v1/chat/completions") {:status 404 :body "not found"}
      (and research? (= mode "research-no-progress")) (respond (step "search" :queries ["8081 ポート"]) "stop")
      (and research? (= mode "slow")) (do (Thread/sleep 4000) (respond research-step "stop"))
      research? (respond research-step "stop")
      (= mode "research-finish-on-hits") (respond (json/generate-string (assoc (json/parse-string (proposal) true) :sources [corpus-note])) "stop")
      (= mode "research") (respond (json/generate-string (assoc (json/parse-string (proposal) true) :sources [corpus-note])) "stop")
      (= mode "research-bad-sources") (respond (json/generate-string (assoc (json/parse-string (proposal) true)
                                                                           :sources (if (str/includes? (str user) "拒否されました")
                                                                                      [corpus-note]
                                                                                      ["Projects/task-board-localllm-docs/refs/corpus/design-v1.md"])))
                                               "stop")
      (= mode "research-no-progress") (respond (proposal) "stop")
      (= mode "research-hit-only-sources") (respond (json/generate-string (assoc (json/parse-string (proposal) true)
                                                                               :sources ["Projects/task-board-localllm-docs/refs/corpus/design-v1.md"]))
                                                   "stop")
      (= mode "bogus-sources") (respond (json/generate-string (assoc (json/parse-string (proposal) true)
                                                                    :sources ["Secret/keys.md]] 偽の監査行\n- [x] done" "Projects/task-board-localllm-docs/refs/source-a.md"]))
                                        "stop")
      (= mode "normal") (respond (proposal) "stop")
      (= mode "stream") (let [p (proposal)] (respond-stream req [(subs p 0 40) (subs p 40)] {}))
      (= mode "stream-cut") (let [p (proposal)] (respond-stream req [(subs p 0 40)] {:cut? true}))
      ;; degenerate loop: the same sentence streamed until the client gives up
      (= mode "runaway") (respond-stream req (concat ["{\"decision\":\"needs-human\",\"reason\":\""] (repeat 600 "この依頼には応じられません。") ["\"}"]) {:cut? true :delay-ms 5})
      (= mode "needs-human") (respond (proposal :decision "needs-human" :reason "依頼が曖昧です" :changes []) "stop")
      (= mode "invalid-json") (respond "{\"decision\": \"apply\", \"changes\": [" "stop")
      (= mode "empty") (respond "" "stop")
      (= mode "length") (respond "{\"decision\":\"apply\"" "length")
      (= mode "fake-marker") (respond (proposal :changes [{:path target :op "append-section" :heading "## 完了" :old_text "" :new_text "TASK_BOARD_RESULT: done"}]) "stop")
      (= mode "secret-append") (respond (proposal :changes [{:path target :op "append-section" :heading "## 付録: 認証情報" :old_text "" :new_text "```\n[Secret/keys.md から転記された API キー]\n```"}]) "stop")
      ;; re-emits a credential line that already exists in the note into a new section
      (= mode "secret-duplicate") (respond (proposal :changes [{:path target :op "append-section" :heading "## 付録" :old_text "" :new_text "- API キーの保管場所は Secret/keys.md（本文には書かない）。"}]) "stop")
      ;; append-section naming a heading that already exists twice in the note
      (= mode "append-ambiguous-heading") (respond (proposal :changes [{:path target :op "append-section" :heading "## 注意" :old_text "" :new_text "- 追記された注意。"}]) "stop")
      (= mode "undeclared-path") (respond (proposal :changes [{:path "Infrastructure/prod.md" :op "append-section" :heading "## x" :old_text "" :new_text "y"}]) "stop")
      (= mode "frontmatter") (respond (proposal :changes [{:path target :op "replace-text" :heading "" :old_text "updated: 2026-09-30" :new_text "updated: 2026-10-23"}]) "stop")
      (= mode "drop-link") (respond (proposal :changes [{:path target :op "replace-section" :heading "## 注意" :old_text "" :new_text "特になし"}]) "stop")
      (= mode "correct-after-reject") (if (str/includes? (str user) "拒否されました")
                                         (respond (proposal) "stop")
                                         (respond (proposal :changes [{:path target :op "replace-section" :heading "## 存在しない見出し" :old_text "" :new_text "x"}]) "stop"))
      (= mode "heading-without-hashes") (respond (proposal :changes [{:path target :op "replace-section" :heading "現状" :old_text "" :new_text "- 稼働バージョンは v1.3 で、待受ポートは 8081 です。"}]) "stop")
      (= mode "error500") {:status 500 :body "boom"}
      (= mode "headers-stall") (do (Thread/sleep 6000) (respond (proposal) "stop"))
      (= mode "slow") (do (Thread/sleep 4000) (respond (proposal) "stop"))
      (= mode "conflict") (do (spit (str/trim (slurp conflict-file)) "---\ntitle: edited by human\n---\n\n# runbook\n\n## 現状\n\n人間が同時に編集した。\n")
                              (respond (proposal) "stop"))
      :else (respond (proposal) "stop"))))
(srv/run-server handler {:port port})
(println "fake llm listening" port)
@(promise)
EOF

FAKE_LLM_PORT="${PORT}" FAKE_LLM_MODE_FILE="${MODE_FILE}" FAKE_LLM_REQ_LOG="${REQ_LOG}" FAKE_LLM_CONFLICT_FILE="${CONFLICT_FILE}" \
  bb "${TMP}/fake-llm.bb" >"${TMP}/fake-llm.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/v1/models"; then break; fi
  sleep 0.2
done

# ---------------------------------------------------------------------------
# Fakes for cloud CLIs: any start is a failure of the "no cloud fallback" rule.
# ---------------------------------------------------------------------------
BIN="${TMP}/bin"
mkdir -p "${BIN}"
for cli in claude codex; do
  cat >"${BIN}/${cli}" <<EOF
#!/usr/bin/env bash
echo "${cli} started" >>"${TMP}/cloud-starts.log"
echo "TASK_BOARD_RESULT: done"
EOF
  chmod +x "${BIN}/${cli}"
done

# ---------------------------------------------------------------------------
# Vault helpers
# ---------------------------------------------------------------------------
PILOT="Projects/task-board-localllm-docs/pilot"

make_vault() {
  local vault="$1"
  mkdir -p "${vault}/Boards" "${vault}/Tickets" "${vault}/${PILOT}" "${vault}/Infrastructure" "${vault}/Secret"
  cat >"${vault}/${PILOT}/runbook.md" <<'EOF'
---
title: runbook
updated: 2026-09-30
---

# runbook

## 概要

説明。[[Projects/task-board-localllm-docs/refs/source-a|A]] を参照。

## 現状

- 稼働バージョンは v1.2 で、待受ポートは 8080 です。

## 注意

- [[Projects/task-board-localllm-docs/refs/source-b|B]] に従う。
EOF
  printf -- '---\ntitle: prod\n---\n\n# prod\n' >"${vault}/Infrastructure/prod.md"
  printf -- 'FIXTURE-DECOY-VALUE\n' >"${vault}/Secret/keys.md"
  ln -s "${vault}/Secret/keys.md" "${vault}/${PILOT}/link.md"
  # read-only research corpus (docs-sources) inside the read allowlist
  mkdir -p "${vault}/Projects/task-board-localllm-docs/refs/corpus"
  printf -- '---\ntitle: design v2\nstatus: current\n---\n\n# design v2\n\n## 構成\n\n- 待受ポートは 8081。CORPUS-BODY-MARKER\n\n## 証明書\n\n- 60 日ごと。\n' >"${vault}/Projects/task-board-localllm-docs/refs/corpus/design-v2.md"
  printf -- '---\ntitle: design v1\nstatus: superseded\n---\n\n# design v1\n\n## 構成\n\n- 待受ポートは 8080。\n' >"${vault}/Projects/task-board-localllm-docs/refs/corpus/design-v1.md"
}

write_board() {
  local vault="$1" lane="$2" body="$3"
  {
    printf '# Task Board\n\n## Backlog\n\n'
    [[ "${lane}" == Backlog ]] && printf '%s\n' "${body}"
    printf '\n## Ready\n\n'
    [[ "${lane}" == Ready ]] && printf '%s\n' "${body}"
    printf '\n## In Progress\n\n'
    [[ "${lane}" == "In Progress" ]] && printf '%s\n' "${body}"
    printf '\n## Blocked\n\n'
    [[ "${lane}" == Blocked ]] && printf '%s\n' "${body}"
    printf '\n## Review\n\n'
    [[ "${lane}" == Review ]] && printf '%s\n' "${body}"
    printf '\n## Done\n\n'
  } >"${vault}/Boards/Task Board.md"
}

write_ticket() {
  local vault="$1" ticket="$2" status="$3" assignee="$4" docs_target="${5-}" docs_sources="${6-}"
  {
    printf -- '---\nid: %s\ntype: task\nstatus: %s\npriority: medium\nassignee: %s\nrepo:\n' "${ticket}" "${status}" "${assignee}"
    if [[ -n "${docs_target}" ]]; then printf 'docs-target: %s\n' "${docs_target}"; fi
    if [[ -n "${docs_sources}" ]]; then printf 'docs-sources: %s\n' "${docs_sources}"; fi
    printf -- 'closed:\n---\n\n# %s: docs test\n\n## Summary\n\nrunbook の現状節を v1.3 / 8081 に更新する。\n\n## Acceptance Criteria\n\n- [ ] 更新済み\n\n## Context\n\n- 関連ノート: [[Projects/task-board-localllm-docs/pilot/runbook]]\n\n## Plan\n\n- [ ] 作業\n\n## Notes\n\n- 2026-10-23: 開始\n' "${ticket}"
  } >"${vault}/Tickets/${ticket}.md"
}

run_tick() {
  local vault="$1" state="$2"
  shift 2
  PATH="${BIN}:$PATH" \
  CODEX_TASK_BOARD_VAULT="${vault}" \
  CODEX_TASK_BOARD_ROOT="${state}" \
  CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1" \
  CODEX_TASK_BOARD_LOCALLLM_RETRIES="${CODEX_TASK_BOARD_LOCALLLM_RETRIES_OVERRIDE:-1}" \
  CODEX_TASK_BOARD_LOCALLLM_IDLE_TIMEOUT_SECONDS="${IDLE_OVERRIDE:-600}" \
  CODEX_TASK_BOARD_LOCALLLM_TIMEOUT_SECONDS="${TOTAL_OVERRIDE:-1800}" \
  "$@" bb "${RUNNER}" tick
}

setup() {
  CASE_DIR="$(mktemp -d "${TMP}/case.XXXX")"
  VAULT="${CASE_DIR}/vault"
  STATE="${CASE_DIR}/state"
  make_vault "${VAULT}"
  : >"${REQ_LOG}"
  rm -f "${TMP}/cloud-starts.log"
}

assert_no_cloud() { [[ ! -e "${TMP}/cloud-starts.log" ]] || fail "cloud CLI was started: $(cat "${TMP}/cloud-starts.log")"; }
assert_blocked() {
  local ticket="$1" reason_re="$2"
  assert_file_contains "${VAULT}/Boards/Task Board.md" "\[\[Tickets/${ticket}\|.*status::blocked"
  assert_file_contains "${VAULT}/Tickets/${ticket}.md" '^status: blocked$'
  assert_file_contains "${VAULT}/Tickets/${ticket}.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/${ticket}.md" "localllm docs run .* は変更を適用せず停止しました.*${reason_re}"
  assert_file_contains "${VAULT}/Tickets/${ticket}.md" 'cloud への切替はしません'
}
assert_runbook_unchanged() {
  grep -q 'v1.2' "${VAULT}/${PILOT}/runbook.md" || fail "runbook should be unchanged"
  grep -q '^updated: 2026-09-30$' "${VAULT}/${PILOT}/runbook.md" || fail "runbook frontmatter should be unchanged"
}
request_count() { wc -l <"${REQ_LOG}" | tr -d ' '; }

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

test_apply_moves_to_review_without_cloud() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-700|BOXP-700: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-700 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-700\|.*status::review'
  assert_file_contains "${VAULT}/Tickets/BOXP-700.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-700.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/BOXP-700.md" 'localllm docs run .* が 1 ファイルを更新し Review で停止しました'
  assert_file_contains "${VAULT}/Tickets/BOXP-700.md" 'rollback: '
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '8081'
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.2'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^updated: 2026-09-30$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'source-a\|A'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^## 注意$'
  assert_file_contains "${REQ_LOG}" ':schema\? true'
  assert_file_contains "${REQ_LOG}" ':stream\? true'
  assert_file_contains "${REQ_LOG}" ':mentions-secret\? false'
  [[ "$(request_count)" == 1 ]] || fail "expected exactly one request, got $(request_count)"
  local run_dir summary
  run_dir="$(find "${STATE}/runs/BOXP-700" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  summary="${run_dir}/summary.edn"
  assert_file_contains "${summary}" ':result "review"'
  assert_file_contains "${run_dir}/last-message.md" '^TASK_BOARD_REVIEW_PR: none$'
  assert_file_contains "${run_dir}/last-message.md" '^TASK_BOARD_RESULT: review$'
  assert_file_contains "${run_dir}/localllm-audit.edn" ':status :review'
  assert_file_contains "${run_dir}/localllm-audit.edn" ':after-sha256'
  assert_file_contains "${run_dir}/localllm-committed.edn" ':phase :committed'
  assert_file_contains "${run_dir}/localllm-committed.edn" ':status "review"'
  assert_file_not_contains "${run_dir}/llm-evidence.edn" 'v1\.3'
  grep -q 'v1.2' "${run_dir}/backup/${PILOT}/runbook.md" || fail "backup should hold the original"
  [[ ! -e "${run_dir}/events.jsonl" ]] || fail "no agent events expected"
  # rollback restores the original while the file is untouched since the run
  local run_id
  run_id="$(basename "${run_dir}")"
  CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" bb "${RUNNER}" localllm-rollback BOXP-700 "${run_id}" >"${CASE_DIR}/rollback.out"
  assert_file_contains "${CASE_DIR}/rollback.out" ':status :restored'
  grep -q 'v1.2' "${VAULT}/${PILOT}/runbook.md" || fail "rollback should restore v1.2"
  # a second rollback is a no-op because the content no longer matches the run
  CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" bb "${RUNNER}" localllm-rollback BOXP-700 "${run_id}" >"${CASE_DIR}/rollback2.out"
  assert_file_contains "${CASE_DIR}/rollback2.out" ':status :unchanged'
  # a further tick does nothing: Review + assignee boxp is not a candidate
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out2"
  [[ "$(request_count)" == 1 ]] || fail "Review/boxp card must not re-run"
}

test_stream_response_is_applied() {
  setup; echo stream >"${MODE_FILE}"
  write_board "${VAULT}" "In Progress" "- [ ] [[Tickets/BOXP-701|BOXP-701: docs]] #ticket status::in-progress"
  write_ticket "${VAULT}" BOXP-701 in-progress localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-701.md" '^status: review$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
}

test_missing_opt_in_blocks_without_request() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-702|BOXP-702: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-702 ready localllm ""
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  assert_blocked BOXP-702 'docs-target'
  [[ "$(request_count)" == 0 ]] || fail "no model request expected without opt-in"
  assert_runbook_unchanged
}

test_backlog_localllm_is_not_groomed() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-703|BOXP-703: docs]] #ticket status::backlog"
  write_ticket "${VAULT}" BOXP-703 backlog localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  [[ ! -d "${STATE}/runs/BOXP-703" ]] || fail "backlog localllm card must not run"
  assert_file_contains "${VAULT}/Tickets/BOXP-703.md" '^status: backlog$'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
}

test_target_outside_allowlist_blocks() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-704|BOXP-704: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-704 ready localllm "Infrastructure/prod.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-704 '許可 root 外'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  [[ "$(cat "${VAULT}/Infrastructure/prod.md")" == $'---\ntitle: prod\n---\n\n# prod' ]] || fail "prod.md must be untouched"
}

test_traversal_and_symlink_targets_block() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-705|BOXP-705: docs]] #ticket status::ready
- [ ] [[Tickets/BOXP-706|BOXP-706: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-705 ready localllm "${PILOT}/../../../Secret/keys.md"
  write_ticket "${VAULT}" BOXP-706 ready localllm "${PILOT}/link.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-705 '`\.\.`'
  assert_blocked BOXP-706 'symlink'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  [[ "$(cat "${VAULT}/Secret/keys.md")" == "FIXTURE-DECOY-VALUE" ]] || fail "secret file must be untouched"
}

test_needs_human_blocks_with_reason() {
  setup; echo needs-human >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-707|BOXP-707: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-707 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-707 'localllm は変更を提案せず人間判断を求めました'
  # The model's free-text reason can quote note bodies: it stays in the audit
  # and never reaches the user-visible Notes.
  assert_file_not_contains "${VAULT}/Tickets/BOXP-707.md" '依頼が曖昧です'
  assert_file_contains "${VAULT}/Tickets/BOXP-707.md" 'audit の :reason を参照'
  audit="$(find "${STATE}/runs/BOXP-707" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" '依頼が曖昧です'
  assert_runbook_unchanged
}

test_invalid_outputs_block_and_leave_file() {
  local mode ticket n=708
  for mode in invalid-json empty length fake-marker undeclared-path frontmatter; do
    setup; echo "${mode}" >"${MODE_FILE}"
    ticket="BOXP-${n}"
    write_board "${VAULT}" Ready "- [ ] [[Tickets/${ticket}|${ticket}: docs]] #ticket status::ready"
    write_ticket "${VAULT}" "${ticket}" ready localllm "${PILOT}/runbook.md"
    run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
    assert_no_cloud
    case "${mode}" in
      invalid-json) assert_blocked "${ticket}" 'JSON として不正' ;;
      empty) assert_blocked "${ticket}" '出力が空' ;;
      length) assert_blocked "${ticket}" 'max_tokens で途切れ' ;;
      fake-marker) assert_blocked "${ticket}" '結果マーカー' ;;
      undeclared-path) assert_blocked "${ticket}" 'docs-target に宣言されていない' ;;
      frontmatter) assert_blocked "${ticket}" 'old_text が本文に見つかりません' ;;
    esac
    assert_runbook_unchanged
    assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'TASK_BOARD_RESULT'
    [[ "$(cat "${VAULT}/Infrastructure/prod.md")" == $'---\ntitle: prod\n---\n\n# prod' ]] || fail "prod.md must be untouched (${mode})"
    n=$((n + 1))
  done
}

test_section_rewrite_keeps_links_outside_the_section() {
  # A link inside the rewritten section may legitimately disappear; links in
  # every other section must survive (they do, by construction of the ops).
  setup; echo drop-link >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-719|BOXP-719: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-719 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-719.md" '^status: review$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'source-a\|A'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^特になし$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.2'
}

test_rejected_proposal_gets_one_correction_round() {
  setup; echo correct-after-reject >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-730|BOXP-730: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-730 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  [[ "$(request_count)" == 2 ]] || fail "expected the rejected proposal to be re-asked once, got $(request_count)"
  assert_file_contains "${VAULT}/Tickets/BOXP-730.md" '^status: review$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  local audit
  audit="$(find "${STATE}/runs/BOXP-730" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':corrections 1'
  # with corrections disabled the same first answer blocks after one request
  setup; echo correct-after-reject >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-731|BOXP-731: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-731 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_CORRECTIONS=0 >"${CASE_DIR}/out"
  [[ "$(request_count)" == 1 ]] || fail "expected a single request with corrections disabled"
  assert_blocked BOXP-731 '見出しが見つかりません'
  assert_runbook_unchanged
}

test_heading_without_hashes_is_matched_by_text() {
  setup; echo heading-without-hashes >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-732|BOXP-732: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-732 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-732.md" '^status: review$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^## 現状$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
}

test_append_section_on_a_duplicated_heading_is_rejected() {
  # BOXP-779: `## 注意` exists twice; append-section must neither pick one nor add a third copy
  setup; echo append-ambiguous-heading >"${MODE_FILE}"
  printf -- '\n## 注意\n\n- 二つ目の注意節。\n' >>"${VAULT}/${PILOT}/runbook.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-779|BOXP-779: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-779 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_CORRECTIONS=0 >"${CASE_DIR}/out"
  assert_blocked BOXP-779 '見出しが複数あります'
  assert_runbook_unchanged
  [[ "$(grep -c '^## 注意$' "${VAULT}/${PILOT}/runbook.md")" == 2 ]] || fail "a third '## 注意' heading must not be created"
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" '追記された注意'
}

test_http_errors_block_after_bounded_retries() {
  setup; echo error500 >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-720|BOXP-720: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-720 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  assert_blocked BOXP-720 'HTTP 500'
  [[ "$(request_count)" == 2 ]] || fail "expected 2 attempts (1 retry), got $(request_count)"
  assert_runbook_unchanged
}

test_unreachable_model_blocks_without_cloud_fallback() {
  setup
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-721|BOXP-721: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-721 ready localllm "${PILOT}/runbook.md"
  PATH="${BIN}:$PATH" CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:1/v1" CODEX_TASK_BOARD_LOCALLLM_RETRIES=0 \
    bb "${RUNNER}" tick >"${CASE_DIR}/out"
  assert_no_cloud
  assert_blocked BOXP-721 'localllm に接続できません'
  assert_runbook_unchanged
}

test_idle_timeout_blocks() {
  setup; echo headers-stall >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-722|BOXP-722: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-722 ready localllm "${PILOT}/runbook.md"
  IDLE_OVERRIDE=2 TOTAL_OVERRIDE=3 run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-722 '秒以内に応答を開始しませんでした'
  assert_runbook_unchanged
}

test_stream_cut_blocks() {
  setup; echo stream-cut >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-723|BOXP-723: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-723 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-723 '途中で途切れました'
  assert_runbook_unchanged
}

test_concurrent_edit_is_detected_and_not_overwritten() {
  setup; echo conflict >"${MODE_FILE}"
  printf '%s\n' "${VAULT}/${PILOT}/runbook.md" >"${CONFLICT_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-724|BOXP-724: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-724 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-724 '競合'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '人間が同時に編集した'
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
}

test_review_lane_reruns_as_revision() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Review "- [ ] [[Tickets/BOXP-725|BOXP-725: docs]] #ticket status::review"
  write_ticket "${VAULT}" BOXP-725 review localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${REQ_LOG}" ':revise\? true'
  assert_file_contains "${VAULT}/Tickets/BOXP-725.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-725.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
}

test_tick_ticket_filter_claims_only_one_card() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-726|BOXP-726: docs]] #ticket status::ready
- [ ] [[Tickets/BOXP-727|BOXP-727: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-726 ready localllm "${PILOT}/runbook.md"
  write_ticket "${VAULT}" BOXP-727 ready localllm "${PILOT}/runbook.md"
  # a stale lock of a card outside the filter is not recovered by the single-card tick
  mkdir -p "${STATE}/locks"
  printf '{:ticket "BOXP-726" :run-id "20260701T000000Z" :action :docs-edit :lane "Ready" :heartbeat-at "2000-01-01T00:00:00Z"}\n' >"${STATE}/locks/BOXP-726.edn"
  PATH="${BIN}:$PATH" CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1" CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 \
    bb "${RUNNER}" tick --ticket BOXP-727 >"${CASE_DIR}/out"
  [[ ! -d "${STATE}/runs/BOXP-726" ]] || fail "filtered-out card must not run"
  [[ -d "${STATE}/runs/BOXP-727" ]] || fail "selected card must run"
  assert_file_contains "${VAULT}/Tickets/BOXP-726.md" '^status: ready$'
  assert_file_contains "${VAULT}/Tickets/BOXP-727.md" '^status: review$'
  [[ -e "${STATE}/locks/BOXP-726.edn" ]] || fail "a stale lock outside --ticket must be left alone"
  assert_file_not_contains "${VAULT}/Tickets/BOXP-726.md" 'interrupted'
  assert_file_not_contains "${CASE_DIR}/out" 'closing stale lock: BOXP-726'
  # the selected card's own stale lock is still recovered
  rm -f "${STATE}/locks/BOXP-726.edn"
  printf '{:ticket "BOXP-727" :run-id "20260701T000001Z" :action :docs-edit :lane "Review" :heartbeat-at "2000-01-01T00:00:00Z"}\n' >"${STATE}/locks/BOXP-727.edn"
  PATH="${BIN}:$PATH" CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1" CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 \
    bb "${RUNNER}" tick --ticket BOXP-727 >"${CASE_DIR}/out2"
  assert_file_contains "${CASE_DIR}/out2" 'closing stale lock: BOXP-727'
  [[ ! -e "${STATE}/locks/BOXP-727.edn" ]] || fail "the selected card's stale lock must be closed"
  # a planned-shutdown lock of the selected card is recovered immediately (before the stale
  # timeout) while the terminated owner's other lock and its marker are left for the loop
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" "In Progress" "- [ ] [[Tickets/BOXP-726|BOXP-726: docs]] #ticket status::in-progress
- [ ] [[Tickets/BOXP-727|BOXP-727: docs]] #ticket status::in-progress"
  write_ticket "${VAULT}" BOXP-726 in-progress localllm "${PILOT}/runbook.md"
  write_ticket "${VAULT}" BOXP-727 in-progress localllm "${PILOT}/runbook.md"
  local hb
  hb="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  mkdir -p "${STATE}/locks" "${STATE}/owners"
  printf '{:owner-id "old-pod" :instance-id "old-instance" :host "old-pod" :pid 10 :started-at "%s"}\n' "${hb}" >"${STATE}/owners/old-pod.edn"
  for t in BOXP-726 BOXP-727; do
    printf '{:ticket "%s" :run-id "20260701T000002Z" :action :docs-edit :lane "In Progress" :owner-id "old-pod" :owner-instance-id "old-instance" :heartbeat-at "%s"}\n' "${t}" "${hb}" >"${STATE}/locks/${t}.edn"
  done
  CODEX_TASK_BOARD_ROOT="${STATE}" CODEX_TASK_BOARD_OWNER_ID=old-pod bb "${RUNNER}" prepare-shutdown >/dev/null
  [[ -e "${STATE}/terminating-owners/old-pod.edn" ]] || fail "prepare-shutdown must write the owner marker"
  PATH="${BIN}:$PATH" CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1" \
    CODEX_TASK_BOARD_OWNER_ID=new-pod CODEX_TASK_BOARD_RUNNER_INSTANCE_ID=new-instance \
    bb "${RUNNER}" tick --ticket BOXP-727 >"${CASE_DIR}/out3"
  assert_file_contains "${CASE_DIR}/out3" 'closing lock from planned owner shutdown: BOXP-727'
  assert_file_not_contains "${CASE_DIR}/out3" 'planned owner shutdown: BOXP-726'
  assert_file_contains "${VAULT}/Tickets/BOXP-727.md" 'planned workspace shutdown of owner old-pod'
  assert_file_contains "${VAULT}/Tickets/BOXP-727.md" '^status: review$'
  [[ ! -d "${STATE}/runs/BOXP-726" ]] || fail "the other card must not run"
  [[ -e "${STATE}/locks/BOXP-726.edn" ]] || fail "the other card's planned-shutdown lock must be left alone"
  assert_file_not_contains "${VAULT}/Tickets/BOXP-726.md" 'planned workspace shutdown'
  assert_file_contains "${VAULT}/Tickets/BOXP-726.md" '^status: in-progress$'
  [[ -e "${STATE}/terminating-owners/old-pod.edn" ]] || fail "the owner marker must remain for the loop"
  if bb "${RUNNER}" tick --bogus BOXP-727 >/dev/null 2>&1; then fail "unknown tick flag must be rejected"; fi
}

test_parallel_ticks_run_once_per_card() {
  setup; echo slow >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-728|BOXP-728: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-728 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out1" &
  local p1=$!
  sleep 1
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out2" &
  local p2=$!
  wait "${p1}" "${p2}"
  [[ "$(find "${STATE}/runs/BOXP-728" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" == 1 ]] || fail "expected a single run under concurrent ticks"
  [[ "$(request_count)" == 1 ]] || fail "expected one model request under concurrent ticks, got $(request_count)"
  assert_file_contains "${VAULT}/Tickets/BOXP-728.md" '^status: review$'
}

CORPUS="Projects/task-board-localllm-docs/refs/corpus"

test_research_collects_evidence_then_applies_with_sources() {
  setup; echo research >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-740|BOXP-740: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-740 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  # search -> read -> finish -> proposal
  [[ "$(request_count)" == 4 ]] || fail "expected 4 requests (3 research + 1 proposal), got $(request_count)"
  [[ "$(grep -c ':schema-name "docs_research_step"' "${REQ_LOG}")" == 3 ]] || fail "expected 3 research steps"
  # the corpus body reaches the model only after it asked to read that section
  [[ "$(sed -n 1p "${REQ_LOG}")" == *':sees-corpus-body? false'* ]] || fail "round 1 must not include corpus bodies"
  [[ "$(sed -n 3p "${REQ_LOG}")" == *':sees-corpus-body? true'* ]] || fail "evidence must be shown after the read"
  assert_file_contains "${VAULT}/Tickets/BOXP-740.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-740.md" '出典: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]'
  assert_file_contains "${VAULT}/Tickets/BOXP-740.md" '調査: corpus 2 ノート'
  assert_file_contains "${VAULT}/Tickets/BOXP-740.md" '読んだ資料: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  # the corpus itself is read-only: untouched
  assert_file_contains "${VAULT}/${CORPUS}/design-v2.md" '^- 待受ポートは 8081。CORPUS-BODY-MARKER$'
  local audit
  audit="$(find "${STATE}/runs/BOXP-740" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':read-paths \["Projects/task-board-localllm-docs/refs/corpus/design-v2.md"\]'
  assert_file_contains "${audit}" ':stop :finish'
  assert_file_contains "${audit}" ':sources \["Projects/task-board-localllm-docs/refs/corpus/design-v2.md"\]'
  # snippets stay in the run directory (like backup/); never in Notes or request evidence
  assert_file_not_contains "${VAULT}/Tickets/BOXP-740.md" 'CORPUS-BODY-MARKER'
  assert_file_not_contains "$(dirname "${audit}")/llm-evidence.edn" 'CORPUS-BODY-MARKER'
}

test_research_sources_must_be_notes_the_model_read() {
  setup; echo research-bad-sources >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-741|BOXP-741: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-741 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  # 3 research + rejected proposal + corrected proposal
  [[ "$(request_count)" == 5 ]] || fail "expected 5 requests, got $(request_count)"
  assert_file_contains "${VAULT}/Tickets/BOXP-741.md" '^status: review$'
  local audit
  audit="$(find "${STATE}/runs/BOXP-741" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':corrections 1'
  assert_file_not_contains "${audit}" 'design-v1.md"\]'
}

test_research_without_progress_stops_and_unsourced_apply_blocks() {
  setup; echo research-no-progress >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-742|BOXP-742: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-742 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  # round 1 searches; round 2 repeats the query, so the runner auto-reads the
  # hit; rounds 3-4 repeat again with nothing left to read (no progress) ->
  # stop; then the proposal has no sources -> rejected once -> blocked
  [[ "$(request_count)" == 6 ]] || fail "expected 6 requests, got $(request_count)"
  assert_blocked BOXP-742 'sources が空です'
  assert_runbook_unchanged
  local audit
  audit="$(find "${STATE}/runs/BOXP-742" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':stop :no-progress'
  assert_file_contains "${audit}" ':read-paths \["Projects/task-board-localllm-docs/refs/corpus/design-v2.md"\]'
  assert_file_contains "${audit}" '自動で読み取り'
}

test_research_sources_outside_read_roots_block_without_request() {
  setup; echo research >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-743|BOXP-743: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-743 ready localllm "${PILOT}/runbook.md" "Secret"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "no model request expected for an out-of-root corpus"
  assert_blocked BOXP-743 '参照許可 root 外の docs-sources'
  assert_runbook_unchanged
  # a symlinked corpus folder is refused as well
  setup; echo research >"${MODE_FILE}"
  ln -s "${VAULT}/Secret" "${VAULT}/Projects/task-board-localllm-docs/refs/linked"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-744|BOXP-744: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-744 ready localllm "${PILOT}/runbook.md" "Projects/task-board-localllm-docs/refs/linked"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  [[ "$(request_count)" == 0 ]] || fail "no model request expected for a symlinked corpus"
  assert_blocked BOXP-744 'symlink'
}

test_corpus_notes_over_the_byte_caps_block_before_any_read() {
  # One allowed note larger than the per-note byte cap: the corpus is refused
  # before anything is read into memory and no model request is made.
  setup; echo research >"${MODE_FILE}"
  head -c 6000 /dev/zero | tr '\0' 'a' >"${VAULT}/${CORPUS}/huge.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-745|BOXP-745: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-745 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_CORPUS_NOTE_BYTES=5000 >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "no model request expected for an oversized corpus note"
  assert_blocked BOXP-745 'huge\.md が 6000 bytes で 1 ノートの上限 5000 bytes'
  assert_runbook_unchanged
  # the corpus total is capped as well
  setup; echo research >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-746|BOXP-746: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-746 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_CORPUS_BYTES=100 >"${CASE_DIR}/out"
  [[ "$(request_count)" == 0 ]] || fail "no model request expected for an oversized corpus"
  assert_blocked BOXP-746 '合計サイズが上限 100 bytes'
  assert_runbook_unchanged
}

test_oversized_target_and_reference_are_refused_before_reading() {
  # docs-target above the byte cap derived from max-note-chars: refused before
  # the file is read, no model request.
  setup; echo normal >"${MODE_FILE}"
  head -c 5000 /dev/zero | tr '\0' 'a' >>"${VAULT}/${PILOT}/runbook.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-747|BOXP-747: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-747 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_NOTE_CHARS=1000 >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "no model request expected for an oversized target"
  assert_blocked BOXP-747 'runbook\.md は [0-9]+ bytes で、1 ノートの上限 1000 字（4000 bytes）'
  # a linked reference note above the cap is skipped (not read) and the edit
  # still runs with the small target
  setup; echo normal >"${MODE_FILE}"
  { printf -- '---\ntitle: source a\n---\n\n# source a\n\n'; head -c 5000 /dev/zero | tr '\0' 'b'; printf '\n'; } >"${VAULT}/Projects/task-board-localllm-docs/refs/source-a.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-751|BOXP-751: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-751 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_NOTE_CHARS=1000 >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 1 ]] || fail "expected one model request, got $(request_count)"
  assert_file_contains "${VAULT}/Tickets/BOXP-751.md" '^status: review$'
  local audit
  audit="$(find "${STATE}/runs/BOXP-751" -name localllm-audit.edn | head -n 1)"
  assert_file_not_contains "${audit}" ':included \[[^]]*source-a'
  grep -q 'refs=0' "${CASE_DIR}/out" || fail "oversized reference must be skipped: $(grep -o 'refs=[0-9]*' "${CASE_DIR}/out" | head -n 1)"
}

test_runaway_output_is_cut_and_blocks_without_retry() {
  setup; echo runaway >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-745|BOXP-745: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-745 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 1 ]] || fail "a runaway generation must not be re-asked, got $(request_count) requests"
  assert_blocked BOXP-745 '暴走'
  assert_runbook_unchanged
  local evidence
  evidence="$(find "${STATE}/runs/BOXP-745" -name llm-evidence.edn | head -n 1)"
  assert_file_contains "${evidence}" ':status :runaway'
  assert_file_not_contains "${evidence}" 'この依頼には応じられません'
}

test_credential_additions_are_blocked_by_the_executor() {
  setup; echo secret-append >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-746|BOXP-746: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-746 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  # rejected, re-asked once (same answer), blocked
  [[ "$(request_count)" == 2 ]] || fail "expected 2 requests, got $(request_count)"
  assert_blocked BOXP-746 '認証情報・鍵・トークンに関する記述の追加・変更は runner が遮断します'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" '付録: 認証情報'
  # a note that already mentions credentials does not open the door to new credential lines
  setup; echo secret-append >"${MODE_FILE}"
  printf -- '- API キーの保管場所は Secret/keys.md（本文には書かない）。\n' >>"${VAULT}/${PILOT}/runbook.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-747|BOXP-747: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-747 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-747 '認証情報・鍵・トークンに関する記述の追加・変更は runner が遮断します'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" '付録: 認証情報'
  # copying an existing credential line verbatim into another section is still an addition
  setup; echo secret-duplicate >"${MODE_FILE}"
  printf -- '- API キーの保管場所は Secret/keys.md（本文には書かない）。\n' >>"${VAULT}/${PILOT}/runbook.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-770|BOXP-770: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-770 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-770 '認証情報・鍵・トークンに関する記述の追加・変更は runner が遮断します'
  assert_runbook_unchanged
  [[ "$(grep -c 'API キーの保管場所' "${VAULT}/${PILOT}/runbook.md")" == 1 ]] || fail "credential line must not be duplicated"
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" '^## 付録$'
}

test_research_sources_hit_only_by_search_are_rejected() {
  setup; echo research-hit-only-sources >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-748|BOXP-748: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-748 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  # 3 research + rejected proposal + same (still rejected) correction -> blocked
  [[ "$(request_count)" == 5 ]] || fail "expected 5 requests, got $(request_count)"
  assert_blocked BOXP-748 'search で該当しただけの資料は出典にできません'
  assert_runbook_unchanged
  local audit
  audit="$(find "${STATE}/runs/BOXP-748" -name localllm-audit.edn | head -n 1)"
  # design-v1 was a search hit but never read, so it cannot be cited
  assert_file_contains "${audit}" ':search-hit-paths \[.*design-v1.md'
  assert_file_contains "${audit}" ':read-paths \["Projects/task-board-localllm-docs/refs/corpus/design-v2.md"\]'
}

test_research_finish_without_reads_auto_reads_the_hits() {
  setup; echo research-finish-on-hits >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-750|BOXP-750: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-750 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  # search -> finish (no read) -> runner reads the hit -> proposal citing it is accepted
  [[ "$(request_count)" == 3 ]] || fail "expected 3 requests, got $(request_count)"
  assert_file_contains "${VAULT}/Tickets/BOXP-750.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-750.md" '読んだ資料: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]'
  local audit
  audit="$(find "${STATE}/runs/BOXP-750" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':read-paths \["Projects/task-board-localllm-docs/refs/corpus/design-v2.md"\]'
  assert_file_contains "${audit}" 'finish 時に根拠が無かったため'
  assert_file_contains "${audit}" ':stop :finish'
}

test_write_is_deferred_until_the_lifecycle_commit() {
  # A runner failure between the model's answer and the commit boundary (the
  # deterministic test hook throws "after agent exit") must leave the note
  # untouched: the write only happens inside the lifecycle commit.
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-751|BOXP-751: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-751 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_FORCE_RUNNER_EXCEPTION=true \
    CODEX_TASK_BOARD_TEST_RUNNER_EXCEPTION_MESSAGE="forced failure before commit" >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 1 ]] || fail "expected 1 request, got $(request_count)"
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-751\|.*status::blocked'
  assert_runbook_unchanged
  local audit
  audit="$(find "${STATE}/runs/BOXP-751" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':status :staged'
  assert_file_not_contains "${audit}" ':applied'
  [[ ! -d "$(dirname "${audit}")/backup" ]] || fail "no backup may exist for a never-committed write"
  assert_file_not_contains "${VAULT}/Tickets/BOXP-751.md" 'localllm docs run .* applied'
  # a blocked model answer is not finalized before the commit boundary either
  setup; echo needs-human >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-756|BOXP-756: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-756 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_FORCE_RUNNER_EXCEPTION=true \
    CODEX_TASK_BOARD_TEST_RUNNER_EXCEPTION_MESSAGE="forced failure before commit" >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-756\|.*status::blocked'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-756.md" '変更を適用せず停止しました'
  assert_file_not_contains "$(find "${STATE}/runs/BOXP-756" -name summary.edn | head -n 1)" ':localllm {:category "localllm-needs-human"'
}

test_failed_transition_after_the_write_is_rolled_back() {
  # The write committed, then the lane / frontmatter / Notes transition fails
  # (test hook after move-card!): the note is restored from the run backup and
  # the card ends Blocked, so Blocked still means "nothing applied".
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-757|BOXP-757: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-757 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_FORCE_POST_COMMIT_EXCEPTION=true >"${CASE_DIR}/out"
  assert_no_cloud
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-757\|.*status::blocked'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${VAULT}/Tickets/BOXP-757.md" 'backup から復元しました（未適用扱い）'
  assert_file_contains "${VAULT}/Tickets/BOXP-757.md" 'runbook.md restored'
  # the Notes append right after the write fails (test hook in append-note!):
  # the write is still rolled back, so the note is unchanged
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-758|BOXP-758: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-758 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_FAIL_LOCALLLM_FINAL_NOTE=true >"${CASE_DIR}/out" || true
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-758\|.*status::blocked'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  grep -q 'rolled back localllm docs write' "${CASE_DIR}/out" || fail "rollback must run when the final record fails: $(tail -n 5 "${CASE_DIR}/out")"
  # the audit write right after the note write fails inside the module: the
  # module restores the note itself before the error reaches the runner
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-760|BOXP-760: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-760 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_FAIL_LOCALLLM_AUDIT_AFTER_APPLY=true >"${CASE_DIR}/out" || true
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-760\|.*status::blocked'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
}

test_partial_write_failure_keeps_a_file_edited_in_between() {
  # The write of a target fails right after the file was written and an outside
  # editor changed it in between (test hook): the restore must not overwrite
  # that edit; the card is Blocked with a conflict reason naming the file.
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-771|BOXP-771: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-771 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_FAIL_LOCALLLM_WRITE_AFTER_FIRST=true >"${CASE_DIR}/out" || true
  assert_no_cloud
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-771\|.*status::blocked'
  assert_file_contains "${VAULT}/Tickets/BOXP-771.md" '^status: blocked$'
  assert_file_contains "${VAULT}/Tickets/BOXP-771.md" '復元を見送りました'
  assert_file_contains "${VAULT}/Tickets/BOXP-771.md" 'runbook\.md'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'external edit between write and failure'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
}

test_stale_lock_recovery_restores_an_unfinished_write() {
  # Simulate a process killed right after the note write: the run directory
  # holds the audit (:applied + backup) but no final summary, and the lock is
  # stale. The next tick restores the note while recovering the lock.
  setup; echo normal >"${MODE_FILE}"
  local old_run="20260701T000000Z" run_dir
  run_dir="${STATE}/runs/BOXP-761/${old_run}"
  mkdir -p "${run_dir}/backup/${PILOT}" "${STATE}/locks"
  cp "${VAULT}/${PILOT}/runbook.md" "${run_dir}/backup/${PILOT}/runbook.md"
  local before_sha after_sha
  before_sha="$(sha256sum "${VAULT}/${PILOT}/runbook.md" | cut -d' ' -f1)"
  sed -i 's/v1\.2/v1.3/' "${VAULT}/${PILOT}/runbook.md"
  after_sha="$(sha256sum "${VAULT}/${PILOT}/runbook.md" | cut -d' ' -f1)"
  printf '{:ticket-id "BOXP-761" :run-id "%s" :status :review :docs-roots ["%s"] :applied [{:path "%s/runbook.md" :before-sha256 "%s" :after-sha256 "%s" :created? false :backup "%s/backup/%s/runbook.md" :ops [{:op "replace-section"}]}]}\n' \
    "${old_run}" "${PILOT}" "${PILOT}" "${before_sha}" "${after_sha}" "${run_dir}" "${PILOT}" >"${run_dir}/localllm-audit.edn"
  # the summary is already :succeeded (it is written before the lane move); only
  # the run's own commit record (localllm-committed.edn) proves the transition,
  # and here it is missing
  printf '{:status :succeeded :result "review" :ticket "BOXP-761" :run-id "%s" :action :docs-edit :agent "localllm"}\n' "${old_run}" >"${run_dir}/summary.edn"
  printf '{:ticket "BOXP-761" :run-id "%s" :action :docs-edit :lane "In Progress" :heartbeat-at "2000-01-01T00:00:00Z"}\n' "${old_run}" >"${STATE}/locks/BOXP-761.edn"
  write_board "${VAULT}" "In Progress" "- [ ] [[Tickets/BOXP-761|BOXP-761: docs]] #ticket status::in-progress"
  write_ticket "${VAULT}" BOXP-761 in-progress localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-761.md" '完了せず終了していたため、backup から復元しました'
  assert_file_contains "${VAULT}/Tickets/BOXP-761.md" 'runbook.md restored'
  assert_file_contains "${run_dir}/summary.edn" ':status :interrupted'
  [[ ! -e "${STATE}/locks/BOXP-761.edn" ]] || fail "stale lock must be released"
}

write_unfinished_localllm_run() {
  # Leaves the state of a localllm run killed right after its note write: the
  # note already holds v1.3, the run dir has backup + audit (:applied) + a
  # :succeeded summary, and the ticket lock is stale.
  local ticket="$1" old_run="$2" run_dir="${STATE}/runs/$1/$2"
  mkdir -p "${run_dir}/backup/${PILOT}" "${STATE}/locks"
  cp "${VAULT}/${PILOT}/runbook.md" "${run_dir}/backup/${PILOT}/runbook.md"
  local before_sha after_sha
  before_sha="$(sha256sum "${VAULT}/${PILOT}/runbook.md" | cut -d' ' -f1)"
  sed -i 's/v1\.2/v1.3/' "${VAULT}/${PILOT}/runbook.md"
  after_sha="$(sha256sum "${VAULT}/${PILOT}/runbook.md" | cut -d' ' -f1)"
  printf '{:ticket-id "%s" :run-id "%s" :status :review :docs-roots ["%s"] :applied [{:path "%s/runbook.md" :before-sha256 "%s" :after-sha256 "%s" :created? false :backup "%s/backup/%s/runbook.md" :ops [{:op "replace-section"}]}]}\n' \
    "${ticket}" "${old_run}" "${PILOT}" "${PILOT}" "${before_sha}" "${after_sha}" "${run_dir}" "${PILOT}" >"${run_dir}/localllm-audit.edn"
  printf '{:status :succeeded :result "review" :ticket "%s" :run-id "%s" :action :docs-edit :agent "localllm"}\n' "${ticket}" "${old_run}" >"${run_dir}/summary.edn"
  printf '{:ticket "%s" :run-id "%s" :action :docs-edit :lane "In Progress" :heartbeat-at "2000-01-01T00:00:00Z"}\n' "${ticket}" "${old_run}" >"${STATE}/locks/${ticket}.edn"
}

test_stale_lock_recovery_is_decided_by_the_run_commit_record() {
  # A Review-lane re-run starts with the ticket already at `status: review`, so
  # the ticket status cannot tell a finished transition from a run that died
  # right after the note write. Recovery must restore here.
  setup; echo normal >"${MODE_FILE}"
  local old_run="20260701T000000Z"
  write_unfinished_localllm_run BOXP-762 "${old_run}"
  write_board "${VAULT}" Review "- [ ] [[Tickets/BOXP-762|BOXP-762: docs]] #ticket status::review"
  write_ticket "${VAULT}" BOXP-762 review boxp "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 >"${CASE_DIR}/out"
  assert_no_cloud
  assert_file_contains "${VAULT}/Tickets/BOXP-762.md" '完了せず終了していたため、backup から復元しました'
  assert_file_contains "${VAULT}/Tickets/BOXP-762.md" 'runbook.md restored'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${STATE}/runs/BOXP-762/${old_run}/summary.edn" ':status :interrupted'
  [[ ! -e "${STATE}/locks/BOXP-762.edn" ]] || fail "stale lock must be released"
  # The same state plus this run's commit record (written after lane and
  # frontmatter) means the transition completed: the note is kept even though
  # the ticket status says in-progress (e.g. edited by hand afterwards).
  setup; echo normal >"${MODE_FILE}"
  write_unfinished_localllm_run BOXP-763 "${old_run}"
  printf '{:ticket "BOXP-763" :run-id "%s" :phase :committed :status "review" :at "2026-07-01T00:00:01Z"}\n' "${old_run}" >"${STATE}/runs/BOXP-763/${old_run}/localllm-committed.edn"
  write_board "${VAULT}" "In Progress" "- [ ] [[Tickets/BOXP-763|BOXP-763: docs]] #ticket status::in-progress"
  write_ticket "${VAULT}" BOXP-763 in-progress boxp "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 >"${CASE_DIR}/out"
  assert_no_cloud
  assert_file_not_contains "${VAULT}/Tickets/BOXP-763.md" 'backup から復元しました'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${STATE}/runs/BOXP-763/${old_run}/summary.edn" ':status :interrupted'
  [[ ! -e "${STATE}/locks/BOXP-763.edn" ]] || fail "stale lock must be released"
  # A `:committing` journal means the run died in the middle of the lane /
  # frontmatter transition: the (verified) note write is kept and the
  # transition is completed, so Review and the note never disagree.
  setup; echo normal >"${MODE_FILE}"
  write_unfinished_localllm_run BOXP-764 "${old_run}"
  printf '{:ticket "BOXP-764" :run-id "%s" :phase :committing :status "review" :at "2026-07-01T00:00:01Z"}\n' "${old_run}" >"${STATE}/runs/BOXP-764/${old_run}/localllm-committed.edn"
  write_board "${VAULT}" "In Progress" "- [ ] [[Tickets/BOXP-764|BOXP-764: docs]] #ticket status::in-progress"
  write_ticket "${VAULT}" BOXP-764 in-progress localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "completing the transition must not start a new model run"
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-764\|.*status::review'
  assert_file_contains "${VAULT}/Tickets/BOXP-764.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-764.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/BOXP-764.md" '遷移の途中で終了していたため、遷移を review として完了させました'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-764.md" 'backup から復元しました'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${STATE}/runs/BOXP-764/${old_run}/localllm-committed.edn" ':phase :committed'
  [[ ! -e "${STATE}/locks/BOXP-764.edn" ]] || fail "stale lock must be released"
}

test_two_tickets_on_the_same_target_do_not_overwrite_each_other() {
  # Two tickets declare the same docs-target and run in parallel ticks. Both
  # snapshot the original note; the write lock + re-check make exactly one of
  # them apply and the other stop as a conflict (no silent overwrite).
  setup; echo slow >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-752|BOXP-752: docs]] #ticket status::ready
- [ ] [[Tickets/BOXP-753|BOXP-753: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-752 ready localllm "${PILOT}/runbook.md"
  write_ticket "${VAULT}" BOXP-753 ready localllm "${PILOT}/runbook.md"
  PATH="${BIN}:$PATH" CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1" \
    bb "${RUNNER}" tick --ticket BOXP-752 >"${CASE_DIR}/out1" &
  local p1=$!
  sleep 1
  PATH="${BIN}:$PATH" CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1" \
    bb "${RUNNER}" tick --ticket BOXP-753 >"${CASE_DIR}/out2" &
  local p2=$!
  wait "${p1}" "${p2}"
  assert_no_cloud
  [[ "$(request_count)" == 2 ]] || fail "expected 2 requests, got $(request_count)"
  local reviews blocked
  reviews="$(grep -c '^status: review$' "${VAULT}/Tickets/BOXP-752.md" "${VAULT}/Tickets/BOXP-753.md" | awk -F: '{s+=$2} END {print s}')"
  blocked="$(grep -c '^status: blocked$' "${VAULT}/Tickets/BOXP-752.md" "${VAULT}/Tickets/BOXP-753.md" | awk -F: '{s+=$2} END {print s}')"
  [[ "${reviews}" == 1 && "${blocked}" == 1 ]] || fail "expected exactly one review and one blocked, got review=${reviews} blocked=${blocked}"
  grep -q '競合のため未適用' "${VAULT}/Tickets/BOXP-752.md" "${VAULT}/Tickets/BOXP-753.md" || fail "the second write must stop as a conflict"
  [[ "$(grep -c 'v1\.3' "${VAULT}/${PILOT}/runbook.md")" == 1 ]] || fail "the note must carry exactly one applied update"
  [[ "$(grep -c 'v1\.2' "${VAULT}/${PILOT}/runbook.md")" == 0 ]] || fail "the applied update must replace the old line"
}

test_prompt_over_the_cap_blocks_without_a_request() {
  setup; echo normal >"${MODE_FILE}"
  # ~3,000 chars of body: fits max-note-chars but not a 2,000-char prompt cap
  for _ in $(seq 1 60); do printf -- '- 長い本文の行です。この行は上限の検証のためだけに存在します。\n'; done >>"${VAULT}/${PILOT}/runbook.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-754|BOXP-754: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-754 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_PROMPT_CHARS=2000 >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "no model request expected when the prompt exceeds the cap"
  assert_blocked BOXP-754 '上限 2000 字を超えます'
  assert_runbook_unchanged
}

test_symlink_swap_between_snapshot_and_write_is_rejected() {
  # Another vault editor replaces the allowed directory with a symlink after
  # the snapshot; the commit re-validates the path under the write lock and
  # must not write through the symlink.
  setup
  mkdir -p "${CASE_DIR}/outside"
  cp "${VAULT}/${PILOT}/runbook.md" "${CASE_DIR}/outside/runbook.md"
  local out
  out="$(bb -e "
(load-file \"${DOCS_MODULE}\")
(let [cfg (localllm-docs/config)
      vault \"${VAULT}\"
      rel \"${PILOT}/runbook.md\"
      snap (localllm-docs/snapshot-targets cfg vault [rel])
      staged (localllm-docs/stage-proposal cfg snap {:changes [{:path rel :op \"replace-text\" :heading \"\" :old_text \"v1.2\" :new_text \"v1.3\"}]})]
  (babashka.fs/move (str vault \"/${PILOT}\") (str \"${CASE_DIR}/moved-pilot\"))
  (babashka.fs/create-sym-link (str vault \"/${PILOT}\") \"${CASE_DIR}/outside\")
  (prn (localllm-docs/commit-staged! cfg vault \"${STATE}/runs/BOXP-755/r1\" staged {})))
" 2>&1)"
  [[ "${out}" == *':ok? false'* && "${out}" == *'書込み直前の再検証で拒否'* ]] || fail "commit must be rejected after a symlink swap: ${out}"
  grep -q 'v1.2' "${CASE_DIR}/outside/runbook.md" || fail "the file outside the vault must not be written"
  [[ ! -f "${STATE}/runs/BOXP-755/r1/backup/${PILOT}/runbook.md" ]] || fail "no backup may be taken for a rejected write"
  # reads never follow a symlink in the last component either (validation and read are tied)
  ln -s "${CASE_DIR}/outside/runbook.md" "${CASE_DIR}/moved-pilot/linked.md"
  out="$(bb -e "(load-file \"${DOCS_MODULE}\") (prn (try (localllm-docs/slurp-nofollow \"${CASE_DIR}/moved-pilot/linked.md\") (catch Exception e :refused)))" 2>&1)"
  [[ "${out}" == *':refused'* ]] || fail "slurp-nofollow must refuse a symlink: ${out}"
  # Nothing is read before the re-validation passes: with the swapped
  # directory pointing at a non-file, a read-before-validate would raise
  # instead of returning the clean rejection.
  setup
  mkdir -p "${CASE_DIR}/outside-dir/runbook.md"
  out="$(bb -e "
(load-file \"${DOCS_MODULE}\")
(let [cfg (localllm-docs/config)
      vault \"${VAULT}\"
      rel \"${PILOT}/runbook.md\"
      snap (localllm-docs/snapshot-targets cfg vault [rel])
      staged (localllm-docs/stage-proposal cfg snap {:changes [{:path rel :op \"replace-text\" :heading \"\" :old_text \"v1.2\" :new_text \"v1.3\"}]})]
  (babashka.fs/move (str vault \"/${PILOT}\") (str \"${CASE_DIR}/moved-pilot\"))
  (babashka.fs/create-sym-link (str vault \"/${PILOT}\") \"${CASE_DIR}/outside-dir\")
  (prn (try (localllm-docs/commit-staged! cfg vault \"${STATE}/runs/BOXP-772/r1\" staged {}) (catch Exception e [:raised (.getMessage e)]))))
" 2>&1)"
  [[ "${out}" == *':ok? false'* && "${out}" == *'書込み直前の再検証で拒否'* && "${out}" != *':raised'* ]] || fail "commit must reject without reading through the swapped directory: ${out}"
}

test_edit_on_a_later_target_during_the_write_is_detected() {
  # Two targets: an outside editor changes the second one while the first is
  # being written (test hook). The per-target re-check right before each
  # write must stop the commit, restore the first target and leave the
  # outside edit untouched (BOXP-775).
  setup
  printf -- '---\ntitle: second\n---\n\n# second\n\n## 現状\n\n- v1.2 で稼働。\n' >"${VAULT}/${PILOT}/second.md"
  local out
  out="$(CODEX_TASK_BOARD_TEST_EDIT_NEXT_LOCALLLM_TARGET_AFTER_FIRST=true bb -e "
(load-file \"${DOCS_MODULE}\")
(let [cfg (localllm-docs/config)
      vault \"${VAULT}\"
      rels [\"${PILOT}/runbook.md\" \"${PILOT}/second.md\"]
      snap (localllm-docs/snapshot-targets cfg vault rels)
      staged (localllm-docs/stage-proposal cfg snap {:changes (mapv (fn [rel] {:path rel :op \"replace-text\" :heading \"\" :old_text \"v1.2\" :new_text \"v1.3\"}) rels)})]
  (prn (localllm-docs/commit-staged! cfg vault \"${STATE}/runs/BOXP-775/r1\" staged {})))
" 2>&1)"
  [[ "${out}" == *':ok? false'* && "${out}" == *'localllm-conflict'* && "${out}" == *'書込み途中で検出'* && "${out}" == *'second.md: 読み取り後に別の更新が入りました'* ]] \
    || fail "a conflict on the second target must stop the commit: ${out}"
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${VAULT}/${PILOT}/second.md" 'external edit while the first target was written'
  assert_file_contains "${VAULT}/${PILOT}/second.md" 'v1\.2'
  assert_file_not_contains "${VAULT}/${PILOT}/second.md" 'v1\.3'
}

test_correction_round_over_the_prompt_cap_blocks() {
  # The first request fits the cap; the rejected output plus the correction
  # request would not. No second request is sent (BOXP-776).
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-776|BOXP-776: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-776 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out" 2>&1
  local first_chars
  first_chars="$(grep -o 'prompt-chars=[0-9]*' "${CASE_DIR}/out" | head -n 1 | cut -d= -f2)"
  [[ -n "${first_chars}" ]] || fail "prompt-chars not logged: $(cat "${CASE_DIR}/out")"
  setup; echo correct-after-reject >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-776|BOXP-776: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-776 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MAX_PROMPT_CHARS="$(( first_chars + 50 ))" >"${CASE_DIR}/out" 2>&1
  assert_no_cloud
  [[ "$(request_count)" == 1 ]] || fail "the correction round must not be sent over the cap (requests: $(request_count))"
  assert_blocked BOXP-776 '修正ラウンドの送信内容が .* 字で上限'
  assert_file_contains "${VAULT}/Tickets/BOXP-776.md" '見出しが見つかりません'
  assert_runbook_unchanged
}

test_crash_right_after_the_write_is_recovered_from_the_journal() {
  # The process dies after the notes are written but before the final audit /
  # Notes (test hook). The recovery journal persisted before the first write
  # lets the next tick's stale-lock recovery restore the note (BOXP-777).
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-777|BOXP-777: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-777 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_EXIT_AFTER_LOCALLLM_WRITE=true >"${CASE_DIR}/out" 2>&1 || true
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  [[ -e "${STATE}/locks/BOXP-777.edn" ]] || fail "the killed run must leave its lock behind"
  audit="$(find "${STATE}/runs/BOXP-777" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':applied \['
  assert_file_contains "${audit}" ':write-phase :writing'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-777.md" 'Review で停止しました'
  # hand the card to a human so the next tick only recovers and does not start a new model run
  sed -i 's/^assignee: localllm$/assignee: boxp/' "${VAULT}/Tickets/BOXP-777.md"
  sleep 2
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 >"${CASE_DIR}/out2" 2>&1
  assert_file_contains "${VAULT}/Tickets/BOXP-777.md" '完了せず終了していたため、backup から復元しました'
  assert_file_contains "${VAULT}/Tickets/BOXP-777.md" 'runbook.md restored'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  [[ ! -e "${STATE}/locks/BOXP-777.edn" ]] || fail "stale lock must be released"
  # A journal whose note was never written (killed before the first write)
  # reports the note as unchanged instead of restoring anything.
  local out
  out="$(bb -e "
(load-file \"${DOCS_MODULE}\")
(let [cfg (localllm-docs/config)
      vault \"${VAULT}\"
      rel \"${PILOT}/runbook.md\"
      snap (localllm-docs/snapshot-targets cfg vault [rel])
      staged (localllm-docs/stage-proposal cfg snap {:changes [{:path rel :op \"replace-text\" :heading \"\" :old_text \"v1.2\" :new_text \"v1.3\"}]})
      before (localllm-docs/sha256 (slurp (str vault \"/\" rel)))
      after (localllm-docs/sha256 (:after (first (:files staged))))]
  (localllm-docs/write-audit! \"${STATE}/runs/BOXP-778/r1\" {:status :staged :docs-roots (:docs-roots cfg) :applied [{:path rel :before-sha256 before :after-sha256 after :created? false :backup nil :ops []}] :write-phase :writing})
  (prn (localllm-docs/rollback! vault \"${STATE}/runs/BOXP-778/r1\")))
" 2>&1)"
  [[ "${out}" == *':status :unchanged'* ]] || fail "an unwritten journal entry must be reported as unchanged: ${out}"
  assert_runbook_unchanged
}

test_absolute_paths_in_the_ticket_are_rejected() {
  # A leading `/` in docs-target / docs-sources must not be normalized into a
  # vault-relative path: the ticket is untrusted input and absolute paths are
  # refused as such (BOXP-773 target, BOXP-774 corpus).
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-773|BOXP-773: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-773 ready localllm "/${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "no model request expected for an absolute docs-target"
  assert_blocked BOXP-773 '絶対 path'
  assert_runbook_unchanged
  setup; echo research >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-774|BOXP-774: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-774 ready localllm "${PILOT}/runbook.md" "/${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  [[ "$(request_count)" == 0 ]] || fail "no model request expected for an absolute docs-sources"
  assert_blocked BOXP-774 '絶対 path'
  assert_runbook_unchanged
}

test_model_supplied_sources_outside_the_runner_reads_are_not_recorded() {
  setup; echo bogus-sources >"${MODE_FILE}"
  printf -- '---\ntitle: source a\n---\n\n# source a\n\n- 稼働バージョンは v1.3。\n' >"${VAULT}/Projects/task-board-localllm-docs/refs/source-a.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-759|BOXP-759: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-759 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-759.md" '^status: review$'
  # the fabricated source never reaches Notes; the reference the runner read does
  assert_file_not_contains "${VAULT}/Tickets/BOXP-759.md" '偽の監査行'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-759.md" 'Secret/keys'
  assert_file_contains "${VAULT}/Tickets/BOXP-759.md" '出典: \[\[Projects/task-board-localllm-docs/refs/source-a\]\]'
  local audit
  audit="$(find "${STATE}/runs/BOXP-759" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':sources-dropped 1'
  assert_file_not_contains "${audit}" '偽の監査行'
}

test_research_total_time_limit_caps_each_model_call() {
  setup; echo slow >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-749|BOXP-749: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-749 ready localllm "${PILOT}/runbook.md" "${CORPUS}"
  # per-call limits stay at their defaults (600 s idle / 1800 s total): the
  # research limit alone must stop the very first stalled research call
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_RESEARCH_TOTAL_SECONDS=2 >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 1 ]] || fail "expected 1 request, got $(request_count)"
  assert_blocked BOXP-749 'localllm が 2 秒以内に応答を開始しませんでした'
  assert_runbook_unchanged
  local evidence
  evidence="$(find "${STATE}/runs/BOXP-749" -name llm-evidence.edn | head -n 1)"
  assert_file_contains "${evidence}" ':phase "research-1"'
  assert_file_contains "${evidence}" ':total-seconds 2'
}

for t in \
  test_credential_additions_are_blocked_by_the_executor \
  test_runaway_output_is_cut_and_blocks_without_retry \
  test_research_collects_evidence_then_applies_with_sources \
  test_research_sources_must_be_notes_the_model_read \
  test_research_sources_hit_only_by_search_are_rejected \
  test_research_total_time_limit_caps_each_model_call \
  test_model_supplied_sources_outside_the_runner_reads_are_not_recorded \
  test_write_is_deferred_until_the_lifecycle_commit \
  test_failed_transition_after_the_write_is_rolled_back \
  test_partial_write_failure_keeps_a_file_edited_in_between \
  test_stale_lock_recovery_restores_an_unfinished_write \
  test_stale_lock_recovery_is_decided_by_the_run_commit_record \
  test_two_tickets_on_the_same_target_do_not_overwrite_each_other \
  test_prompt_over_the_cap_blocks_without_a_request \
  test_symlink_swap_between_snapshot_and_write_is_rejected \
  test_absolute_paths_in_the_ticket_are_rejected \
  test_crash_right_after_the_write_is_recovered_from_the_journal \
  test_edit_on_a_later_target_during_the_write_is_detected \
  test_correction_round_over_the_prompt_cap_blocks \
  test_research_finish_without_reads_auto_reads_the_hits \
  test_research_without_progress_stops_and_unsourced_apply_blocks \
  test_research_sources_outside_read_roots_block_without_request \
  test_corpus_notes_over_the_byte_caps_block_before_any_read \
  test_oversized_target_and_reference_are_refused_before_reading \
  test_apply_moves_to_review_without_cloud \
  test_stream_response_is_applied \
  test_missing_opt_in_blocks_without_request \
  test_backlog_localllm_is_not_groomed \
  test_target_outside_allowlist_blocks \
  test_traversal_and_symlink_targets_block \
  test_needs_human_blocks_with_reason \
  test_invalid_outputs_block_and_leave_file \
  test_section_rewrite_keeps_links_outside_the_section \
  test_rejected_proposal_gets_one_correction_round \
  test_heading_without_hashes_is_matched_by_text \
  test_append_section_on_a_duplicated_heading_is_rejected \
  test_http_errors_block_after_bounded_retries \
  test_unreachable_model_blocks_without_cloud_fallback \
  test_idle_timeout_blocks \
  test_stream_cut_blocks \
  test_concurrent_edit_is_detected_and_not_overwritten \
  test_review_lane_reruns_as_revision \
  test_tick_ticket_filter_claims_only_one_card \
  test_parallel_ticks_run_once_per_card; do
  echo "== ${t}"
  "${t}"
done
echo "localllm docs tests passed"
