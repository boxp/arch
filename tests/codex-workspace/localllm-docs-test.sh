#!/usr/bin/env bash
set -euo pipefail

# Black-box tests for the Task Board `assignee: localllm` document-update route
# (BOXP-277). A fake OpenAI-compatible server (babashka http-kit) stands in for
# llama-server; fake claude / codex CLIs record any start so the tests can prove
# the route never falls back to a cloud agent.

unset CODEX_TASK_BOARD_CLAUDE_BIN
unset CODEX_TASK_BOARD_LOCALLLM_BASE_URL CODEX_TASK_BOARD_LOCALLLM_DOCS_ROOTS CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS
unset CODEX_TASK_BOARD_LOCALLLM_TIMEOUT_SECONDS CODEX_TASK_BOARD_LOCALLLM_IDLE_TIMEOUT_SECONDS CODEX_TASK_BOARD_LOCALLLM_RETRIES
unset CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES CODEX_TASK_BOARD_LOCALLLM_PROPOSAL_ROOT CODEX_TASK_BOARD_LOCALLLM_EXCLUDE_PATHS CODEX_TASK_BOARD_LOCALLLM_MODEL CODEX_TASK_BOARD_LOCALLLM_MODELS

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
;; Model ids the fake router "serves" (GET /v1/models) and the id of the last
;; chat request, echoed back like llama-server does (BOXP-294).
(def served-models ["gemma4-26b" "qwen38-27b"])
(def req-model (atom "gemma4-26b"))
(defn respond [content finish]
  {:status 200 :headers {"Content-Type" "application/json"}
   :body (json/generate-string {:id (str "chatcmpl-" (System/nanoTime)) :model @req-model :object "chat.completion"
                                :choices [{:index 0 :finish_reason finish :message {:role "assistant" :content content}}]
                                :usage {:prompt_tokens 1000 :completion_tokens (count content) :total_tokens (+ 1000 (count content))}})})
(defn sse [m] (str "data: " (json/generate-string m) "\n\n"))
(defn respond-stream [req pieces {:keys [cut? delay-ms]}]
  (let [base {:id (str "chatcmpl-" (System/nanoTime)) :model @req-model :object "chat.completion.chunk"}]
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
(defn models-list [req]
  ;; GET /v1/models is logged with :uri so a test can prove whether the
  ;; runner consulted the model list (and that no chat request followed).
  (spit req-log (str (pr-str {:uri (:uri req) :method (:request-method req)}) "\n") :append true)
  {:status 200 :headers {"Content-Type" "application/json"}
   :body (json/generate-string {:object "list" :data (mapv (fn [id] {:id id :object "model" :owned_by "llamacpp"}) served-models)})})
(declare handler*)
(defn handler [req]
  (if (= "/v1/models" (:uri req))
    (models-list req)
    (handler* req)))
(defn handler* [req]
  (let [uri (:uri req)
        raw (if (:body req) (slurp (:body req)) "{}")
        parsed (json/parse-string raw true)
        _ (when (:model parsed) (reset! req-model (:model parsed)))
        mode (str/trim (slurp mode-file))
        user (:content (last (:messages parsed)))
        schema-name (get-in parsed [:response_format :json_schema :name])
        research? (= "docs_research_step" schema-name)
        propose? (= "docs_setting_proposal" schema-name)
        verify? (= "docs_setting_verify" schema-name)
        revise? (str/includes? (str user) "Review にあり")
        corpus-note "Projects/task-board-localllm-docs/refs/corpus/design-v2.md"
        ;; propose mode answers (BOXP-277 owner purpose): canon facts cite the
        ;; corpus note the scripted research read; the proposal is new text.
        setting (fn [& {:keys [decision reason facts proposal conflicts]}]
                  (json/generate-string {:decision (or decision "propose") :reason (or reason "") :title (if revise? "改稿後の案" "冬祭りの装い")
                                         :canon_facts (or facts [{:fact "待受ポートは 8081 である" :source corpus-note}])
                                         :proposal (or proposal (if revise? "- 改稿: 藍と白を基調にし、提灯型の飾りを添える。PROPOSAL-REVISED" "- 藍と橙を基調にした冬祭り用の装い。既存の色遣いを引き継ぐ。PROPOSAL-BODY [[Projects/task-board-localllm-docs/refs/corpus/design-v2|設計]] と [[Unknown/invented-note|架空ノート]] を参照。"))
                                         :conflicts (or conflicts ["依頼の 8080 は旧版の値（design-v1）と一致するため要確認"]) :questions ["装いの季節は冬で良いか"]
                                         :sources (vec (distinct (map :source (or facts [{:source corpus-note}]))))}))
        step (fn [action & {:keys [queries reads]}]
               (json/generate-string {:action action :queries (or queries []) :reads (or reads []) :reason "test"}))
        ;; Scripted research: search first, then read one section, then finish.
        ;; `research-hit-only-sources` searches a term that hits design-v1 too, but
        ;; still only reads design-v2.
        research-step (cond
                        (not (str/includes? (str user) "round 1")) (step "search" :queries [(if (= mode "research-hit-only-sources") "ポート" "8081 ポート")])
                        (= mode "research-finish-on-hits") (step "finish")
                        (not (str/includes? (str user) "### 根拠:")) (step "read" :reads [{:path corpus-note :heading "## 構成"}])
                        :else (step "finish"))
        create? (= "docs_setting_create" schema-name)
        creds-note "Infrastructure/creds-note.md"
        ;; create mode answers (BOXP-282): a new character / monster note.
        created (fn [& {:keys [decision reason name slug facts body aliases]}]
                  (json/generate-string {:decision (or decision "propose") :reason (or reason "")
                                         :name (or name "灯守ホタル") :slug (or slug "hotaru-lantern-keeper")
                                         :aliases (or aliases (if revise? ["ホタル" "蛍"] ["ホタル" "灯守ホタル"])) :summary (if revise? "改稿後の概要。CREATE-REVISED" "灯籠の火を守る見習いの少女。CREATE-SUMMARY")
                                         :profile (or body "- 年齢: 16 歳。灯籠組合の見習い。CREATE-BODY [[Projects/task-board-localllm-docs/refs/corpus/design-v2|設計]] と [[Unknown/ghost-note|架空]] を参照。")
                                         :appearance "- 橙の作業着。" :personality "- 控えめ。語尾は「…かな」。" :role "## 役割\n- 見習い。"
                                         :relationships "" :timeline "- 灯暦 120 年に見習いになる。"
                                         :ecology "- 夜行性。" :habitat "- 山あいの沢。" :traits "- 体表が淡く光る。CREATE-BODY" :world-position "- 既存種とは別系統。" :story-usage "- 道しるべになる。" :weaknesses "- 強い光。"
                                         :canon_facts (or facts [{:fact "待受ポートは 8081 である" :source corpus-note}])
                                         :conflicts ["依頼の 8080 は旧版の値（design-v1）と一致するため要確認"] :questions ["見習いの期間は何年か"]
                                         :sources (vec (distinct (map :source (or facts [{:source corpus-note}]))))}))
        ;; vault-wide research script: list a folder, then read a credential-looking
        ;; note plus three paths that must be refused (ticket, other proposal, hidden dir), then finish.
        vaultwide-step (cond
                         (not (str/includes? (str user) "round 1")) (json/generate-string {:action "list" :queries [] :reads [] :folders ["Infrastructure"] :reason "test"})
                         (not (str/includes? (str user) "### 根拠:")) (json/generate-string {:action "read" :queries [] :folders []
                                                                                             :reads [{:path creds-note :heading ""} {:path "Tickets/BOXP-800.md" :heading ""}
                                                                                                     {:path "Projects/task-board-localllm-docs/proposals/characters/other-ticket.md" :heading ""} {:path "Drafts/llm/characters/other-ticket.md" :heading ""}
                                                                                                     {:path ".obsidian/workspace.md" :heading ""}]
                                                                                             :reason "test"})
                         :else (json/generate-string {:action "finish" :queries [] :reads [] :folders [] :reason "done"}))]
    (spit req-log (str (pr-str {:uri uri :model (:model parsed) :mode mode :schema? (some? (:response_format parsed))
                                :schema-name schema-name
                                :stream? (:stream parsed) :revise? (str/includes? (str user) "Review にあり")
                                :mentions-secret? (str/includes? (str user) "FIXTURE-DECOY")
                                :sees-token-value? (str/includes? (str user) "SECRET-LINE-TOKEN-VALUE")
                                :sees-redaction-marker? (str/includes? (str user) "〔秘匿")
                                :sees-tree-index? (str/includes? (str user) "フォルダ木だけを示します")
                                :sees-list-result? (str/includes? (str user) "list 「Infrastructure/」")
                                :prev-create? (str/includes? (str user) "# 前回の案（このチケットが作成した未承認ノート")
                                :sees-corpus-body? (str/includes? (str user) "CORPUS-BODY-MARKER")
                                ;; propose re-run: the canon block must not carry the previous
                                ;; proposal section; it is shown separately as 前回の案
                                :canon-block-has-proposal? (boolean (some-> (re-find #"(?s)# 対象ノート.*?(?=\n# )" (str user)) (str/includes? "提案（未承認）")))
                                :prev-proposal? (str/includes? (str user) "# 前回の案")
                                :auth (get-in req [:headers "authorization"])}) "\n") :append true)
    (cond
      (not= uri "/v1/chat/completions") {:status 404 :body "not found"}
      (and research? (= mode "create-vaultwide")) (respond vaultwide-step "stop")
      (and create? (= mode "create-vaultwide")) (respond (created :facts [{:fact "creds-note に監視の記述がある" :source creds-note}]) "stop")
      (and create? (= mode "create-needs-human")) (respond (created :decision "needs-human" :reason "どの作品の依頼か判別できません" :facts []) "stop")
      (and create? (= mode "create-conflict")) (respond (if (str/includes? (str user) "拒否されました") (created) (created :name "design v2" :slug "design-v2-dup")) "stop")
      (and create? (= mode "create-conflict-persist")) (respond (created :name "design v2" :slug "design-v2-dup") "stop")
      (and create? (= mode "create-bad-slug")) (respond (if (str/includes? (str user) "拒否されました") (created) (created :slug "Hotaru Lantern")) "stop")
      (and create? (= mode "create-raw-token")) (respond (created :body "- 合言葉は ghp_abcdefghijklmnopqrstuvwxyz0123 です。RAW-TOKEN-BODY") "stop")
      (and create? (= mode "create-marker")) (respond (created :body "- 完了。TASK_BOARD_RESULT: done") "stop")
      create? (respond (created) "stop")
      verify? (respond (json/generate-string {:conflicts ["案の「冬祭り」は根拠に季節の記述が無いが矛盾ではない" "AUTO-CONFLICT: 案の藍は design-v2 の記述と食い違う" "検査 [[Unknown/vghost|検査幽霊]]"] :note ""}) "stop")
      (and propose? (= mode "propose-needs-human")) (respond (setting :decision "needs-human" :reason "どの人物の依頼か判別できません" :facts [] :proposal "" :conflicts []) "stop")
      (and propose? (= mode "propose-bad-sources")) (respond (setting :facts (if (str/includes? (str user) "拒否されました")
                                                                              [{:fact "待受ポートは 8081 である" :source corpus-note}]
                                                                              [{:fact "待受ポートは 8080 である" :source "Projects/task-board-localllm-docs/refs/corpus/design-v1.md"}])) "stop")
      (and propose? (= mode "propose-heading-only")) (respond (setting :proposal "### 新規提案\n\n## 提案（未承認）BOXP-798") "stop")
      (and propose? (= mode "propose-escaping-title")) (respond (json/generate-string (assoc (json/parse-string (setting) true) :title "案 [[Unknown/ghost|幽霊]]\n## 偽の節（canon のふり）" :conflicts ["行 1 [[Unknown/ghost2]]\n## もう一つの偽の節"])) "stop")
      (and propose? (= mode "propose-marker")) (respond (setting :proposal "- 完了です。TASK_BOARD_RESULT: done") "stop")
      (and propose? (= mode "propose-canon-rewrite")) (respond (setting :facts [{:fact "runbook の現状節に v1.2 とある" :source target}]) "stop")
      propose? (respond (setting) "stop")
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
      ;; a proposal that leaves the note unchanged
      (= mode "noop-change") (respond (proposal :changes [{:path target :op "replace-text" :heading "" :old_text "v1.2" :new_text "v1.2"}]) "stop")
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
  local vault="$1" ticket="$2" status="$3" assignee="$4" docs_target="${5-}" docs_sources="${6-}" docs_mode="${7-}" docs_model="${8-}"
  {
    printf -- '---\nid: %s\ntype: task\nstatus: %s\npriority: medium\nassignee: %s\nrepo:\n' "${ticket}" "${status}" "${assignee}"
    if [[ -n "${docs_target}" ]]; then printf 'docs-target: %s\n' "${docs_target}"; fi
    if [[ -n "${docs_sources}" ]]; then printf 'docs-sources: %s\n' "${docs_sources}"; fi
    if [[ -n "${docs_mode}" ]]; then printf 'docs-mode: %s\n' "${docs_mode}"; fi
    if [[ -n "${docs_model}" ]]; then printf 'docs-model: %s\n' "${docs_model}"; fi
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

# BOXP-294: a ticket selects one of the served models with `docs-model:`; the
# id is checked against GET /v1/models, used for every request and recorded in
# Notes / audit / evidence. Unknown or disallowed ids stop the run before any
# chat request (no fallback to the default model).
test_docs_model_selects_a_served_model() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-740|BOXP-740: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-740 ready localllm "${PILOT}/runbook.md" "" "" "qwen38-27b"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-740\|.*status::review'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${REQ_LOG}" ':uri "/v1/models"'
  assert_file_contains "${REQ_LOG}" ':model "qwen38-27b"'
  assert_file_not_contains "${REQ_LOG}" ':model "gemma4-26b"'
  assert_file_contains "${VAULT}/Tickets/BOXP-740.md" 'Review で停止しました.*model=qwen38-27b'
  local run_dir
  run_dir="$(find "${STATE}/runs/BOXP-740" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  assert_file_contains "${run_dir}/localllm-audit.edn" ':model "qwen38-27b"'
  assert_file_contains "${run_dir}/llm-evidence.edn" ':model "qwen38-27b"'
  assert_file_not_contains "${run_dir}/llm-evidence.edn" ':model "gemma4-26b"'
}

test_unknown_docs_model_blocks_without_a_model_call() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-741|BOXP-741: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-741 ready localllm "${PILOT}/runbook.md" "" "" "nope-1b"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  assert_blocked BOXP-741 'docs-model「nope-1b」は localllm に登録されていません（登録済み: gemma4-26b, qwen38-27b）。既定モデルへは切り替えません'
  assert_runbook_unchanged
  assert_file_contains "${REQ_LOG}" ':uri "/v1/models"'
  assert_file_not_contains "${REQ_LOG}" '/v1/chat/completions'
  local run_dir
  run_dir="$(find "${STATE}/runs/BOXP-741" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  assert_file_contains "${run_dir}/localllm-audit.edn" ':model "nope-1b"'
  assert_file_contains "${run_dir}/localllm-audit.edn" ':category "localllm-unknown-model"'
}

test_docs_model_outside_the_allowlist_blocks_before_any_request() {
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-742|BOXP-742: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-742 ready localllm "${PILOT}/runbook.md" "" "" "qwen38-27b"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_MODELS="gemma4-26b" >"${CASE_DIR}/out"
  assert_no_cloud
  assert_blocked BOXP-742 'docs-model「qwen38-27b」はこの runner で許可された model ではありません（許可: gemma4-26b）'
  assert_runbook_unchanged
  [[ "$(request_count)" == 0 ]] || fail "expected no request at all, got $(request_count)"
  # a malformed id is refused the same way, without reaching the server
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-743|BOXP-743: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-743 ready localllm "${PILOT}/runbook.md" "" "" "../etc"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-743 'docs-model の値 .* は model id として不正です'
  [[ "$(request_count)" == 0 ]] || fail "expected no request for a malformed id, got $(request_count)"
}

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

test_backlog_legacy_transcribe_ticket_is_groomed_without_a_model_call() {
  # BOXP-290: a Backlog card is groomed by the runner itself (no model, no document write)
  # and ends in Ready + assignee boxp; an older card with only docs-target keeps meaning transcribe
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-703|BOXP-703: docs]] #ticket status::backlog"
  write_ticket "${VAULT}" BOXP-703 backlog localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "groom must not call the model"
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-703\|.*status::ready'
  assert_file_contains "${VAULT}/Tickets/BOXP-703.md" '^status: ready$'
  assert_file_contains "${VAULT}/Tickets/BOXP-703.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/BOXP-703.md" 'localllm groom run .* が票を整理し Ready に置きました'
  assert_file_contains "${VAULT}/Tickets/BOXP-703.md" '用途 = .*への事実転記（transcribe、frontmatter の docs-target（旧形式））'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-703.md" '^docs-mode:'
  assert_runbook_unchanged
  [[ -f "${STATE}/runs/BOXP-703/$(ls "${STATE}/runs/BOXP-703")/localllm-groom.edn" ]] || fail "groom record expected"
}



test_backlog_groom_validates_explicit_targets_before_ready() {
  # codex review: a declared target the run would refuse is a question at groom time, not a Ready card
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-705|BOXP-705: docs]] #ticket status::backlog"
  write_ticket "${VAULT}" BOXP-705 backlog localllm "Infrastructure/prod.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-705.md" '^status: blocked$'
  assert_file_contains "${VAULT}/Tickets/BOXP-705.md" 'localllm groom run .* は票を整理できず停止しました.*許可 root 外'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  # explicit propose with two targets: question at groom time
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-706|BOXP-706: docs]] #ticket status::backlog"
  write_ticket "${VAULT}" BOXP-706 backlog localllm "${PILOT}/runbook.md,${PILOT}/other.md" "" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-706.md" '^status: blocked$'
  assert_file_contains "${VAULT}/Tickets/BOXP-706.md" 'docs-target は 1 ノートだけです'
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

test_noop_proposal_is_not_applied() {
  # BOXP-780: old_text = new_text leaves the note as it is; that is not an
  # applied change and must not move the card to Review
  setup; echo noop-change >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-780|BOXP-780: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-780 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  assert_blocked BOXP-780 '(同じ内容のため適用しません|本文が変わりません)'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/Tickets/BOXP-780.md" 'Review で停止しました'
}

test_crash_right_after_the_review_note_completes_the_transition() {
  # BOXP-781: the process dies after the Review note was appended but before
  # the lane move. The transition journal is written before that note, so the
  # next tick completes the transition (Review + frontmatter) and keeps the
  # document, instead of restoring the document under a note that says it
  # was updated.
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-781|BOXP-781: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-781 ready localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_TEST_EXIT_AFTER_LOCALLLM_REVIEW_NOTE=true >"${CASE_DIR}/out" 2>&1 || true
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${VAULT}/Tickets/BOXP-781.md" 'Review で停止しました'
  assert_file_contains "${VAULT}/Tickets/BOXP-781.md" '^status: in-progress$'
  [[ -e "${STATE}/locks/BOXP-781.edn" ]] || fail "the killed run must leave its lock behind"
  local old_run
  old_run="$(find "${STATE}/runs/BOXP-781" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | head -n 1)"
  assert_file_contains "${STATE}/runs/BOXP-781/${old_run}/localllm-committed.edn" ':phase :committing'
  sleep 2
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 >"${CASE_DIR}/out2" 2>&1
  assert_no_cloud
  [[ "$(request_count)" == 1 ]] || fail "completing the transition must not start a new model run, got $(request_count) requests"
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-781\|.*status::review'
  assert_file_contains "${VAULT}/Tickets/BOXP-781.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-781.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/BOXP-781.md" '遷移の途中で終了していたため、遷移を review として完了させました'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-781.md" 'backup から復元しました'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.3'
  assert_file_contains "${STATE}/runs/BOXP-781/${old_run}/localllm-committed.edn" ':phase :committed'
  [[ ! -e "${STATE}/locks/BOXP-781.edn" ]] || fail "stale lock must be released"
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
  # the board -> frontmatter sync is restricted to the selected card too: a card
  # moved by hand (frontmatter not yet synced) outside --ticket is left as it is
  sed -i 's/^status: ready$/status: backlog/' "${VAULT}/Tickets/BOXP-726.md"
  sed -i 's/BOXP-726: docs\]\] #ticket status::ready/BOXP-726: docs]] #ticket/' "${VAULT}/Boards/Task Board.md"
  PATH="${BIN}:$PATH" CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" \
    CODEX_TASK_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1" CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 \
    bb "${RUNNER}" tick --ticket BOXP-727 >"${CASE_DIR}/out-sync"
  assert_file_contains "${VAULT}/Tickets/BOXP-726.md" '^status: backlog$'
  assert_file_not_contains "${VAULT}/Boards/Task Board.md" 'BOXP-726: docs\]\] #ticket status::'
  assert_file_contains "${VAULT}/Boards/Task Board.md" 'BOXP-727: docs\]\] #ticket status::review'
  sed -i 's/^status: backlog$/status: ready/' "${VAULT}/Tickets/BOXP-726.md"
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

test_committing_recovery_blocks_when_the_note_changed_after_the_write() {
  # BOXP-782: the run died in the middle of the lane / frontmatter transition
  # (`:committing` journal) and the operator edited the target note by hand
  # before the stale lock was recovered. Recovery must not present the edited
  # note as "applied" in Review: hashes are checked against the audit under
  # the write lock, the ticket is blocked, the note is left as it is now (no
  # restore from backup either), and the journal records the conflict.
  setup; echo normal >"${MODE_FILE}"
  local old_run="20260701T000000Z"
  write_unfinished_localllm_run BOXP-782 "${old_run}"
  printf '{:ticket "BOXP-782" :run-id "%s" :phase :committing :status "review" :at "2026-07-01T00:00:01Z"}\n' "${old_run}" >"${STATE}/runs/BOXP-782/${old_run}/localllm-committed.edn"
  sed -i 's/v1\.3/v1.4 (手動修正)/' "${VAULT}/${PILOT}/runbook.md"
  write_board "${VAULT}" "In Progress" "- [ ] [[Tickets/BOXP-782|BOXP-782: docs]] #ticket status::in-progress"
  write_ticket "${VAULT}" BOXP-782 in-progress localllm "${PILOT}/runbook.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCK_STALE_SECONDS=1 >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "a conflicting recovery must not start a new model run"
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-782\|.*status::blocked'
  assert_file_not_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-782\|.*status::review'
  assert_file_contains "${VAULT}/Tickets/BOXP-782.md" '^status: blocked$'
  assert_file_contains "${VAULT}/Tickets/BOXP-782.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/BOXP-782.md" '対象文書が run の書込み内容から変わっていたため、遷移を完了せず Blocked にしました'
  assert_file_contains "${VAULT}/Tickets/BOXP-782.md" 'runbook.md changed'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-782.md" '遷移を review として完了させました'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-782.md" 'backup から復元しました'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.4 \(手動修正\)'
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.2'
  assert_file_contains "${STATE}/runs/BOXP-782/${old_run}/localllm-committed.edn" ':phase :conflict'
  assert_file_contains "${STATE}/runs/BOXP-782/${old_run}/summary.edn" ':status :interrupted'
  [[ ! -e "${STATE}/locks/BOXP-782.edn" ]] || fail "stale lock must be released"
  # A second tick must not re-decide the conflict (journal is terminal).
  run_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out2"
  [[ "$(request_count)" == 0 ]] || fail "a blocked ticket must not be picked up again"
  [[ "$(grep -c '遷移を完了せず Blocked にしました' "${VAULT}/Tickets/BOXP-782.md")" == 1 ]] || fail "the conflict note must be written once"
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" 'v1\.4 \(手動修正\)'
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

test_ticket_brief_drops_runner_notes_and_marks_the_ticket_as_non_source() {
  # Deployed E2E of BOXP-278 (2026-10-24): the runner's own Notes (start /
  # finish / result / Blocked / kohako relay) carried the previous run's facts
  # and paths, the model skipped the corpus and cited "Notes". The brief keeps
  # human notes only and says the ticket body is not a source.
  setup
  local out
  out="$(bb -e "
(load-file \"${DOCS_MODULE}\")
(print (localllm-docs/ticket-brief (str \"---\\nid: BOXP-790\\n---\\n\\n# BOXP-790: brief\\n\\n## Summary\\n\\ns\\n\\n## Notes\\n\\n\"
  \"- 2026-10-23: 人の指示 A\\n\"
  \"- 2026-10-24: Codex task-board run 20261024T015020Z-695fb2b1-bba7-4636-b5b1-0e65337ebd0d started from Ready with action docs-edit using localllm.\\n\"
  \"- 2026-10-24: localllm docs run 20261024T015020Z-695fb2b1-bba7-4636-b5b1-0e65337ebd0d は変更を適用せず停止しました（cloud への切替はしません）。 category=x\\n\"
  \"- 2026-10-24: Blocked transition recorded: ticket=BOXP-790; run=r\\n\"
  \"- 2026-10-24 01:25:18 UTC [kohako-event]: [kohako-event] handled event=e result=silent\\n\"
  \"- 2026-10-24: Codex run 20261024T015020Z-32722cbd-77c3-4722-b735-312ef0225cbc was marked interrupted after planned workspace shutdown\\n\"
  \"- 2026-07-13: Codex task-board run 20260713T164707Z finished with result review.\\n\"
  \"- 2026-07-13: localllm docs run 20260713T164707Z が 1 ファイルを更新し Review で停止しました\\n\"
  \"- 2026-10-24: Codex run を手動で再実行してください\\n\"
  \"- 2026-10-24 01:50:02 UTC [boxp]: 帯は橙を残して\\n\") 15))
" 2>&1)"
  [[ "${out}" == *'人の指示 A'* && "${out}" == *'帯は橙を残して'* && "${out}" == *'Codex run を手動で再実行してください'* ]] || fail "human notes must stay in the brief: ${out}"
  [[ "${out}" != *'Codex task-board run'* && "${out}" != *'localllm docs run'* && "${out}" != *'Blocked transition recorded'* \
     && "${out}" != *'kohako-event'* && "${out}" != *'marked interrupted'* && "${out}" != *'20260713T164707Z'* ]] || fail "runner-generated notes must be dropped from the brief: ${out}"
  [[ "${out}" == *'資料ではありません'* && "${out}" == *'出典にはできず'* ]] || fail "the brief must say the ticket body is not a source: ${out}"
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

# ---------------------------------------------------------------------------
# Propose mode (docs-mode: propose): new setting drafts kept apart from canon
# ---------------------------------------------------------------------------

assert_canon_intact() {
  # everything above the proposal section is byte-identical to the fixture
  local note="$1"
  grep -q '^- 稼働バージョンは v1.2 で、待受ポートは 8080 です。$' "${note}" || fail "canon line must be unchanged"
  assert_file_contains "${note}" '^updated: 2026-09-30$'
  assert_file_contains "${note}" '^## 注意$'
  assert_file_contains "${note}" 'source-b\|B'
}

test_propose_appends_an_unapproved_section_and_keeps_canon() {
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-790|BOXP-790: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-790 ready localllm "${PILOT}/runbook.md" "${CORPUS}" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  # search -> read -> finish -> proposal -> verify
  [[ "$(request_count)" == 5 ]] || fail "expected 5 requests (3 research + proposal + verify), got $(request_count)"
  [[ "$(grep -c ':schema-name "docs_setting_proposal"' "${REQ_LOG}")" == 1 ]] || fail "expected one proposal request"
  [[ "$(grep -c ':schema-name "docs_setting_verify"' "${REQ_LOG}")" == 1 ]] || fail "expected one verify request"
  assert_file_contains "${VAULT}/Tickets/BOXP-790.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-790.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/BOXP-790.md" '『提案（未承認）BOXP-790』節を 追加 し Review で停止しました'
  assert_file_contains "${VAULT}/Tickets/BOXP-790.md" '参照した既存設定 1 件、矛盾・要確認 4 件（うち自動検査 3 件）、質問 1 件'
  assert_file_contains "${VAULT}/Tickets/BOXP-790.md" '未解決の wikilink を平文化 1 件'
  assert_file_contains "${VAULT}/Tickets/BOXP-790.md" '出典: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]'
  # model text (title / proposal / conflicts) never reaches Notes
  assert_file_not_contains "${VAULT}/Tickets/BOXP-790.md" 'PROPOSAL-BODY'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-790.md" '冬祭りの装い'
  local note="${VAULT}/${PILOT}/runbook.md"
  assert_canon_intact "${note}"
  assert_file_contains "${note}" '^## 提案（未承認）BOXP-790$'
  [[ "$(grep -c '^## 提案（未承認）BOXP-790$' "${note}")" == 1 ]] || fail "exactly one proposal section"
  assert_file_contains "${note}" '未承認の提案'
  assert_file_contains "${note}" '^### 参照した既存設定$'
  assert_file_contains "${note}" '^- 待受ポートは 8081 である（出典: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]）$'
  assert_file_contains "${note}" '^### 新規提案$'
  assert_file_contains "${note}" 'PROPOSAL-BODY'
  # a wikilink to a note the runner resolved stays; an invented one becomes plain text
  assert_file_contains "${note}" '\[\[Projects/task-board-localllm-docs/refs/corpus/design-v2|設計\]\]'
  assert_file_not_contains "${note}" '\[\[Unknown/invented-note'
  assert_file_contains "${note}" '架空ノート'
  assert_file_contains "${note}" '^### 矛盾・要確認$'
  assert_file_contains "${note}" '^- 依頼の 8080 は旧版の値（design-v1）と一致するため要確認$'
  assert_file_contains "${note}" '^- AUTO-CONFLICT: 案の藍は design-v2 の記述と食い違う（自動検査）$'
  assert_file_contains "${note}" '^- 検査 検査幽霊（自動検査）$'
  assert_file_not_contains "${note}" '\[\[Unknown/vghost'
  assert_file_contains "${note}" '^### 人への質問$'
  local audit
  audit="$(find "${STATE}/runs/BOXP-790" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':mode "propose"'
  assert_file_contains "${audit}" ':op "append-section"'
  assert_file_contains "${audit}" ':links-dropped 1'
  assert_file_contains "${audit}" ':auto-conflicts 3'
  assert_file_contains "${audit}" ':status :checked'
  # Review re-run of the same ticket replaces the section instead of adding a second one
  write_board "${VAULT}" Review "- [ ] [[Tickets/BOXP-790|BOXP-790: setting]] #ticket status::review"
  write_ticket "${VAULT}" BOXP-790 review localllm "${PILOT}/runbook.md" "${CORPUS}" propose
  printf -- '- 2026-10-23: boxp: 色を藍と白に変更して提灯型の飾りを追加してください\n' >>"${VAULT}/Tickets/BOXP-790.md"
  : >"${REQ_LOG}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out2"
  assert_file_contains "${REQ_LOG}" ':revise\? true'
  # the previous draft is shown as 前回の案, never inside the canon block (proposal, verify and research requests)
  grep -q ':prev-proposal? true' "${REQ_LOG}" || fail "revision must show the previous draft separately"
  assert_file_not_contains "${REQ_LOG}" ':canon-block-has-proposal? true'
  assert_file_contains "${VAULT}/Tickets/BOXP-790.md" '『提案（未承認）BOXP-790』節を 改稿（置換） し Review で停止しました'
  assert_canon_intact "${note}"
  [[ "$(grep -c '^## 提案（未承認）BOXP-790$' "${note}")" == 1 ]] || fail "revision must replace, not duplicate, the proposal section"
  assert_file_contains "${note}" 'PROPOSAL-REVISED'
  assert_file_not_contains "${note}" 'PROPOSAL-BODY'
}

test_propose_without_declared_sources_uses_the_default_corpus() {
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-791|BOXP-791: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-791 ready localllm "${PILOT}/runbook.md" "" propose
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES="${CORPUS}" >"${CASE_DIR}/out"
  [[ "$(grep -c ':schema-name "docs_research_step"' "${REQ_LOG}")" == 3 ]] || fail "default corpus must be researched"
  assert_file_contains "${VAULT}/Tickets/BOXP-791.md" '^status: review$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^## 提案（未承認）BOXP-791$'
  # the default corpus is validated like a declared one: outside the read roots -> blocked, no request
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-792|BOXP-792: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-792 ready localllm "${PILOT}/runbook.md" "" propose
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES="Infrastructure" >"${CASE_DIR}/out"
  assert_blocked BOXP-792 '参照許可 root 外'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  assert_runbook_unchanged
}

test_propose_facts_must_cite_read_notes_then_one_correction() {
  setup; echo propose-bad-sources >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-793|BOXP-793: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-793 ready localllm "${PILOT}/runbook.md" "${CORPUS}" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  # 3 research + rejected proposal (no verify) + corrected proposal + verify
  [[ "$(request_count)" == 6 ]] || fail "expected 6 requests, got $(request_count)"
  assert_file_contains "${VAULT}/Tickets/BOXP-793.md" '^status: review$'
  local note="${VAULT}/${PILOT}/runbook.md"
  assert_canon_intact "${note}"
  assert_file_contains "${note}" '出典: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]'
  assert_file_not_contains "${note}" 'design-v1\]\]'
  local audit
  audit="$(find "${STATE}/runs/BOXP-793" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':corrections 1'
}

test_propose_needs_human_and_invalid_mode_block_without_writing() {
  setup; echo propose-needs-human >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-794|BOXP-794: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-794 ready localllm "${PILOT}/runbook.md" "${CORPUS}" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-794 'category=localllm-needs-human'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-794.md" 'どの人物の依頼か判別できません'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" '提案（未承認）'
  # unknown docs-mode: blocked before any request
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-795|BOXP-795: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-795 ready localllm "${PILOT}/runbook.md" "${CORPUS}" banana
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-795 'category=localllm-invalid-mode'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  assert_runbook_unchanged
}

test_propose_rejects_result_markers_in_the_proposal() {
  setup; echo propose-marker >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-796|BOXP-796: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-796 ready localllm "${PILOT}/runbook.md" "${CORPUS}" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-796 'category=localllm-invalid-proposal'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" '提案（未承認）'
  # proposal + one correction (same bad answer), no verify call for a rejected answer
  [[ "$(request_count)" == 5 ]] || fail "expected 5 requests (3 research + 2 proposals), got $(request_count)"
}

test_propose_without_a_corpus_cites_the_target_and_verifies_against_it() {
  setup; echo propose-canon-rewrite >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-797|BOXP-797: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-797 ready localllm "${PILOT}/runbook.md" "" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  # no research; the target canon alone is checked: proposal + verify
  [[ "$(request_count)" == 2 ]] || fail "expected 2 requests, got $(request_count)"
  [[ "$(grep -c ':schema-name "docs_setting_verify"' "${REQ_LOG}")" == 1 ]] || fail "expected one verify request"
  assert_file_contains "${VAULT}/Tickets/BOXP-797.md" '^status: review$'
  local note="${VAULT}/${PILOT}/runbook.md"
  assert_canon_intact "${note}"
  assert_file_contains "${note}" '^## 提案（未承認）BOXP-797$'
  assert_file_contains "${note}" '出典: \[\[Projects/task-board-localllm-docs/pilot/runbook\]\]'
  local audit
  audit="$(find "${STATE}/runs/BOXP-797" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':status :checked'
}

test_propose_heading_only_answer_is_rejected_and_titles_stay_inside_the_section() {
  setup; echo propose-heading-only >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-798|BOXP-798: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-798 ready localllm "${PILOT}/runbook.md" "${CORPUS}" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-798 'category=localllm-invalid-proposal'
  assert_runbook_unchanged
  assert_file_not_contains "${VAULT}/${PILOT}/runbook.md" '提案（未承認）'
  # a title / bullet carrying a newline + heading must not open a sibling section
  setup; echo propose-escaping-title >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-799|BOXP-799: setting]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-799 ready localllm "${PILOT}/runbook.md" "${CORPUS}" propose
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-799.md" '^status: review$'
  local note="${VAULT}/${PILOT}/runbook.md"
  assert_canon_intact "${note}"
  assert_file_not_contains "${note}" '^## 偽の節'
  assert_file_not_contains "${note}" '^## もう一つの偽の節'
  assert_file_contains "${note}" '^\*\*題名\*\*: 案 幽霊 ## 偽の節（canon のふり）$'
  assert_file_not_contains "${note}" '\[\[Unknown/ghost'
  assert_file_contains "${note}" '^- 行 1 Unknown/ghost2 ## もう一つの偽の節$'
  [[ "$(sed -n '/^## 提案（未承認）BOXP-799$/,$p' "${note}" | grep -c '^## ')" == 1 ]] || fail "no level-2 heading may follow the proposal heading"
}

# ---------------------------------------------------------------------------
# Create mode (docs-mode: create, BOXP-282): new character / monster notes
# under the proposal root, vault-wide read root with exclusions
# ---------------------------------------------------------------------------

PROPOSALS="Projects/task-board-localllm-docs/proposals"

write_create_ticket() {
  local vault="$1" ticket="$2" status="$3" summary="$4" docs_kind="${5-}" docs_sources="${6-}"
  {
    printf -- '---\nid: %s\ntype: task\nstatus: %s\npriority: medium\nassignee: localllm\nrepo:\ndocs-mode: create\n' "${ticket}" "${status}"
    if [[ -n "${docs_kind}" ]]; then printf 'docs-kind: %s\n' "${docs_kind}"; fi
    if [[ -n "${docs_sources}" ]]; then printf 'docs-sources: %s\n' "${docs_sources}"; fi
    printf -- 'closed:\n---\n\n# %s: 設定追加\n\n## Summary\n\n%s\n\n## Acceptance Criteria\n\n- [ ] 作成済み\n\n## Context\n\n- なし\n\n## Plan\n\n- [ ] 作業\n\n## Notes\n\n- 2026-10-23: 開始\n' "${ticket}" "${summary}"
  } >"${vault}/Tickets/${ticket}.md"
}

proposal_count() { find "${VAULT}/${PROPOSALS}" -name '*.md' 2>/dev/null | wc -l | tr -d ' '; }

test_create_makes_an_unapproved_note_revises_it_and_rolls_back() {
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-800|BOXP-800: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-800 ready "灯火街に灯籠組合の見習いの新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_no_cloud
  # search -> read -> finish -> create -> verify
  [[ "$(request_count)" == 5 ]] || fail "expected 5 requests (3 research + create + verify), got $(request_count)"
  [[ "$(grep -c ':schema-name "docs_setting_create"' "${REQ_LOG}")" == 1 ]] || fail "expected one create request"
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '新規キャラクター設定の提案ノートを 作成 し Review で停止しました'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '参照した既存設定 1 件、矛盾・要確認 4 件（うち自動検査 3 件、名前が近い既存ノート 0 件）、質問 1 件'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '未解決の wikilink を平文化 1 件'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" "対象: \[\[${PROPOSALS}/characters/hotaru-lantern-keeper\]\]（新規）"
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '操作: create-note'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '出典: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]'
  # model text never reaches Notes
  assert_file_not_contains "${VAULT}/Tickets/BOXP-800.md" 'CREATE-BODY|CREATE-SUMMARY|灯守ホタル'
  local note="${VAULT}/${PROPOSALS}/characters/hotaru-lantern-keeper.md"
  [[ -f "${note}" ]] || fail "proposal note must be created"
  [[ "$(proposal_count)" == 1 ]] || fail "exactly one proposal note, got $(proposal_count)"
  assert_runbook_unchanged
  assert_file_contains "${note}" '^title: "灯守ホタル"$'
  assert_file_contains "${note}" '^type: character-proposal$'
  assert_file_contains "${note}" '^status: unapproved$'
  assert_file_contains "${note}" '^localllm-proposal: true$'
  assert_file_contains "${note}" '^ticket: BOXP-800$'
  assert_file_contains "${note}" '^  - "ホタル"$'
  [[ "$(grep -c '^  - ' "${note}")" == 1 ]] || fail "alias equal to the name must be dropped"
  assert_file_contains "${note}" '^# 灯守ホタル$'
  assert_file_contains "${note}" '未承認の提案'
  assert_file_contains "${note}" 'CREATE-SUMMARY'
  assert_file_contains "${note}" '^## プロフィール$'
  assert_file_contains "${note}" 'CREATE-BODY'
  # a heading inside a section body becomes bold; an empty section is marked, not invented
  assert_file_contains "${note}" '^\*\*役割\*\*$'
  assert_file_not_contains "${note}" '^## 役割$'
  assert_file_contains "${note}" '^## 関係性$'
  assert_file_contains "${note}" '^未定（要確認）$'
  # monster sections are not rendered on a character note
  assert_file_not_contains "${note}" '^## 生態$'
  # wikilinks: resolved note kept, invented one plain
  assert_file_contains "${note}" '\[\[Projects/task-board-localllm-docs/refs/corpus/design-v2|設計\]\]'
  assert_file_not_contains "${note}" '\[\[Unknown/ghost-note'
  assert_file_contains "${note}" '架空'
  assert_file_contains "${note}" '^## 参照した既存設定（出典）$'
  assert_file_contains "${note}" '^- 待受ポートは 8081 である（出典: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]）$'
  assert_file_contains "${note}" '^## 矛盾・要確認$'
  assert_file_contains "${note}" '^- AUTO-CONFLICT: 案の藍は design-v2 の記述と食い違う（自動検査）$'
  assert_file_contains "${note}" '^## 人への質問$'
  assert_file_not_contains "${note}" 'TASK_BOARD_RESULT'
  local audit run1
  audit="$(find "${STATE}/runs/BOXP-800" -name localllm-audit.edn | head -n 1)"
  run1="$(basename "$(dirname "${audit}")")"
  assert_file_contains "${audit}" ':mode "create"'
  assert_file_contains "${audit}" ':op "create-note"'
  assert_file_contains "${audit}" ':kind-resolution :keywords'
  assert_file_contains "${audit}" ':created\? true'
  # Review re-run: the ticket's own note is found and its body replaced (frontmatter kept, no second note)
  write_board "${VAULT}" Review "- [ ] [[Tickets/BOXP-800|BOXP-800: 新キャラ]] #ticket status::review"
  write_create_ticket "${VAULT}" BOXP-800 review "灯火街に灯籠組合の見習いの新しいキャラを追加してほしい。" "" "${CORPUS}"
  printf -- '- 2026-10-23: boxp: 口調をもう少し明るくしてください\n' >>"${VAULT}/Tickets/BOXP-800.md"
  : >"${REQ_LOG}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out2"
  assert_file_contains "${REQ_LOG}" ':revise\? true'
  grep -q ':prev-create? true' "${REQ_LOG}" || fail "revision must show the previous note body separately"
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '新規キャラクター設定の提案ノートを 改稿（置換） し Review で停止しました'
  # the frontmatter follows the revision (aliases) while created / run / slug / ticket are carried over
  assert_file_contains "${note}" '^  - "蛍"$'
  assert_file_contains "${note}" '^slug: hotaru-lantern-keeper$'
  [[ "$(proposal_count)" == 1 ]] || fail "revision must not create a second note"
  assert_file_contains "${note}" 'CREATE-REVISED'
  assert_file_not_contains "${note}" 'CREATE-SUMMARY'
  assert_file_contains "${note}" "^run: ${run1}$"
  assert_file_contains "${note}" '^ticket: BOXP-800$'
  # rollback: the revision is restored from its backup, then the creation is undone (note removed)
  local run2
  run2="$(ls -t "${STATE}/runs/BOXP-800" | head -n 1)"
  [[ "${run2}" != "${run1}" ]] || fail "second run id expected"
  CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" bb "${RUNNER}" localllm-rollback BOXP-800 "${run2}" >"${CASE_DIR}/rb2" 2>&1 || fail "rollback 2 failed: $(cat "${CASE_DIR}/rb2")"
  assert_file_contains "${note}" 'CREATE-SUMMARY'
  CODEX_TASK_BOARD_VAULT="${VAULT}" CODEX_TASK_BOARD_ROOT="${STATE}" bb "${RUNNER}" localllm-rollback BOXP-800 "${run1}" >"${CASE_DIR}/rb1" 2>&1 || fail "rollback 1 failed: $(cat "${CASE_DIR}/rb1")"
  [[ ! -e "${note}" ]] || fail "rollback of the creating run must remove the note"
  assert_runbook_unchanged
}

test_create_kind_comes_from_docs_kind_or_wording_or_is_asked_without_a_request() {
  # declared kind wins over wording-free summaries; monster sections are rendered
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-801|BOXP-801: 追加]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-801 ready "山あいの沢に棲む新しい存在を 1 種考えてほしい。" monster "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-801.md" '新規魔物設定の提案ノートを 作成 し Review で停止しました'
  local note="${VAULT}/${PROPOSALS}/monsters/hotaru-lantern-keeper.md"
  [[ -f "${note}" ]] || fail "monster note must be created under monsters/"
  assert_file_contains "${note}" '^type: monster-proposal$'
  assert_file_contains "${note}" '^## 生態$'
  assert_file_contains "${note}" '^## 弱点・対処$'
  assert_file_not_contains "${note}" '^## プロフィール$'
  [[ ! -e "${VAULT}/${PROPOSALS}/characters/hotaru-lantern-keeper.md" ]] || fail "no character note expected"
  local audit
  audit="$(find "${STATE}/runs/BOXP-801" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':kind-resolution :declared'
  # both kinds in the wording and no docs-kind: ask, no model call, nothing written
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-802|BOXP-802: 追加]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-802 ready "魔物使いのキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-802 '両方の語があり種別を決められません'
  [[ "$(request_count)" == 0 ]] || fail "no request expected for an ambiguous kind"
  [[ "$(proposal_count)" == 0 ]] || fail "nothing may be written"
  # no kind word at all
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-803|BOXP-803: 追加]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-803 ready "何か新しい設定を足してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-803 '種別が分かりません'
  [[ "$(request_count)" == 0 ]] || fail "no request expected for an unknown kind"
  # no corpus at all (no docs-sources, no default corpus): no model call, nothing written
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-815|BOXP-815: 追加]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-815 ready "新しいキャラを追加してほしい。" "" ""
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-815 '参照する設定資料が必要です'
  [[ "$(request_count)" == 0 ]] || fail "no request expected without a corpus"
  [[ "$(proposal_count)" == 0 ]] || fail "nothing may be written"
  # unknown docs-kind value
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-804|BOXP-804: 追加]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-804 ready "新しいキャラを追加してほしい。" item "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-804 'docs-kind は character / monster'
  [[ "$(request_count)" == 0 ]] || fail "no request expected for a bad docs-kind"
}

test_create_name_and_slug_collisions_get_one_correction_then_block() {
  # name equal to a corpus note title: rejected once, corrected answer accepted
  setup; echo create-conflict >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-805|BOXP-805: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-805 ready "新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  [[ "$(grep -c ':schema-name "docs_setting_create"' "${REQ_LOG}")" == 2 ]] || fail "expected one correction round"
  assert_file_contains "${VAULT}/Tickets/BOXP-805.md" '^status: review$'
  [[ -f "${VAULT}/${PROPOSALS}/characters/hotaru-lantern-keeper.md" ]] || fail "corrected note expected"
  [[ ! -e "${VAULT}/${PROPOSALS}/characters/design-v2-dup.md" ]] || fail "the colliding note must not be written"
  local audit
  audit="$(find "${STATE}/runs/BOXP-805" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':corrections 1'
  # the collision persists: Blocked, nothing written
  setup; echo create-conflict-persist >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-806|BOXP-806: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-806 ready "新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-806 '既存ノートの名前と同じです'
  [[ "$(proposal_count)" == 0 ]] || fail "nothing may be written on a persistent collision"
  # an invalid slug is re-asked once
  setup; echo create-bad-slug >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-807|BOXP-807: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-807 ready "新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-807.md" '^status: review$'
  [[ "$(proposal_count)" == 1 ]] || fail "one note expected after the slug correction"
  # another ticket's proposal already uses the name / slug: never overwritten
  setup; echo create >"${MODE_FILE}"
  mkdir -p "${VAULT}/${PROPOSALS}/characters"
  printf -- '---\ntitle: "灯守ホタル"\ntype: character-proposal\nstatus: unapproved\nlocalllm-proposal: true\nticket: BOXP-700\n---\n\n# 灯守ホタル\n\nOTHER-TICKET-NOTE\n' >"${VAULT}/${PROPOSALS}/characters/hotaru-lantern-keeper.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-808|BOXP-808: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-808 ready "新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-808 '既に存在します|既存ノートの名前と同じです'
  assert_file_contains "${VAULT}/${PROPOSALS}/characters/hotaru-lantern-keeper.md" 'OTHER-TICKET-NOTE'
  [[ "$(proposal_count)" == 1 ]] || fail "the other ticket's note must be the only one"
}

test_create_needs_human_and_result_markers_block_without_writing() {
  setup; echo create-needs-human >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-809|BOXP-809: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-809 ready "新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-809 'localllm は新規設定を提案せず人間判断を求めました'
  assert_file_not_contains "${VAULT}/Tickets/BOXP-809.md" 'どの作品の依頼か判別できません'
  [[ "$(proposal_count)" == 0 ]] || fail "nothing may be written"
  setup; echo create-marker >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-810|BOXP-810: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-810 ready "新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-810 'runner の結果マーカー'
  [[ "$(proposal_count)" == 0 ]] || fail "nothing may be written"
}

test_create_refuses_raw_credential_values_and_redacts_wikilinked_references() {
  setup; echo create-raw-token >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-813|BOXP-813: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-813 ready "新しいキャラを追加してほしい。" "" "${CORPUS}"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-813 '認証情報らしき値'
  [[ "$(proposal_count)" == 0 ]] || fail "a note with a raw token value must not be written"
  # a reference note reached by wikilink from the ticket (vault-wide read root) is redacted like the corpus
  setup; echo normal >"${MODE_FILE}"
  printf -- '---\ntitle: 監視メモ\n---\n\n# 監視メモ\n\n- 監視は毎朝。CREDS-NOTE-BODY\n- token: ghp_abcdefghijklmnopqrstuvwxyz0123 SECRET-LINE-TOKEN-VALUE\n' >"${VAULT}/Infrastructure/creds-note.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-814|BOXP-814: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-814 ready localllm "${PILOT}/runbook.md"
  printf -- '- 2026-10-23: 参考: [[Infrastructure/creds-note]]\n' >>"${VAULT}/Tickets/BOXP-814.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS="." >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-814.md" '^status: review$'
  grep -q ':sees-redaction-marker? true' "${REQ_LOG}" || fail "the wikilinked reference must be redacted"
  assert_file_not_contains "${REQ_LOG}" ':sees-token-value\? true'
}

# ---------------------------------------------------------------------------
# Natural-language tickets (BOXP-290): no docs-mode / docs-kind / docs-sources /
# docs-target, only `assignee: localllm` and the request wording; the runner
# grooms Backlog cards itself, infers the mode, and refuses a Review re-run
# without a new human Note.
# ---------------------------------------------------------------------------

write_nl_ticket() {
  local vault="$1" ticket="$2" status="$3" assignee="$4" title="$5" summary="$6"
  shift 6
  {
    printf -- '---\nid: %s\ntype: task\nstatus: %s\npriority: medium\nassignee: %s\nrepo:\n' "${ticket}" "${status}" "${assignee}"
    for extra in "$@"; do printf '%s\n' "${extra}"; done
    printf -- 'closed:\n---\n\n# %s: %s\n\n## Summary\n\n%s\n\n## Acceptance Criteria\n\n- [ ] \n\n## Context\n\n- 背景:\n- 関連リンク:\n- 関連ノート:\n\n## Plan\n\n- [ ] 調査\n- [ ] 実装または作業\n- [ ] 確認\n\n## Notes\n\n作業ログや判断メモを書く。\n' "${ticket}" "${title}" "${summary}"
  } >"${vault}/Tickets/${ticket}.md"
}

groom_tick() { run_tick "$1" "$2" env CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES="${CORPUS}" "${@:3}"; }

assert_groom_blocked() {
  local ticket="$1" reason_re="$2"
  assert_file_contains "${VAULT}/Tickets/${ticket}.md" '^status: blocked$'
  assert_file_contains "${VAULT}/Tickets/${ticket}.md" '^assignee: boxp$'
  assert_file_contains "${VAULT}/Tickets/${ticket}.md" "localllm groom run .* は票を整理できず停止しました.*${reason_re}"
  [[ "$(request_count)" == 0 ]] || fail "groom must not call the model"
  [[ "$(proposal_count)" == 0 ]] || fail "groom must not write documents"
}

test_natural_language_backlog_card_is_groomed_then_runs_revises_and_refuses_an_unchanged_review() {
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-820|BOXP-820: 新キャラ]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-820 backlog localllm "新キャラを 1 名追加" "灯火街に灯籠組合の見習いの新しいキャラを 1 名追加してほしい。既存の人物の事実は変えない。[[Projects/task-board-localllm-docs/refs/corpus/design-v2]] は必ず読むこと。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_no_cloud
  [[ "$(request_count)" == 0 ]] || fail "groom must not call the model"
  [[ "$(proposal_count)" == 0 ]] || fail "groom must not create notes"
  local ticket="${VAULT}/Tickets/BOXP-820.md"
  assert_file_contains "${VAULT}/Boards/Task Board.md" '\[\[Tickets/BOXP-820\|.*status::ready'
  assert_file_contains "${ticket}" '^status: ready$'
  assert_file_contains "${ticket}" '^assignee: boxp$'
  # the decision is pinned for the owner to see and override
  assert_file_contains "${ticket}" '^docs-mode: create$'
  assert_file_contains "${ticket}" '^docs-kind: character$'
  assert_file_not_contains "${ticket}" '^docs-sources:'
  # template sections are replaced by the groom, the owner's Summary is untouched
  assert_file_contains "${ticket}" '灯籠組合の見習いの新しいキャラ'
  assert_file_not_contains "${ticket}" '^- 背景:$'
  assert_file_not_contains "${ticket}" '^- \[ \] 実装または作業$'
  assert_file_contains "${ticket}" '用途 = 新規キャラクター設定の作成（create / character、題名の語から判定）'
  assert_file_contains "${ticket}" "参照資料: runner 既定の corpus \`${CORPUS}\`（2 ノート / [0-9]+ 字。フォルダ: ${CORPUS}/ 2）"
  assert_file_contains "${ticket}" '必読候補（path と題名だけで runner が選定、本文は未読。実行時に優先して read する）: \[\[Projects/task-board-localllm-docs/refs/corpus/design-v2\]\]'
  assert_file_contains "${ticket}" "^- \[ \] \`${PROPOSALS}/characters/\` に未承認の新規ノート 1 件が作成され"
  assert_file_contains "${ticket}" '^- \[ \] 調査: corpus を index → list / search → read'
  assert_file_contains "${ticket}" 'localllm groom run .* が票を整理し Ready に置きました（runner の決定的な整理で、モデル呼出・文書の書込・外部操作はありません）。 用途=create/character（title-keywords）, corpus=default .* 2 ノート, 必読候補 1 件, frontmatter 固定: docs-mode=create, docs-kind=character。実行するにはこの票の assignee を localllm に戻してください'
  # corpus bodies never reach the ticket
  assert_file_not_contains "${ticket}" 'CORPUS-BODY-MARKER'
  local groom_run
  groom_run="$(ls "${STATE}/runs/BOXP-820")"
  assert_file_contains "${STATE}/runs/BOXP-820/${groom_run}/localllm-groom.edn" ':mode-resolution :title-keywords'
  assert_file_contains "${STATE}/runs/BOXP-820/${groom_run}/summary.edn" ':result "ready"'
  # a groomed card in Ready with assignee boxp is not a candidate: nothing runs on its own
  : >"${REQ_LOG}"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out-idle"
  [[ "$(request_count)" == 0 ]] || fail "Ready + boxp must not run"
  assert_file_contains "${ticket}" '^status: ready$'
  # owner approval = assignee back to localllm; the normal scheduler runs the create (default corpus, no docs-sources)
  sed -i 's/^assignee: boxp$/assignee: localllm/' "${ticket}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-820|BOXP-820: 新キャラ]] #ticket status::ready"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out2"
  assert_no_cloud
  [[ "$(grep -c ':schema-name "docs_setting_create"' "${REQ_LOG}")" == 1 ]] || fail "expected one create request"
  assert_file_contains "${ticket}" '^status: review$'
  assert_file_contains "${ticket}" '^assignee: boxp$'
  assert_file_contains "${ticket}" '新規キャラクター設定の提案ノートを 作成 し Review で停止しました'
  local note="${VAULT}/${PROPOSALS}/characters/hotaru-lantern-keeper.md"
  [[ -f "${note}" ]] || fail "proposal note must be created"
  [[ "$(proposal_count)" == 1 ]] || fail "exactly one proposal note"
  assert_runbook_unchanged
  local create_run audit
  create_run="$(ls -t "${STATE}/runs/BOXP-820" | head -n 1)"
  audit="${STATE}/runs/BOXP-820/${create_run}/localllm-audit.edn"
  assert_file_contains "${audit}" ':docs-sources-origin :default'
  assert_file_contains "${audit}" ':mode-resolution :declared'
  # Review re-run with the assignee flipped back but no new human Note: refused before any request
  : >"${REQ_LOG}"
  sed -i 's/^assignee: boxp$/assignee: localllm/' "${ticket}"
  write_board "${VAULT}" Review "- [ ] [[Tickets/BOXP-820|BOXP-820: 新キャラ]] #ticket status::review"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out3"
  assert_blocked BOXP-820 'category=localllm-no-new-instruction'
  assert_file_contains "${ticket}" '前回の localllm 結果より新しい指示が Notes にありません'
  [[ "$(request_count)" == 0 ]] || fail "an unchanged Review card must not reach the model"
  assert_file_contains "${note}" 'CREATE-SUMMARY'
  [[ "$(proposal_count)" == 1 ]] || fail "no second note"
  # Review + a new human Note + assignee back: the same note is revised (ordinary Board operation)
  : >"${REQ_LOG}"
  sed -i 's/^assignee: boxp$/assignee: localllm/; s/^status: blocked$/status: review/' "${ticket}"
  printf -- '- 2026-10-24: boxp: 口調をもう少し明るくし、年齢は 15 歳にしてください。名前は変えないでください。\n' >>"${ticket}"
  write_board "${VAULT}" Review "- [ ] [[Tickets/BOXP-820|BOXP-820: 新キャラ]] #ticket status::review"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out4"
  assert_file_contains "${REQ_LOG}" ':revise\? true'
  grep -q ':prev-create? true' "${REQ_LOG}" || fail "revision must show the previous note body"
  assert_file_contains "${ticket}" '新規キャラクター設定の提案ノートを 改稿（置換） し Review で停止しました'
  assert_file_contains "${ticket}" '^status: review$'
  assert_file_contains "${ticket}" '^assignee: boxp$'
  assert_file_contains "${note}" 'CREATE-REVISED'
  assert_file_not_contains "${note}" 'CREATE-SUMMARY'
  [[ "$(proposal_count)" == 1 ]] || fail "revision must not create a second note"
  local revise_run
  revise_run="$(ls -t "${STATE}/runs/BOXP-820" | head -n 1)"
  assert_file_contains "${STATE}/runs/BOXP-820/${revise_run}/localllm-audit.edn" ':mode-resolution :declared'
  assert_runbook_unchanged
}

test_natural_language_ready_card_infers_create_without_groom_and_explicit_sources_still_win() {
  # Ready directly (no groom): 「新怪獣」 in the title decides monster even though the Summary names 人物 too
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-821|BOXP-821: 新怪獣]] #ticket status::ready"
  write_nl_ticket "${VAULT}" BOXP-821 ready localllm "新怪獣を 1 種追加" "山あいの沢に出る新しい怪獣を 1 種考えてほしい。既存の怪獣・人物・組織の事実は変えない。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_no_cloud
  assert_file_contains "${VAULT}/Tickets/BOXP-821.md" '新規魔物設定の提案ノートを 作成 し Review で停止しました'
  [[ -f "${VAULT}/${PROPOSALS}/monsters/hotaru-lantern-keeper.md" ]] || fail "monster note expected"
  local audit
  audit="$(find "${STATE}/runs/BOXP-821" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':mode-resolution :title-keywords'
  assert_file_contains "${audit}" ':kind-resolution :title-keywords'
  assert_file_contains "${audit}" ':docs-sources-origin :default'
  # an explicit docs-sources on an older card is used as declared, never swapped for the default corpus
  setup; echo create >"${MODE_FILE}"
  mkdir -p "${VAULT}/Projects/task-board-localllm-docs/refs/other"
  printf -- '---\ntitle: other world\n---\n\n# other world\n\n## 構成\n\n- 別世界。OTHER-WORLD-BODY\n' >"${VAULT}/Projects/task-board-localllm-docs/refs/other/world.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-822|BOXP-822: 新キャラ]] #ticket status::ready"
  write_nl_ticket "${VAULT}" BOXP-822 ready localllm "新キャラ追加" "新しいキャラを追加してほしい。" "docs-sources: Projects/task-board-localllm-docs/refs/other"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  audit="$(find "${STATE}/runs/BOXP-822" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':docs-sources-origin :declared'
  assert_file_contains "${audit}" ':docs-sources \["Projects/task-board-localllm-docs/refs/other"\]'
  grep -q 'CORPUS-BODY-MARKER' "${REQ_LOG}" && fail "the default corpus must not replace an explicit docs-sources"
  # an explicit docs-mode wins over the wording (propose on the declared target, not create)
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-823|BOXP-823: setting]] #ticket status::ready"
  write_nl_ticket "${VAULT}" BOXP-823 ready localllm "新キャラの衣装" "新しいキャラの冬祭り用の装いの案。" "docs-mode: propose" "docs-target: ${PILOT}/runbook.md"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^## 提案（未承認）BOXP-823$'
  [[ "$(proposal_count)" == 0 ]] || fail "no note may be created when docs-mode says propose"
  audit="$(find "${STATE}/runs/BOXP-823" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':mode-resolution :declared'
}

test_natural_language_propose_target_comes_from_one_wikilink_inside_the_write_roots() {
  # groom: addition verb + one wikilink inside the pilot -> propose pinned with the target
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-824|BOXP-824: 加筆]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-824 backlog localllm "runbook に加筆" "[[${PILOT}/runbook]] に冬祭り用の新しい装いの案を加筆してほしい。普段の色遣いを引き継ぐこと。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  local ticket="${VAULT}/Tickets/BOXP-824.md"
  [[ "$(request_count)" == 0 ]] || fail "groom must not call the model"
  assert_file_contains "${ticket}" '^status: ready$'
  assert_file_contains "${ticket}" '^docs-mode: propose$'
  assert_file_contains "${ticket}" "^docs-target: ${PILOT}/runbook.md$"
  assert_file_contains "${ticket}" "用途 = \[\[${PILOT}/runbook\]\] への提案節の追加（propose、Summary の加筆語と wikilink の 1 件から判定）"
  assert_file_contains "${ticket}" "^- \[ \] \[\[${PILOT}/runbook\]\] の末尾に『提案（未承認）BOXP-824』節が 1 つだけ追加され"
  assert_runbook_unchanged
  # approval: the Ready run appends the section (default corpus researched)
  sed -i 's/^assignee: boxp$/assignee: localllm/' "${ticket}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-824|BOXP-824: 加筆]] #ticket status::ready"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out2"
  assert_file_contains "${ticket}" '^status: review$'
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^## 提案（未承認）BOXP-824$'
  grep -q 'v1.2' "${VAULT}/${PILOT}/runbook.md" || fail "canon must be unchanged"
  # Ready directly, no groom: the same inference applies at run time
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-825|BOXP-825: 加筆]] #ticket status::ready"
  write_nl_ticket "${VAULT}" BOXP-825 ready localllm "runbook に追記" "[[${PILOT}/runbook]] に新しい装いの案を追記してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/${PILOT}/runbook.md" '^## 提案（未承認）BOXP-825$'
  local audit
  audit="$(find "${STATE}/runs/BOXP-825" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':mode-resolution :wikilink'
  assert_file_contains "${audit}" ':mode "propose"'
}

test_natural_language_unclear_requests_stop_with_one_question_and_no_model_call() {
  # addition to a canon note outside the write roots: question, never a write (roots are not widened)
  setup; echo propose >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-830|BOXP-830: 加筆]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-830 backlog localllm "design v2 に加筆" "[[Projects/task-board-localllm-docs/refs/corpus/design-v2]] に新しい装いの案を加筆してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-830 '提案節を書ける範囲（書込許可 root: .*）外'
  [[ "$(cat "${VAULT}/Projects/task-board-localllm-docs/refs/corpus/design-v2.md")" == *'CORPUS-BODY-MARKER'* ]] || fail "canon must be untouched"
  grep -q '提案（未承認）' "${VAULT}/Projects/task-board-localllm-docs/refs/corpus/design-v2.md" && fail "no section may be written outside the write roots"
  # both an addition verb and a kind word: question
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-831|BOXP-831: 加筆]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-831 backlog localllm "新キャラとの関係を加筆" "[[${PILOT}/runbook]] に新しいキャラとの関係を加筆してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-831 '加筆（提案節）と新しいキャラクター / 魔物の作成の両方と読めます'
  # addition verb without any wikilink: question
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-832|BOXP-832: 加筆]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-832 backlog localllm "設定を加筆" "冬祭りの装いの案を加筆してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-832 '加筆先のノートが分かりません'
  # two wikilinks: question
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-833|BOXP-833: 加筆]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-833 backlog localllm "加筆" "[[${PILOT}/runbook]] か [[Infrastructure/prod]] に装いの案を加筆してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-833 'wikilink が 2 件あり 1 件に決められません'
  # neither a kind word nor an addition: question
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-834|BOXP-834: 何か]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-834 backlog localllm "何か設定を" "何か新しい設定を足してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-834 '依頼の用途が分かりません'
  # both kinds, no title decision: question (kind)
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-835|BOXP-835: 追加]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-835 backlog localllm "追加" "魔物使いのキャラを追加してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-835 '両方の語があり種別を決められません'
  # an imperative rewrite of existing canon: refused with the reason (a 「変えない」 constraint is not)
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-836|BOXP-836: 新キャラ]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-836 backlog localllm "新キャラ追加" "新しいキャラを追加し、既存の設定ノートの年齢を書き換えてほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-836 '既存設定（canon）の書き換え・削除と読める依頼'
  # no corpus at all for a create: question, no request
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-837|BOXP-837: 新キャラ]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-837 backlog localllm "新キャラ追加" "新しいキャラを追加してほしい。"
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-837 '既定 corpus（CODEX_TASK_BOARD_LOCALLLM_DEFAULT_SOURCES）も空です'
  # the same questions at run time (Ready, no groom): Blocked by the docs run, no request
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-838|BOXP-838: 何か]] #ticket status::ready"
  write_nl_ticket "${VAULT}" BOXP-838 ready localllm "何か設定を" "何か新しい設定を足してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_blocked BOXP-838 'category=localllm-unclear-request'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  [[ "$(proposal_count)" == 0 ]] || fail "nothing may be written"
  # a Blocked groom card, corrected by the owner and put back to Backlog, is groomed again
  setup; echo create >"${MODE_FILE}"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-839|BOXP-839: 何か]] #ticket status::backlog"
  write_nl_ticket "${VAULT}" BOXP-839 backlog localllm "何か設定を" "何か新しい設定を足してほしい。"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out"
  assert_groom_blocked BOXP-839 '依頼の用途が分かりません'
  sed -i 's/^status: blocked$/status: backlog/; s/^assignee: boxp$/assignee: localllm/; s/^# BOXP-839: 何か設定を$/# BOXP-839: 新しい怪獣を 1 種/' "${VAULT}/Tickets/BOXP-839.md"
  write_board "${VAULT}" Backlog "- [ ] [[Tickets/BOXP-839|BOXP-839: 新怪獣]] #ticket status::backlog"
  groom_tick "${VAULT}" "${STATE}" >"${CASE_DIR}/out2"
  assert_file_contains "${VAULT}/Tickets/BOXP-839.md" '^status: ready$'
  assert_file_contains "${VAULT}/Tickets/BOXP-839.md" '^docs-kind: monster$'
  # the earlier question stays in Notes, the groom items are appended once per groom run
  assert_file_contains "${VAULT}/Tickets/BOXP-839.md" '依頼の用途が分かりません'
  [[ "$(grep -c '^- localllm groom（runner の自動整理' "${VAULT}/Tickets/BOXP-839.md")" == 1 ]] || fail "one groom context block expected"
}

test_vault_wide_read_root_excludes_tickets_hidden_dirs_and_proposals_and_redacts_secret_lines() {
  setup; echo create-vaultwide >"${MODE_FILE}"
  # a note holding a credential-looking line, a hidden dir note, another ticket's
  # proposal, a stray note marked as our proposal, and 70 padding notes (tree index)
  printf -- '---\ntitle: 監視メモ\n---\n\n# 監視メモ\n\n## 監視\n\n- 監視は毎朝。CREDS-NOTE-BODY\n- token: ghp_abcdefghijklmnopqrstuvwxyz0123 SECRET-LINE-TOKEN-VALUE\n' >"${VAULT}/Infrastructure/creds-note.md"
  mkdir -p "${VAULT}/.obsidian" "${VAULT}/${PROPOSALS}/characters" "${VAULT}/Archive/notes"
  printf -- '# workspace\n\nHIDDEN-NOTE-BODY\n' >"${VAULT}/.obsidian/workspace.md"
  printf -- '---\ntitle: "他票の案"\nlocalllm-proposal: true\nticket: BOXP-700\n---\n\n# 他票の案\n\nOTHER-PROPOSAL-BODY\n' >"${VAULT}/${PROPOSALS}/characters/other-ticket.md"
  printf -- '---\ntitle: stray\nlocalllm-proposal: true\n---\n\n# stray\n\nSTRAY-PROPOSAL-BODY\n' >"${VAULT}/Infrastructure/stray-proposal.md"
  for i in $(seq 1 70); do printf -- '---\ntitle: memo %s\n---\n\n# memo %s\n\n## 本文\n\n- padding\n' "$i" "$i" >"${VAULT}/Archive/notes/memo-${i}.md"; done
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-800|BOXP-800: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-800 ready "新しいキャラを追加してほしい。" "" "."
  # a small index budget stands in for a vault-sized corpus: the flat listing does not fit, so the folder tree is shown
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS="." CODEX_TASK_BOARD_LOCALLLM_INDEX_CHAR_BUDGET=1500 CODEX_TASK_BOARD_LOCALLLM_MAX_READS_PER_ROUND=5 >"${CASE_DIR}/out"
  assert_no_cloud
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '^status: review$'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '出典: \[\[Infrastructure/creds-note\]\]'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" 'list 1, read 1'
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '秘匿行の除去 1 行'
  # the model saw the folder tree, the list result and the redaction marker, never the token value
  grep -q ':sees-tree-index? true' "${REQ_LOG}" || fail "a corpus of this size must be shown as a folder tree"
  grep -q ':sees-list-result? true' "${REQ_LOG}" || fail "the list action must return the folder listing"
  grep -q ':sees-redaction-marker? true' "${REQ_LOG}" || fail "the redaction marker must replace the secret line"
  assert_file_not_contains "${REQ_LOG}" ':sees-token-value\? true'
  assert_file_not_contains "${REQ_LOG}" ':mentions-secret\? true'
  local audit
  audit="$(find "${STATE}/runs/BOXP-800" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" ':corpus-redacted-lines 1'
  assert_file_contains "${audit}" ':corpus-proposal-notes 1'
  assert_file_contains "${audit}" ':index-tree\? true'
  assert_file_contains "${audit}" 'read Tickets/BOXP-800.md → 失敗'
  assert_file_contains "${audit}" "read ${PROPOSALS}/characters/other-ticket.md → 失敗"
  assert_file_contains "${audit}" 'read .obsidian/workspace.md → 失敗'
  # nothing from the excluded notes reached a request or Notes
  assert_file_not_contains "${VAULT}/Tickets/BOXP-800.md" 'SECRET-LINE-TOKEN-VALUE|HIDDEN-NOTE-BODY|OTHER-PROPOSAL-BODY|STRAY-PROPOSAL-BODY'
  local note="${VAULT}/${PROPOSALS}/characters/hotaru-lantern-keeper.md"
  [[ -f "${note}" ]] || fail "proposal note expected"
  assert_file_not_contains "${note}" 'SECRET-LINE-TOKEN-VALUE'
  assert_file_contains "${VAULT}/${PROPOSALS}/characters/other-ticket.md" 'OTHER-PROPOSAL-BODY'
  # a custom proposal root is excluded from reads even when EXCLUDE_PATHS does not list it
  setup; echo create-vaultwide >"${MODE_FILE}"
  mkdir -p "${VAULT}/Drafts/llm/characters"
  printf -- '---\ntitle: "他票の案"\nlocalllm-proposal: true\nticket: BOXP-700\n---\n\n# 他票の案\n\nCUSTOM-ROOT-PROPOSAL-BODY\n' >"${VAULT}/Drafts/llm/characters/other-ticket.md"
  printf -- '---\ntitle: 監視メモ\n---\n\n# 監視メモ\n\n## 監視\n\n- 監視は毎朝。\n' >"${VAULT}/Infrastructure/creds-note.md"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-800|BOXP-800: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-800 ready "新しいキャラを追加してほしい。[[Drafts/llm/characters/other-ticket]] も参考に。" "" "."
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS="." CODEX_TASK_BOARD_LOCALLLM_PROPOSAL_ROOT="Drafts/llm" CODEX_TASK_BOARD_LOCALLLM_EXCLUDE_PATHS="Tickets,Boards" >"${CASE_DIR}/out"
  assert_file_contains "${VAULT}/Tickets/BOXP-800.md" '^status: review$'
  [[ -f "${VAULT}/Drafts/llm/characters/hotaru-lantern-keeper.md" ]] || fail "note must be created under the custom proposal root"
  grep -q 'CUSTOM-ROOT-PROPOSAL-BODY' "${REQ_LOG}" && fail "a proposal under the custom root must not reach the model"
  local audit
  audit="$(find "${STATE}/runs/BOXP-800" -name localllm-audit.edn | head -n 1)"
  assert_file_contains "${audit}" 'read Drafts/llm/characters/other-ticket.md → 失敗'
  # without `.` in the read roots a vault-wide docs-sources is refused before any request
  setup; echo create-vaultwide >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-811|BOXP-811: 新キャラ]] #ticket status::ready"
  write_create_ticket "${VAULT}" BOXP-811 ready "新しいキャラを追加してほしい。" "" "."
  run_tick "${VAULT}" "${STATE}" env >"${CASE_DIR}/out"
  assert_blocked BOXP-811 'READ_ROOTS に . が無いため'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  # the vault-wide root never widens the write roots: a transcribe target outside the pilot stays refused
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-812|BOXP-812: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-812 ready localllm "Infrastructure/prod.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS="." >"${CASE_DIR}/out"
  assert_blocked BOXP-812 '許可 root 外'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
  # `.` is read-only: as a write root or proposal root it is ignored (write roots never widen to the vault)
  setup; echo normal >"${MODE_FILE}"
  write_board "${VAULT}" Ready "- [ ] [[Tickets/BOXP-816|BOXP-816: docs]] #ticket status::ready"
  write_ticket "${VAULT}" BOXP-816 ready localllm "Infrastructure/prod.md"
  run_tick "${VAULT}" "${STATE}" env CODEX_TASK_BOARD_LOCALLLM_READ_ROOTS="." CODEX_TASK_BOARD_LOCALLLM_DOCS_ROOTS="." CODEX_TASK_BOARD_LOCALLLM_PROPOSAL_ROOT="." >"${CASE_DIR}/out"
  assert_blocked BOXP-816 '許可 root 外'
  [[ "$(request_count)" == 0 ]] || fail "no request expected"
}

for t in \
  test_credential_additions_are_blocked_by_the_executor \
  test_create_makes_an_unapproved_note_revises_it_and_rolls_back \
  test_create_kind_comes_from_docs_kind_or_wording_or_is_asked_without_a_request \
  test_create_name_and_slug_collisions_get_one_correction_then_block \
  test_create_needs_human_and_result_markers_block_without_writing \
  test_create_refuses_raw_credential_values_and_redacts_wikilinked_references \
  test_natural_language_backlog_card_is_groomed_then_runs_revises_and_refuses_an_unchanged_review \
  test_natural_language_ready_card_infers_create_without_groom_and_explicit_sources_still_win \
  test_natural_language_propose_target_comes_from_one_wikilink_inside_the_write_roots \
  test_natural_language_unclear_requests_stop_with_one_question_and_no_model_call \
  test_vault_wide_read_root_excludes_tickets_hidden_dirs_and_proposals_and_redacts_secret_lines \
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
  test_ticket_brief_drops_runner_notes_and_marks_the_ticket_as_non_source \
  test_absolute_paths_in_the_ticket_are_rejected \
  test_crash_right_after_the_write_is_recovered_from_the_journal \
  test_edit_on_a_later_target_during_the_write_is_detected \
  test_correction_round_over_the_prompt_cap_blocks \
  test_research_finish_without_reads_auto_reads_the_hits \
  test_research_without_progress_stops_and_unsourced_apply_blocks \
  test_research_sources_outside_read_roots_block_without_request \
  test_corpus_notes_over_the_byte_caps_block_before_any_read \
  test_oversized_target_and_reference_are_refused_before_reading \
  test_propose_appends_an_unapproved_section_and_keeps_canon \
  test_propose_without_declared_sources_uses_the_default_corpus \
  test_propose_facts_must_cite_read_notes_then_one_correction \
  test_propose_needs_human_and_invalid_mode_block_without_writing \
  test_propose_rejects_result_markers_in_the_proposal \
  test_propose_heading_only_answer_is_rejected_and_titles_stay_inside_the_section \
  test_propose_without_a_corpus_cites_the_target_and_verifies_against_it \
  test_apply_moves_to_review_without_cloud \
  test_docs_model_selects_a_served_model \
  test_unknown_docs_model_blocks_without_a_model_call \
  test_docs_model_outside_the_allowlist_blocks_before_any_request \
  test_stream_response_is_applied \
  test_missing_opt_in_blocks_without_request \
  test_backlog_legacy_transcribe_ticket_is_groomed_without_a_model_call \
  test_backlog_groom_validates_explicit_targets_before_ready \
  test_target_outside_allowlist_blocks \
  test_traversal_and_symlink_targets_block \
  test_needs_human_blocks_with_reason \
  test_invalid_outputs_block_and_leave_file \
  test_section_rewrite_keeps_links_outside_the_section \
  test_rejected_proposal_gets_one_correction_round \
  test_heading_without_hashes_is_matched_by_text \
  test_append_section_on_a_duplicated_heading_is_rejected \
  test_noop_proposal_is_not_applied \
  test_crash_right_after_the_review_note_completes_the_transition \
  test_committing_recovery_blocks_when_the_note_changed_after_the_write \
  test_http_errors_block_after_bounded_retries \
  test_unreachable_model_blocks_without_cloud_fallback \
  test_idle_timeout_blocks \
  test_stream_cut_blocks \
  test_concurrent_edit_is_detected_and_not_overwritten \
  test_review_lane_reruns_as_revision \
  test_tick_ticket_filter_claims_only_one_card \
  test_parallel_ticks_run_once_per_card; do
  if [[ -n "${LOCALLLM_TEST_ONLY:-}" && "${t}" != *"${LOCALLLM_TEST_ONLY}"* ]]; then continue; fi
  echo "== ${t}"
  "${t}"
done
echo "localllm docs tests passed"
