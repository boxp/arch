#!/usr/bin/env bash
set -euo pipefail

# Black-box tests for the Novel Board runner. Uses a fake OpenAI-compatible
# server (babashka http-kit), a fake generate-image script and a fake claude CLI
# so no real model, GPU or API key is needed.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/novel-board/novel_board_runner.bb"
SEED="${ROOT_DIR}/docker/codex-workspace/novel-board/vault-seed"

TMP="$(mktemp -d)"
trap 'kill "${SERVER_PID:-0}" 2>/dev/null || true; [[ -n "${KEEP_TMP:-}" ]] || rm -rf "${TMP}"' EXIT

fail() { echo "error: $*" >&2; exit 1; }
assert_contains() { grep -Fq -- "$2" "$1" || fail "expected $1 to contain: $2"; }
assert_not_contains() { if grep -Fq -- "$2" "$1"; then fail "expected $1 not to contain: $2"; fi; }
count_matches() { grep -Fc -- "$2" "$1" || true; }

lane_of() {
  # lane_of <board> <novel-id>
  awk -v id="$2" '/^## /{lane=substr($0,4)} index($0,"[[Novels/" id "|")>0 {print lane; exit}' "$1"
}
card_line() { grep -F "[[Novels/$2|" "$1"; }

PORT=$(( 20000 + RANDOM % 20000 ))
MODE_FILE="${TMP}/llm-mode"
REQ_LOG="${TMP}/llm-requests.log"
echo normal >"${MODE_FILE}"
: >"${REQ_LOG}"

# ---------------------------------------------------------------------------
# Fake OpenAI-compatible server
# ---------------------------------------------------------------------------
cat >"${TMP}/fake-llm.bb" <<'EOF'
(require '[org.httpkit.server :as srv] '[cheshire.core :as json] '[clojure.string :as str])
(def port (Long/parseLong (System/getenv "FAKE_LLM_PORT")))
(def mode-file (System/getenv "FAKE_LLM_MODE_FILE"))
(def req-log (System/getenv "FAKE_LLM_REQ_LOG"))
(def body-text (str "# テスト小説\n\n" (apply str (repeat 60 "秋の空はどこまでも高く、グラウンドには万国旗がはためいていた。一穂はバトンを握り直し、隣で笑う凛に頷いた。")) "\n\n## 追加設定メモ\n- なし\n\n## 参照した既存設定\n- ひとはこ\n"))
(defn respond [content finish]
  {:status 200 :headers {"Content-Type" "application/json"}
   :body (json/generate-string {:id (str "chatcmpl-" (System/nanoTime)) :model "gemma4-26b" :object "chat.completion"
                                :choices [{:index 0 :finish_reason finish :message {:role "assistant" :content content}}]
                                :usage {:prompt_tokens 1234 :completion_tokens (count content) :total_tokens (+ 1234 (count content))}})})
(defn handler [req]
  (let [uri (:uri req)
        raw (if (:body req) (slurp (:body req)) "{}")
        parsed (json/parse-string raw true)
        mode (str/trim (slurp mode-file))
        messages (:messages parsed)
        last-user (:content (last messages))
        plan? (str/includes? (str last-user) "JSON オブジェクト")
        groom? (str/includes? (str last-user) "本文は書かないでください")
        continuation? (some #(= "assistant" (:role %)) messages)]
    (spit req-log (str (pr-str {:uri uri :model (:model parsed) :auth (get-in req [:headers "authorization"]) :plan? plan? :continuation? continuation? :mode mode :max-tokens (:max_tokens parsed)}) "\n") :append true)
    (cond
      (not= uri "/v1/chat/completions") {:status 404 :body "not found"}
      (and groom? (not (contains? #{"length-forever" "error500"} mode))) (respond (str "## Requirements\n\n- Title: 秋のテスト作品\n- Synopsis: 運動会前日の練習。\n- Characters: 桜一穂、瀬戸凛\n- Target length: 1000字\n- References:\n  - `ひとはこさんバース/キャラ設定/`\n- NSFW: false\n" (apply str (repeat 3 "- Required elements: 万国旗、バトン、秋空の描写を入れる。\n")) "\n## Outline\n\n1. 前日準備\n2. バトンパス練習\n3. 小さな異変\n") "stop")
      plan? (respond "{\"scene\": \"バトンパス練習\", \"prompt\": \"two girls practicing a relay baton pass\", \"reference_images\": [\"ref-rin.png\", \"not-a-candidate.png\"]}" "stop")
      (= mode "empty") (respond "" "stop")
      (= mode "short") (respond "# 短い\n本文が足りない。" "stop")
      (= mode "error500") {:status 500 :body "boom"}
      (= mode "filter") (respond body-text "content_filter")
      (= mode "length") (if continuation? (respond body-text "stop") (respond "# 途中\n前半だけ。" "length"))
      (= mode "length-forever") (respond "少しだけ。" "length")
      (= mode "slow") (do (Thread/sleep 4000) (respond body-text "stop"))
      (= mode "revise") (respond (str/replace body-text "テスト小説" "改稿版テスト小説") "stop")
      :else (respond body-text "stop"))))
(srv/run-server handler {:port port})
(println "fake llm listening" port)
@(promise)
EOF

FAKE_LLM_PORT="${PORT}" FAKE_LLM_MODE_FILE="${MODE_FILE}" FAKE_LLM_REQ_LOG="${REQ_LOG}" \
  bb "${TMP}/fake-llm.bb" >"${TMP}/fake-llm.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 50); do
  if curl -s -o /dev/null "http://127.0.0.1:${PORT}/v1/models"; then break; fi
  sleep 0.2
done

# ---------------------------------------------------------------------------
# Fake generate-image and fake claude
# ---------------------------------------------------------------------------
mkdir -p "${TMP}/bin"
cat >"${TMP}/bin/fake-generate-image.bb" <<'EOF'
#!/usr/bin/env bb
(require '[clojure.string :as str])
(let [args (vec *command-line-args*)
      out (nth args (inc (.indexOf args "-o")))
      refs (keep-indexed (fn [i a] (when (= "-i" a) (nth args (inc i)))) args)
      log (System/getenv "FAKE_IMAGE_LOG")]
  (when log (spit log (str (pr-str {:out out :refs (vec refs) :prompt (last args)}) "\n") :append true))
  (cond
    (= "1" (System/getenv "FAKE_IMAGE_FAIL")) (do (binding [*out* *err*] (println "API returned status 500")) (System/exit 1))
    (= "1" (System/getenv "FAKE_IMAGE_EMPTY")) (do (spit out "") (System/exit 0))
    :else (do (with-open [o (java.io.FileOutputStream. out)]
                (.write o (byte-array [0x89 0x50 0x4e 0x47 0x0d 0x0a 0x1a 0x0a 0 0 0 0])))
              (println out))))
EOF
chmod +x "${TMP}/bin/fake-generate-image.bb"


# Vault editing helper (babashka) used to simulate human edits.
cat >"${TMP}/bin/edit.bb" <<'EOF'
#!/usr/bin/env bb
(require '[clojure.string :as str])
(let [[cmd path a b] *command-line-args*
      content (slurp path)
      lines (vec (str/split-lines content))
      lane-idx (fn [lane] (.indexOf lines (str "## " lane)))
      write! (fn [ls] (spit path (str (str/join "\n" ls) "\n")))]
  (case cmd
    "add-card" (let [idx (lane-idx a)] (write! (vec (concat (subvec lines 0 (+ idx 2)) [b] (subvec lines (+ idx 2))))))
    "move-card" (let [card (first (filter #(str/includes? % (str "[[Novels/" a "|")) lines))
                      without (vec (remove #(= card %) lines))
                      idx (.indexOf without (str "## " b))]
                  (write! (vec (concat (subvec without 0 (+ idx 2)) [card] (subvec without (+ idx 2))))))
    "set-assignee" (write! (mapv #(if (str/includes? % (str "[[Novels/" a "|")) (str/replace % #"assignee::\S+" (str "assignee::" b)) %) lines))
    "replace-section" (write! (vec (str/split-lines (str/replace-first content (str "## " a "\n") (str "## " a "\n\n" (slurp b) "\n")))))
    (throw (ex-info (str "unknown command " cmd) {}))))
EOF
chmod +x "${TMP}/bin/edit.bb"

# Simulate a crash after the pending journal was committed but before all
# planned vault files were written. Keep the same plan so sync must replay it.
cat >"${TMP}/bin/mark-draft-pending.bb" <<'EOF'
(require '[clojure.edn :as edn])
(let [path (first *command-line-args*)
      state (edn/read-string (slurp path))
      plan (select-keys state [:key :path :image-path :synced-at :files :conflict?
                               :text-conflict? :image-conflict? :nsfw :agent :model :run-id])]
  (spit path (str (pr-str (-> state (dissoc :key) (assoc :pending plan))) "\n"))
  (println (:path state)))
EOF
chmod +x "${TMP}/bin/mark-draft-pending.bb"
cat >"${TMP}/bin/mark-image-failed.bb" <<'EOF'
(require '[clojure.edn :as edn])
(let [path (first *command-line-args*)
      state (edn/read-string (slurp path))]
  (spit path (str (pr-str (assoc state :illustration {:ok? false :reason "simulated revision failure"})) "\n")))
EOF
chmod +x "${TMP}/bin/mark-image-failed.bb"
cat >"${TMP}/bin/draft-state-path.bb" <<'EOF'
(require '[clojure.edn :as edn])
(println (:path (edn/read-string (slurp (first *command-line-args*)))))
EOF
chmod +x "${TMP}/bin/draft-state-path.bb"

cat >"${TMP}/bin/claude" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
prompt="$(cat)"
id="$(printf '%s' "${prompt}" | grep -o 'NOVEL-[0-9]*' | head -n 1)"
mode="$(cat "${FAKE_CLAUDE_MODE_FILE}")"
printf '%s\n' "$*" >>"${FAKE_CLAUDE_ARG_LOG}"
work="${CODEX_NOVEL_BOARD_ROOT}/work/${id}"
mkdir -p "${work}"
case "${mode}" in
  done)
    { echo "# クラウド執筆"; for _ in $(seq 1 40); do echo "雲ひとつない空の下、一穂はスタートラインに立った。胸の鼓動がバトンに伝わる気がした。"; done; } >"${work}/manuscript.md"
    echo '{"scene":"start line","prompt":"girl at the start line","reference_images":["ref-rin.png"]}' >"${work}/illustration.json"
    echo "NOVEL_BOARD_RESULT: done"
    ;;
  groom)
    note="${CODEX_NOVEL_BOARD_VAULT}/Novels/${id}.md"
    printf -- '- Title: クラウド要件\n- Synopsis: あらすじ\n' >"${work}/groom.txt"
    bb "${FAKE_EDIT_BB}" replace-section "${note}" Requirements "${work}/groom.txt"
    printf -- '1. 導入\n2. 展開\n' >"${work}/outline.txt"
    bb "${FAKE_EDIT_BB}" replace-section "${note}" Outline "${work}/outline.txt"
    echo "NOVEL_BOARD_RESULT: done"
    ;;
  nomarker)
    { echo "# マーカーなし"; for _ in $(seq 1 40); do echo "本文はあるが結果マーカーを出さない。"; done; } >"${work}/manuscript.md"
    echo "finished without marker"
    ;;
  nothing)
    echo "NOVEL_BOARD_RESULT: done"
    ;;
  blocked)
    echo "NOVEL_BOARD_RESULT: blocked 参照資料が足りません"
    ;;
esac
EOF
chmod +x "${TMP}/bin/claude"

# ---------------------------------------------------------------------------
# Vault fixture
# ---------------------------------------------------------------------------
VAULT="${TMP}/vault"
STATE="${TMP}/state"
mkdir -p "${VAULT}/Boards" "${VAULT}/Novels" "${VAULT}/Templates" "${VAULT}/attachments" "${VAULT}/ひとはこさんバース/キャラ設定"
cp "${SEED}/Boards/Novel Board.md" "${VAULT}/Boards/Novel Board.md"
cp "${SEED}/Templates/Novel Management.md" "${VAULT}/Templates/Novel Management.md"
cp "${SEED}/Novels/README.md" "${VAULT}/Novels/README.md"
printf '\x89PNG\r\n\x1a\n' >"${VAULT}/attachments/ref-rin.png"
printf '\x89PNG\r\n\x1a\n' >"${VAULT}/attachments/ref-hitohako.png"
cat >"${VAULT}/ひとはこさんバース/キャラ設定/瀬戸凛.md" <<'EOF'
# 瀬戸凛

一穂のクラスメイト。陸上部。

![](../../attachments/ref-rin.png)
EOF
cat >"${VAULT}/ひとはこさんバース/キャラ設定/ひとはこ.md" <<'EOF'
# ひとはこ

桜一穂。変身ヒロイン。

![](../../attachments/ref-hitohako.png)
EOF
BOARD="${VAULT}/Boards/Novel Board.md"

export CODEX_NOVEL_BOARD_VAULT="${VAULT}"
export CODEX_NOVEL_BOARD_ROOT="${STATE}"
export CODEX_NOVEL_BOARD_OWNER_ID="test-owner"
export CODEX_NOVEL_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:${PORT}/v1"
export CODEX_NOVEL_BOARD_LOCALLLM_MODEL="gemma4-26b"
export CODEX_NOVEL_BOARD_LOCALLLM_TIMEOUT_SECONDS=30
export CODEX_NOVEL_BOARD_LOCALLLM_RETRIES=0
export CODEX_NOVEL_BOARD_LOCALLLM_MAX_CONTINUATIONS=2
export CODEX_NOVEL_BOARD_IMAGE_SCRIPT="${TMP}/bin/fake-generate-image.bb"
export CODEX_NOVEL_BOARD_CLAUDE_BIN="${TMP}/bin/claude"
export CODEX_NOVEL_BOARD_AGENT_IDLE_TIMEOUT_SECONDS=20
export FAKE_IMAGE_LOG="${TMP}/image.log"
export FAKE_CLAUDE_MODE_FILE="${TMP}/claude-mode"
export FAKE_CLAUDE_ARG_LOG="${TMP}/claude-args.log"
export FAKE_EDIT_BB="${TMP}/bin/edit.bb"
echo done >"${FAKE_CLAUDE_MODE_FILE}"
: >"${FAKE_CLAUDE_ARG_LOG}"

tick() { bb "${RUNNER}" tick >>"${TMP}/runner.log" 2>&1; }

add_card() { bb "${TMP}/bin/edit.bb" add-card "${BOARD}" "$1" "$2"; }
move_card() { bb "${TMP}/bin/edit.bb" move-card "${BOARD}" "$1" "$2"; }
set_assignee() { bb "${TMP}/bin/edit.bb" set-assignee "${BOARD}" "$1" "$2"; }

cat >"${TMP}/requirements.txt" <<'EOF'
- Title: テスト小説
- Synopsis: 運動会の前日、バトンパスの練習をする。
- Characters: 桜一穂、瀬戸凛
- Target length: 1000字
- References:
  - `ひとはこさんバース/キャラ設定/`
- NSFW: false
EOF
write_requirements() { bb "${TMP}/bin/edit.bb" replace-section "${VAULT}/Novels/$1.md" Requirements "${TMP}/requirements.txt"; }

# ---------------------------------------------------------------------------
# 1. Scaffold: title-only Backlog card
# ---------------------------------------------------------------------------
add_card Backlog "- [ ] 秋のテスト作品"
tick
assert_contains "${BOARD}" "[[Novels/NOVEL-1|NOVEL-1: 秋のテスト作品]] #novel status::backlog assignee::boxp"
[[ -f "${VAULT}/Novels/NOVEL-1.md" ]] || fail "scaffold did not create NOVEL-1.md"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "id: NOVEL-1"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "title: 秋のテスト作品"
[[ ! -d "${STATE}/runs/NOVEL-1" ]] || fail "human-assigned scaffold must not start a run"
# The scaffolded note is concise: machine frontmatter, heading, section headings and TBD.
assert_not_contains "${VAULT}/Novels/NOVEL-1.md" "このノートは"
assert_not_contains "${VAULT}/Novels/NOVEL-1.md" "- Title:"
assert_not_contains "${VAULT}/Novels/NOVEL-1.md" "## Workflow"
for heading in "Draft Preview" "Requirements" "Outline" "Review Instructions" "Change History" "Run History"; do
  [[ "$(sed -n "/^## ${heading}\$/,/^## /p" "${VAULT}/Novels/NOVEL-1.md" | grep -v '^## ' | grep -v '^$')" == "TBD" ]] || fail "scaffolded ${heading} should contain only TBD"
done
[[ "$(wc -l <"${VAULT}/Novels/NOVEL-1.md")" -lt 50 ]] || fail "scaffolded note should be short"
echo "PASS: scaffold title-only card"

# Backlog + localllm -> groom -> Draft, assignee boxp
set_assignee NOVEL-1 localllm
tick
[[ "$(lane_of "${BOARD}" NOVEL-1)" == "Draft" ]] || fail "groom should move NOVEL-1 to Draft: $(card_line "${BOARD}" NOVEL-1)"
assert_contains "${BOARD}" "[[Novels/NOVEL-1|NOVEL-1: 秋のテスト作品]] #novel status::draft assignee::boxp"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "status: draft"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "action=groom agent=localllm model=gemma4-26b"
# TBD placeholders were a blank slate for groom, and the first real entries replace them.
assert_contains "${VAULT}/Novels/NOVEL-1.md" "- Title: 秋のテスト作品"
[[ -z "$(sed -n '/^## Requirements$/,/^## /p' "${VAULT}/Novels/NOVEL-1.md" | grep -x 'TBD')" ]] || fail "groom output must replace the Requirements TBD"
[[ -z "$(sed -n '/^## Run History$/,/^## /p' "${VAULT}/Novels/NOVEL-1.md" | grep -x 'TBD')" ]] || fail "first Run History entry must replace the TBD"
echo "PASS: localllm groom moves to Draft with human hand-off"

# ---------------------------------------------------------------------------
# 2. Unsupported assignee never rewrites the card and logs once
# ---------------------------------------------------------------------------
set_assignee NOVEL-1 pi
tick; tick
assert_contains "${BOARD}" "status::draft assignee::pi"
[[ "$(count_matches "${VAULT}/Novels/NOVEL-1.md" 'assignee `pi` は対応していない')" == "1" ]] || fail "unsupported assignee should be logged exactly once"
[[ ! -d "${STATE}/runs/NOVEL-1" || "$(find "${STATE}/runs/NOVEL-1" -name summary.edn | wc -l)" == "1" ]] || fail "unsupported assignee must not start a run"
echo "PASS: unsupported assignee untouched"

# ---------------------------------------------------------------------------
# 3. Draft + localllm -> write -> Review with manuscript and illustration
# ---------------------------------------------------------------------------
write_requirements NOVEL-1
set_assignee NOVEL-1 localllm
tick
[[ "$(lane_of "${BOARD}" NOVEL-1)" == "Review" ]] || fail "write should move NOVEL-1 to Review: $(card_line "${BOARD}" NOVEL-1)"
assert_contains "${BOARD}" "status::review assignee::boxp"
[[ -s "${STATE}/work/NOVEL-1/manuscript.md" ]] || fail "manuscript missing"
assert_contains "${STATE}/work/NOVEL-1/manuscript.md" "# テスト小説"
[[ -s "${STATE}/work/NOVEL-1/illustration.png" ]] || fail "illustration missing"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "illustration: ${STATE}/work/NOVEL-1/illustration.png"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "挿絵: 生成済み"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "llm-model: gemma4-26b"
assert_contains "${REQ_LOG}" ':model "gemma4-26b"'
assert_contains "${REQ_LOG}" ':plan? true'
# reference images: the model picked ref-rin.png (candidate) and a non-candidate that must be ignored
assert_contains "${TMP}/image.log" "ref-rin.png"
assert_not_contains "${TMP}/image.log" "not-a-candidate"
assert_contains "${TMP}/image.log" "No text, no letters, no logo, no watermark"
EVIDENCE="$(find "${STATE}/runs/NOVEL-1" -name llm-evidence.edn | sort | tail -n 1)"
assert_contains "${EVIDENCE}" ':model "gemma4-26b"'
assert_contains "${EVIDENCE}" ':finish-reason "stop"'
assert_not_contains "${EVIDENCE}" "万国旗"
assert_not_contains "${EVIDENCE}" "Authorization"
[[ "$(stat -c %a "${STATE}/work/NOVEL-1/manuscript.md")" == "600" ]] || fail "manuscript must be private (0600)"
echo "PASS: localllm write -> Review with illustration and evidence"

# Draft is readable in the vault and linked from both the management note and Board.
DRAFT1="${VAULT}/Novels/Drafts/NOVEL-1/manuscript.md"
DRAFT1_IMAGE="${VAULT}/Novels/Drafts/NOVEL-1/attachments/illustration.png"
[[ -s "${DRAFT1}" ]] || fail "Review manuscript was not copied into SFW draft folder"
[[ -s "${DRAFT1_IMAGE}" ]] || fail "Review illustration was not copied into draft attachments"
assert_contains "${DRAFT1}" "未承認草稿"
assert_contains "${DRAFT1}" "![](attachments/illustration.png)"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "[[Novels/Drafts/NOVEL-1/manuscript|本文を読む]]"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "![[Novels/Drafts/NOVEL-1/attachments/illustration.png]]"
assert_contains "${BOARD}" "[[Novels/Drafts/NOVEL-1/manuscript|草稿]]"
[[ -f "${VAULT}/$(sed -n 's/.*本文: \[\[\([^]|]*\).*/\1/p' "${VAULT}/Novels/NOVEL-1.md" | head -n1).md" ]] || fail "management-note wiki link does not resolve"

# An unchanged explicit sync must leave the copied files and note untouched.
sha256sum "${DRAFT1}" "${DRAFT1_IMAGE}" "${VAULT}/Novels/NOVEL-1.md" >"${TMP}/draft-before.sha"
bb "${RUNNER}" sync-drafts NOVEL-1 >>"${TMP}/runner.log" 2>&1
sha256sum -c "${TMP}/draft-before.sha" >/dev/null || fail "unchanged draft sync modified vault content"

# Replay a pending journal after a simulated interruption with the manuscript
# output missing. Recovery must reproduce exactly the planned bytes, then be idle.
DRAFT_STATE="${STATE}/drafts/NOVEL-1.edn"
cp "${DRAFT1}" "${TMP}/planned-manuscript.md"
cp "${DRAFT1_IMAGE}" "${TMP}/planned-image.png"
bb "${TMP}/bin/mark-draft-pending.bb" "${DRAFT_STATE}"
rm "${DRAFT1}"
bb "${RUNNER}" sync-drafts NOVEL-1 >>"${TMP}/runner.log" 2>&1
cmp -s "${DRAFT1}" "${TMP}/planned-manuscript.md" || fail "pending journal recovery changed planned manuscript bytes"
cmp -s "${DRAFT1_IMAGE}" "${TMP}/planned-image.png" || fail "pending journal recovery changed planned image bytes"
assert_not_contains "${DRAFT_STATE}" ":pending"
sha256sum "${DRAFT1}" "${DRAFT1_IMAGE}" "${VAULT}/Novels/NOVEL-1.md" "${DRAFT_STATE}" >"${TMP}/recovered-before.sha"
bb "${RUNNER}" sync-drafts NOVEL-1 >>"${TMP}/runner.log" 2>&1
sha256sum -c "${TMP}/recovered-before.sha" >/dev/null || fail "post-recovery sync was not idempotent"
echo "PASS: pending journal recovery"

# A human edit is preserved; the revised runner copy is placed beside it.
printf '\nHuman edit to the review copy.\n' >>"${DRAFT1}"
printf '\nPrivate revision from the authoring run.\n' >>"${STATE}/work/NOVEL-1/manuscript.md"
bb "${RUNNER}" sync-drafts NOVEL-1 >>"${TMP}/runner.log" 2>&1
assert_contains "${DRAFT1}" "Human edit to the review copy"
[[ -n "$(find "${VAULT}/Novels/Drafts/NOVEL-1" -maxdepth 1 -name 'manuscript.runner-*.md' -print -quit)" ]] || fail "runner did not preserve revised copy beside human edit"
# Image edits also remain untouched; runner can write a separate generated copy.
printf '\nHuman image edit marker.\n' >>"${DRAFT1_IMAGE}"
cp "${DRAFT1_IMAGE}" "${TMP}/human-image.png"
printf '\nSecond private revision.\n' >>"${STATE}/work/NOVEL-1/manuscript.md"
bb "${RUNNER}" sync-drafts NOVEL-1 >>"${TMP}/runner.log" 2>&1
cmp -s "${DRAFT1_IMAGE}" "${TMP}/human-image.png" || fail "human-edited illustration was overwritten"
echo "PASS: draft sync, vault links, idempotence and edit conflict"

# ---------------------------------------------------------------------------
# 4. Review with empty (TBD) instructions does not start; with instructions it revises
# ---------------------------------------------------------------------------
[[ "$(sed -n '/^## Review Instructions$/,/^## /p' "${VAULT}/Novels/NOVEL-1.md" | grep -v '^## ' | grep -v '^$')" == "TBD" ]] || fail "Review Instructions should still be the scaffold TBD"
set_assignee NOVEL-1 localllm
tick
[[ "$(lane_of "${BOARD}" NOVEL-1)" == "Review" ]] || fail "empty Review Instructions must not start a run"
assert_contains "${BOARD}" "status::review assignee::localllm"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "Review Instructions が空のため改稿を開始しません"
printf -- '- 冒頭をもっと明るくしてください。\n' >"${TMP}/instructions.txt"
bb "${TMP}/bin/edit.bb" replace-section "${VAULT}/Novels/NOVEL-1.md" "Review Instructions" "${TMP}/instructions.txt"
echo revise >"${MODE_FILE}"
tick
[[ "$(lane_of "${BOARD}" NOVEL-1)" == "Review" ]] || fail "revise should return to Review"
assert_contains "${STATE}/work/NOVEL-1/manuscript.md" "改稿版テスト小説"
CURRENT_DRAFT_REL="$(sed -n 's/.*本文: \[\[\([^]|]*\).*/\1/p' "${VAULT}/Novels/NOVEL-1.md" | tail -n1)"
CURRENT_DRAFT="${VAULT}/${CURRENT_DRAFT_REL}.md"
[[ -s "${CURRENT_DRAFT}" ]] || fail "management-note draft link did not resolve after revision"
assert_contains "${CURRENT_DRAFT}" "改稿版テスト小説"
assert_contains "${BOARD}" "status::review assignee::boxp"
assert_contains "${STATE}/work/NOVEL-1/manuscript.md" "改稿版テスト小説"
ls "${STATE}/work/NOVEL-1/" | grep -q "manuscript.prev-" || fail "previous manuscript must be kept"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "action=revise agent=localllm"
echo normal >"${MODE_FILE}"
echo "PASS: Review instructions gate and revise"

# ---------------------------------------------------------------------------
# 5. Done -> publish once, idempotent, with the approved illustration
# ---------------------------------------------------------------------------
move_card NOVEL-1 Done
tick
PUB="$(find "${VAULT}/小説草案/AI執筆" -maxdepth 1 -name '*_秋のテスト作品.md' | head -n 1)"
[[ -n "${PUB}" ]] || fail "published manuscript missing"
assert_contains "${PUB}" "![](attachments/"
IMG="$(find "${VAULT}/小説草案/AI執筆/attachments" -name '*-highlight.png' | head -n 1)"
[[ -s "${IMG}" ]] || fail "published illustration missing"
assert_contains "${VAULT}/Novels/NOVEL-1.md" "published-path: 小説草案/AI執筆/"
assert_contains "${BOARD}" "- [x] [[Novels/NOVEL-1|"
tick; tick
[[ "$(find "${VAULT}/小説草案/AI執筆" -maxdepth 1 -name '*.md' | wc -l)" == "1" ]] || fail "publish must be idempotent"
[[ "$(count_matches "${VAULT}/Novels/NOVEL-1.md" 'published approved manuscript once')" == "1" ]] || fail "publish history must be written once"
[[ ! -d "${VAULT}/NSFW" ]] || fail "SFW card must not touch NSFW directory"
echo "PASS: Done publish once"

# A later revision can fail image generation while retaining readable text.
# Simulate a successful earlier illustration, then a changed manuscript with
# a failed illustration result; old image embeds must disappear from the draft.
add_card Draft "- [ ] [[Novels/NOVEL-23|NOVEL-23: 画像失敗改稿テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-23.md"
write_requirements NOVEL-23
tick
NOVEL23_DRAFT="${VAULT}/Novels/Drafts/NOVEL-23/manuscript.md"
[[ -s "${VAULT}/Novels/Drafts/NOVEL-23/attachments/illustration.png" ]] || fail "initial illustration missing for revision failure fixture"
SUMMARY23="$(find "${STATE}/runs/NOVEL-23" -name summary.edn -print -quit)"
printf '\nRevised body remains readable after illustration failure.\n' >>"${STATE}/work/NOVEL-23/manuscript.md"
bb "${TMP}/bin/mark-image-failed.bb" "${SUMMARY23}"
bb "${RUNNER}" sync-drafts NOVEL-23 >>"${TMP}/runner.log" 2>&1
assert_contains "${NOVEL23_DRAFT}" "Revised body remains readable"
assert_not_contains "${NOVEL23_DRAFT}" "![](attachments/illustration.png)"
assert_not_contains "${VAULT}/Novels/NOVEL-23.md" "![[Novels/Drafts/NOVEL-23/attachments/illustration.png]]"
cat >>"${STATE}/work/NOVEL-23/manuscript.md" <<'EOF'

```html
<iframe src="https://example.invalid/track"></iframe>
```
![[../../Secrets.md]] [run](javascript:alert(1))
EOF
bb "${RUNNER}" sync-drafts NOVEL-23 >>"${TMP}/runner.log" 2>&1
assert_contains "${STATE}/work/NOVEL-23/manuscript.md" "<iframe src=\"https://example.invalid/track\">"
assert_not_contains "${NOVEL23_DRAFT}" "<iframe"
assert_not_contains "${NOVEL23_DRAFT}" "![[../../Secrets.md]]"
assert_not_contains "${NOVEL23_DRAFT}" "javascript:"
echo "PASS: failed revision illustration removes stale links while retaining text"

# ---------------------------------------------------------------------------
# 6. Empty / short output is a failure, card returns to Draft with reason
# ---------------------------------------------------------------------------
add_card Draft "- [ ] [[Novels/NOVEL-2|NOVEL-2: 空出力テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-2.md"
write_requirements NOVEL-2
echo empty >"${MODE_FILE}"
tick
[[ "$(lane_of "${BOARD}" NOVEL-2)" == "Draft" ]] || fail "empty output should return to Draft: $(card_line "${BOARD}" NOVEL-2)"
assert_contains "${BOARD}" "[[Novels/NOVEL-2|NOVEL-2: 空出力テスト]] #novel status::draft assignee::boxp"
assert_contains "${VAULT}/Novels/NOVEL-2.md" "本文が短すぎます"
assert_contains "${VAULT}/Novels/NOVEL-2.md" "再開条件"
[[ ! -f "${STATE}/work/NOVEL-2/manuscript.md" ]] || fail "empty output must not be saved as manuscript"
[[ ! -f "${STATE}/work/NOVEL-2/illustration.png" ]] || fail "no illustration without manuscript"
assert_run_failed="$(find "${STATE}/runs/NOVEL-2" -name summary.edn | sort | tail -n 1)"
assert_contains "${assert_run_failed}" ":status :failed"
echo "PASS: empty output is not success"

# ---------------------------------------------------------------------------
# 7. Truncated output (finish_reason=length) continues; endless length fails
# ---------------------------------------------------------------------------
echo length >"${MODE_FILE}"
set_assignee NOVEL-2 localllm
tick
[[ "$(lane_of "${BOARD}" NOVEL-2)" == "Review" ]] || fail "continuation should complete the manuscript"
assert_contains "${REQ_LOG}" ":continuation? true"
assert_contains "${STATE}/work/NOVEL-2/manuscript.md" "万国旗"
echo "PASS: finish_reason=length continuation"

add_card Draft "- [ ] [[Novels/NOVEL-3|NOVEL-3: 途中終了テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-3.md"
write_requirements NOVEL-3
echo length-forever >"${MODE_FILE}"
tick
[[ "$(lane_of "${BOARD}" NOVEL-3)" == "Draft" ]] || fail "endless truncation must fail"
assert_contains "${VAULT}/Novels/NOVEL-3.md" "途中で終了しました"
[[ -f "${STATE}/work/NOVEL-3/manuscript.partial.md" ]] || fail "partial manuscript must be kept"
echo normal >"${MODE_FILE}"
echo "PASS: endless truncation fails with partial kept"

# ---------------------------------------------------------------------------
# 8. Illustration failure => Review with partial completion, no fake link
# ---------------------------------------------------------------------------
set_assignee NOVEL-3 localllm
FAKE_IMAGE_FAIL=1 tick
[[ "$(lane_of "${BOARD}" NOVEL-3)" == "Review" ]] || fail "image failure should still reach Review"
assert_contains "${VAULT}/Novels/NOVEL-3.md" "挿絵: 未生成"
assert_contains "${VAULT}/Novels/NOVEL-3.md" "一部未完了"
assert_not_contains "${VAULT}/Novels/NOVEL-3.md" "illustration: ${STATE}"
[[ ! -f "${STATE}/work/NOVEL-3/illustration.png" ]] || fail "failed image must not exist"
move_card NOVEL-3 Done
tick
PUB3="$(find "${VAULT}/小説草案/AI執筆" -maxdepth 1 -name '*_途中終了テスト.md' | head -n 1)"
[[ -n "${PUB3}" ]] || fail "text-only publish missing"
assert_not_contains "${PUB3}" "![](attachments/"
assert_contains "${VAULT}/Novels/NOVEL-3.md" "挿絵: なし（未生成のためリンクは付けていません）"
echo "PASS: illustration failure is partial completion without fake links"

# exit 0 but empty image file is also a failure
add_card Draft "- [ ] [[Novels/NOVEL-4|NOVEL-4: 空画像テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-4.md"
write_requirements NOVEL-4
FAKE_IMAGE_EMPTY=1 tick
assert_contains "${VAULT}/Novels/NOVEL-4.md" "有効な画像ファイルが生成されませんでした"
echo "PASS: empty image with exit 0 is not success"

# ---------------------------------------------------------------------------
# 9. API down / HTTP 500 => failure with reason, card back to Draft
# ---------------------------------------------------------------------------
add_card Draft "- [ ] [[Novels/NOVEL-5|NOVEL-5: API停止テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-5.md"
write_requirements NOVEL-5
echo error500 >"${MODE_FILE}"
tick
[[ "$(lane_of "${BOARD}" NOVEL-5)" == "Draft" ]] || fail "HTTP 500 should return to Draft"
assert_contains "${VAULT}/Novels/NOVEL-5.md" "localllm HTTP error: 500"
echo normal >"${MODE_FILE}"
set_assignee NOVEL-5 localllm
CODEX_NOVEL_BOARD_LOCALLLM_BASE_URL="http://127.0.0.1:1/v1" tick
[[ "$(lane_of "${BOARD}" NOVEL-5)" == "Draft" ]] || fail "connection error should return to Draft"
assert_contains "${VAULT}/Novels/NOVEL-5.md" "localllm connection error"
echo "PASS: API failures are reported, not swallowed"

# ---------------------------------------------------------------------------
# 10. Stale lock recovery and no double start
# ---------------------------------------------------------------------------
set_assignee NOVEL-5 localllm
mkdir -p "${STATE}/locks"
cat >"${STATE}/locks/NOVEL-5.edn" <<'EOF'
{:novel "NOVEL-5" :run-id "20260101T000000Z-stale" :action :write :lane "Draft" :owner-id "old-owner" :owner-instance-id "old" :host "old" :pid 1 :started-at "2026-01-01T00:00:00Z" :heartbeat-at "2026-01-01T00:00:00Z"}
EOF
tick
[[ ! -f "${STATE}/locks/NOVEL-5.edn" ]] || fail "stale lock should be released after the run"
assert_contains "${VAULT}/Novels/NOVEL-5.md" "run 20260101T000000Z-stale was marked interrupted after heartbeat timeout"
[[ "$(lane_of "${BOARD}" NOVEL-5)" == "Review" ]] || fail "stale lock should not block a new run"
echo "PASS: stale lock recovery"

add_card Draft "- [ ] [[Novels/NOVEL-6|NOVEL-6: 多重tickテスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-6.md"
write_requirements NOVEL-6
echo slow >"${MODE_FILE}"
tick & T1=$!
sleep 1.5
tick & T2=$!
wait "${T1}" "${T2}"
echo normal >"${MODE_FILE}"
[[ "$(find "${STATE}/runs/NOVEL-6" -name summary.edn | wc -l)" == "1" ]] || fail "concurrent ticks must start exactly one run"
[[ "$(lane_of "${BOARD}" NOVEL-6)" == "Review" ]] || fail "slow run should finish in Review"
echo "PASS: concurrent ticks do not double start"

# Human moves the card during the run: runner keeps the human's lane
add_card Draft "- [ ] [[Novels/NOVEL-7|NOVEL-7: 人間移動テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-7.md"
write_requirements NOVEL-7
echo slow >"${MODE_FILE}"
tick & T1=$!
sleep 1.5
move_card NOVEL-7 Backlog
wait "${T1}"
echo normal >"${MODE_FILE}"
[[ "$(lane_of "${BOARD}" NOVEL-7)" == "Backlog" ]] || fail "runner must not override a human lane move"
assert_contains "${BOARD}" "[[Novels/NOVEL-7|NOVEL-7: 人間移動テスト]] #novel status::backlog assignee::localllm"
assert_contains "${VAULT}/Novels/NOVEL-7.md" "人間が Backlog へ移動したためレーンと担当は変更しません"
echo "PASS: human lane move during run is respected"
set_assignee NOVEL-7 boxp

# Planned shutdown marker closes the lock and the next tick restarts
add_card Draft "- [ ] [[Novels/NOVEL-8|NOVEL-8: 再起動テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-8.md"
write_requirements NOVEL-8
mkdir -p "${STATE}/locks" "${STATE}/terminating-owners" "${STATE}/owners"
cat >"${STATE}/locks/NOVEL-8.edn" <<'EOF'
{:novel "NOVEL-8" :run-id "20260101T000000Z-shutdown" :action :write :lane "Draft" :owner-id "dead-owner" :owner-instance-id "dead-1" :host "old" :pid 1 :started-at "2026-01-01T00:00:00Z" :heartbeat-at "2099-01-01T00:00:00Z"}
EOF
echo '{:owner-id "dead-owner" :instance-id "dead-1" :host "old" :requested-at "2026-01-01T00:00:00Z"}' >"${STATE}/terminating-owners/dead-owner.edn"
move_card NOVEL-8 "In Progress"
tick
assert_contains "${VAULT}/Novels/NOVEL-8.md" "was marked interrupted after planned workspace shutdown of owner dead-owner"
[[ "$(lane_of "${BOARD}" NOVEL-8)" == "Review" ]] || fail "In Progress card should resume after planned shutdown"
[[ ! -f "${STATE}/terminating-owners/dead-owner.edn" ]] || fail "consumed shutdown marker should be removed"
echo "PASS: planned shutdown recovery resumes In Progress card"

# ---------------------------------------------------------------------------
# 11. Cloud route (fake claude): done, nothing, blocked; groom
# ---------------------------------------------------------------------------
add_card Draft "- [ ] [[Novels/NOVEL-9|NOVEL-9: クラウドテスト]] #novel status::draft assignee::claude-sonnet"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-9.md"
write_requirements NOVEL-9
tick
[[ "$(lane_of "${BOARD}" NOVEL-9)" == "Review" ]] || fail "claude route should reach Review: $(card_line "${BOARD}" NOVEL-9)"
assert_contains "${FAKE_CLAUDE_ARG_LOG}" "--model claude-sonnet-5-5"
assert_contains "${STATE}/work/NOVEL-9/manuscript.md" "クラウド執筆"
[[ -s "${STATE}/work/NOVEL-9/illustration.png" ]] || fail "cloud route illustration missing"
assert_contains "${VAULT}/Novels/NOVEL-9.md" "model=claude-sonnet-5-5"
assert_contains "${VAULT}/Novels/Drafts/NOVEL-9/manuscript.md" "agent: claude-sonnet"
assert_contains "${VAULT}/Novels/Drafts/NOVEL-9/manuscript.md" "model: claude-sonnet-5-5"
echo "PASS: cloud route write"

echo nothing >"${FAKE_CLAUDE_MODE_FILE}"
add_card Draft "- [ ] [[Novels/NOVEL-10|NOVEL-10: クラウド空テスト]] #novel status::draft assignee::fable"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-10.md"
write_requirements NOVEL-10
tick
[[ "$(lane_of "${BOARD}" NOVEL-10)" == "Draft" ]] || fail "exit 0 without manuscript must fail"
assert_contains "${VAULT}/Novels/NOVEL-10.md" "exit 0 だけでは成功扱いにしません"
assert_contains "${FAKE_CLAUDE_ARG_LOG}" "--model claude-fable-5-1"
echo blocked >"${FAKE_CLAUDE_MODE_FILE}"
set_assignee NOVEL-10 claude-fable
tick
assert_contains "${VAULT}/Novels/NOVEL-10.md" "agent が blocked を返しました"
echo groom >"${FAKE_CLAUDE_MODE_FILE}"
add_card Backlog "- [ ] [[Novels/NOVEL-11|NOVEL-11: クラウドgroom]] #novel status::backlog assignee::claude-sonnet"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-11.md"
tick
[[ "$(lane_of "${BOARD}" NOVEL-11)" == "Draft" ]] || fail "cloud groom should move to Draft"
assert_contains "${VAULT}/Novels/NOVEL-11.md" "- Title: クラウド要件"
echo done >"${FAKE_CLAUDE_MODE_FILE}"
echo "PASS: cloud route failures and groom"

# ---------------------------------------------------------------------------
# 11b. finish_reason other than stop, groom truncation, cloud no-marker / unchanged revise
# ---------------------------------------------------------------------------
add_card Draft "- [ ] [[Novels/NOVEL-13|NOVEL-13: finish_reasonテスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-13.md"
write_requirements NOVEL-13
echo filter >"${MODE_FILE}"
tick
[[ "$(lane_of "${BOARD}" NOVEL-13)" == "Draft" ]] || fail "finish_reason=content_filter must fail"
assert_contains "${VAULT}/Novels/NOVEL-13.md" 'finish_reason="content_filter"'
echo "PASS: non-stop finish_reason is not success"

add_card Backlog "- [ ] [[Novels/NOVEL-14|NOVEL-14: groom途中終了]] #novel status::backlog assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-14.md"
echo length-forever >"${MODE_FILE}"
tick
[[ "$(lane_of "${BOARD}" NOVEL-14)" == "Backlog" ]] || fail "truncated groom must stay in Backlog"
assert_contains "${VAULT}/Novels/NOVEL-14.md" "要件整理の出力が finish_reason"
echo normal >"${MODE_FILE}"
echo "PASS: truncated groom fails"

echo nomarker >"${FAKE_CLAUDE_MODE_FILE}"
add_card Draft "- [ ] [[Novels/NOVEL-15|NOVEL-15: マーカーなし]] #novel status::draft assignee::claude-sonnet"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-15.md"
write_requirements NOVEL-15
tick
[[ "$(lane_of "${BOARD}" NOVEL-15)" == "Draft" ]] || fail "missing done marker must fail"
assert_contains "${VAULT}/Novels/NOVEL-15.md" "NOVEL_BOARD_RESULT: done を返さずに終了"
echo done >"${FAKE_CLAUDE_MODE_FILE}"
set_assignee NOVEL-15 claude-sonnet
tick
[[ "$(lane_of "${BOARD}" NOVEL-15)" == "Review" ]] || fail "cloud write should reach Review"
printf -- '- 結末を変えてください。\n' >"${TMP}/instructions.txt"
bb "${TMP}/bin/edit.bb" replace-section "${VAULT}/Novels/NOVEL-15.md" "Review Instructions" "${TMP}/instructions.txt"
echo nothing >"${FAKE_CLAUDE_MODE_FILE}"
set_assignee NOVEL-15 claude-sonnet
tick
[[ "$(lane_of "${BOARD}" NOVEL-15)" == "Review" ]] || fail "unchanged revise should return to Review"
assert_contains "${VAULT}/Novels/NOVEL-15.md" "原稿が変更されていません"
echo done >"${FAKE_CLAUDE_MODE_FILE}"
echo "PASS: cloud marker and unchanged-revise checks"

# Card moved away before the lock is taken: nothing runs
add_card Draft "- [ ] [[Novels/NOVEL-16|NOVEL-16: 直前移動]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-16.md"
write_requirements NOVEL-16
move_card NOVEL-16 Done
tick
[[ ! -f "${STATE}/work/NOVEL-16/manuscript.md" ]] || fail "Done card without manuscript must not be written"
assert_contains "${VAULT}/Novels/NOVEL-16.md" "publish 待ち"
echo "PASS: Done without manuscript waits"

# ---------------------------------------------------------------------------
# 12. NSFW routing is decided by the card tag; note frontmatter follows the card
# ---------------------------------------------------------------------------
add_card Draft "- [ ] [[Novels/NOVEL-12|NOVEL-12: 区分テスト]] #novel #nsfw status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-12.md"
write_requirements NOVEL-12
tick
assert_contains "${VAULT}/Novels/NOVEL-12.md" "nsfw: true"
assert_contains "${BOARD}" "[[Novels/NOVEL-12|NOVEL-12: 区分テスト]] #novel #nsfw status::review assignee::boxp"
NSFW_DRAFT="${VAULT}/NSFW/小説/草稿/NOVEL-12/manuscript.md"
NSFW_IMAGE="${VAULT}/NSFW/小説/草稿/NOVEL-12/attachments/illustration.png"
[[ -s "${NSFW_DRAFT}" && -s "${NSFW_IMAGE}" ]] || fail "NSFW draft manuscript or illustration missing from NSFW folder"
assert_contains "${VAULT}/Novels/NOVEL-12.md" "[[NSFW/小説/草稿/NOVEL-12/manuscript|本文を読む]]"
assert_contains "${BOARD}" "[[NSFW/小説/草稿/NOVEL-12/manuscript|草稿]]"
[[ -f "${VAULT}/NSFW/小説/草稿/NOVEL-12/manuscript.md" ]] || fail "NSFW wiki destination does not resolve"
# Removing #nsfw later must not silently downgrade or copy the draft into SFW.
sed -i '/NOVEL-12/s/ #nsfw / /' "${BOARD}"
bb "${RUNNER}" sync-drafts NOVEL-12 >>"${TMP}/runner.log" 2>&1
[[ -s "${NSFW_DRAFT}" ]] || fail "NSFW draft disappeared after attempted downgrade"
[[ ! -e "${VAULT}/Novels/Drafts/NOVEL-12/manuscript.md" ]] || fail "NSFW draft leaked into SFW folder"
move_card NOVEL-12 Done
tick
[[ -z "$(find "${VAULT}/小説草案/AI執筆" -maxdepth 1 -name '*_区分テスト.md' -print -quit)" ]] || fail "sticky NSFW draft was published into SFW folder"
sed -i '/NOVEL-12/s/ status::done/ #nsfw status::done/' "${BOARD}"
tick
[[ -n "$(find "${VAULT}/NSFW/小説/AI執筆" -maxdepth 1 -name '*_区分テスト.md' | head -n 1)" ]] || fail "nsfw card must publish under NSFW/"
echo "PASS: nsfw routing follows the card tag"

# A symlinked destination is rejected and must not write outside the vault.
add_card Review "- [ ] [[Novels/NOVEL-20|NOVEL-20: symlink境界]] #novel status::review assignee::boxp"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-20.md"
mkdir -p "${STATE}/work/NOVEL-20" "${TMP}/outside"
{ echo '# Symlink test'; for _ in $(seq 1 40); do echo 'This manuscript is long enough for the draft sync validation.'; done; } >"${STATE}/work/NOVEL-20/manuscript.md"
mkdir -p "${STATE}/runs/NOVEL-20/run-1"
cat >"${STATE}/runs/NOVEL-20/run-1/summary.edn" <<'EOF'
{:novel "NOVEL-20" :run-id "run-1" :status :succeeded :next-status "review"
 :action :write :agent "localllm" :model "gemma4-26b" :manuscript-chars 1000
 :illustration {:ok? false}}
EOF
sed -i 's/^last-run:.*/last-run: run-1/' "${VAULT}/Novels/NOVEL-20.md"
mkdir -p "${VAULT}/Novels/Drafts"
ln -s "${TMP}/outside" "${VAULT}/Novels/Drafts/NOVEL-20"
if bb "${RUNNER}" sync-drafts NOVEL-20 >>"${TMP}/runner.log" 2>&1; then
  fail "symlinked draft destination should fail explicit sync"
fi
[[ ! -e "${TMP}/outside/manuscript.md" ]] || fail "symlink sync wrote outside the vault"
echo "PASS: symlink boundary"

# Private originals are also protected from symlink traversal.
add_card Review "- [ ] [[Novels/NOVEL-21|NOVEL-21: private symlink境界]] #novel status::review assignee::boxp"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-21.md"
mkdir -p "${STATE}/work/NOVEL-21" "${STATE}/runs/NOVEL-21/run-1"
printf 'outside private file\n' >"${TMP}/outside/private-manuscript.md"
ln -s "${TMP}/outside/private-manuscript.md" "${STATE}/work/NOVEL-21/manuscript.md"
cat >"${STATE}/runs/NOVEL-21/run-1/summary.edn" <<'EOF'
{:novel "NOVEL-21" :run-id "run-1" :status :succeeded :next-status "review"
 :action :write :agent "localllm" :model "gemma4-26b" :manuscript-chars 1000
 :illustration {:ok? false}}
EOF
sed -i 's/^last-run:.*/last-run: run-1/' "${VAULT}/Novels/NOVEL-21.md"
if bb "${RUNNER}" sync-drafts NOVEL-21 >>"${TMP}/runner.log" 2>&1; then
  fail "symlinked private manuscript should fail explicit sync"
fi
[[ ! -e "${VAULT}/Novels/Drafts/NOVEL-21/manuscript.md" ]] || fail "private symlink content was copied into vault"
echo "PASS: private symlink boundary"

# A pre-existing manuscript without a runner state record is treated as human
# content and kept; the runner writes its copy to a separate managed path.
add_card Review "- [ ] [[Novels/NOVEL-22|NOVEL-22: stateなし既存草稿]] #novel status::review assignee::boxp"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-22.md"
mkdir -p "${STATE}/work/NOVEL-22" "${STATE}/runs/NOVEL-22/run-1" "${VAULT}/Novels/Drafts/NOVEL-22"
{ echo '# State-less conflict'; for _ in $(seq 1 40); do echo 'This is an existing human-authored draft that must not be overwritten.'; done; } >"${STATE}/work/NOVEL-22/manuscript.md"
printf 'Human draft created before runner state existed.\n' >"${VAULT}/Novels/Drafts/NOVEL-22/manuscript.md"
cat >"${STATE}/runs/NOVEL-22/run-1/summary.edn" <<'EOF'
{:novel "NOVEL-22" :run-id "run-1" :status :succeeded :next-status "review"
 :action :write :agent "localllm" :model "gemma4-26b" :manuscript-chars 1000
 :illustration {:ok? false}}
EOF
sed -i 's/^last-run:.*/last-run: run-1/' "${VAULT}/Novels/NOVEL-22.md"
bb "${RUNNER}" sync-drafts NOVEL-22 >>"${TMP}/runner.log" 2>&1
assert_contains "${VAULT}/Novels/Drafts/NOVEL-22/manuscript.md" "Human draft created before runner state existed"
[[ -n "$(find "${VAULT}/Novels/Drafts/NOVEL-22" -maxdepth 1 -name 'manuscript.runner-*.md' -print -quit)" ]] || fail "state-less manual draft was overwritten instead of preserved"
# A human edit made after the pending plan was journaled is preserved on replay;
# the runner replans onto a fresh managed filename and then becomes idempotent.
STATE22="${STATE}/drafts/NOVEL-22.edn"
PENDING_PATH="$(bb "${TMP}/bin/mark-draft-pending.bb" "${STATE22}")"
printf '\nHuman edit during pending recovery.\n' >>"${PENDING_PATH}"
bb "${RUNNER}" sync-drafts NOVEL-22 >>"${TMP}/runner.log" 2>&1
assert_contains "${PENDING_PATH}" "Human edit during pending recovery"
NEW_STATE22_PATH="$(bb "${TMP}/bin/draft-state-path.bb" "${STATE22}")"
[[ "${NEW_STATE22_PATH}" != "${PENDING_PATH}" ]] || fail "pending recovery overwrote a human-edited output"
sha256sum "${NEW_STATE22_PATH}" "${VAULT}/Novels/NOVEL-22.md" "${STATE22}" >"${TMP}/pending-conflict-before.sha"
bb "${RUNNER}" sync-drafts NOVEL-22 >>"${TMP}/runner.log" 2>&1
sha256sum -c "${TMP}/pending-conflict-before.sha" >/dev/null || fail "pending conflict recovery was not idempotent"
echo "PASS: state-less existing draft is preserved"


# ---------------------------------------------------------------------------
# BOXP-249: assignee can be changed on the card or in the management note
# ---------------------------------------------------------------------------
set_note_assignee() { sed -i -E "0,/^assignee:.*/s//assignee: $2/" "${VAULT}/Novels/$1.md"; }
note_assignee() { grep -m1 -E '^assignee:' "${VAULT}/Novels/$1.md" | sed -E 's/^assignee:\s*//'; }

# Note edit (Backlog) starts groom just like a card edit
add_card Backlog "- [ ] [[Novels/NOVEL-40|NOVEL-40: ノート担当テスト]] #novel status::backlog assignee::boxp"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-40.md"
tick
[[ -f "${STATE}/assignee-sync/NOVEL-40.edn" ]] || fail "assignee sync state should be recorded once both sides agree"
set_note_assignee NOVEL-40 localllm
tick
assert_contains "${TMP}/runner.log" "NOVEL-40 assignee changed in the management note: boxp -> localllm (synced to the card)"
[[ "$(lane_of "${BOARD}" NOVEL-40)" == "Draft" ]] || fail "note assignee change should start groom and move to Draft"
assert_contains "${BOARD}" "[[Novels/NOVEL-40|NOVEL-40: ノート担当テスト]] #novel status::draft assignee::boxp"
[[ "$(note_assignee NOVEL-40)" == "boxp" ]] || fail "note assignee should be boxp after the hand-off"
[[ "$(find "${STATE}/runs/NOVEL-40" -name summary.edn | wc -l)" == "1" ]] || fail "note assignee change should start exactly one run"
assert_contains "${VAULT}/Novels/NOVEL-40.md" "started: action=groom agent=localllm from Backlog"
tick
[[ "$(find "${STATE}/runs/NOVEL-40" -name summary.edn | wc -l)" == "1" ]] || fail "boxp on both sides must not restart"
echo "PASS: management note assignee starts the run"

# First introduction: a stale note value never rolls back a fresh card
add_card Draft "- [ ] [[Novels/NOVEL-41|NOVEL-41: 初回導入テスト]] #novel status::draft assignee::boxp"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-41.md"
set_note_assignee NOVEL-41 localllm
rm -f "${STATE}/assignee-sync/NOVEL-41.edn"
tick
assert_contains "${BOARD}" "[[Novels/NOVEL-41|NOVEL-41: 初回導入テスト]] #novel status::draft assignee::boxp"
[[ "$(note_assignee NOVEL-41)" == "boxp" ]] || fail "without sync state the card value wins"
[[ ! -d "${STATE}/runs/NOVEL-41" ]] || fail "first introduction must not start a run"
echo "PASS: first introduction keeps the card value"

# Card edit still syncs to the note; unsupported names via the note stay on the card
set_assignee NOVEL-41 pi
tick
[[ "$(note_assignee NOVEL-41)" == "pi" ]] || fail "card edit should sync to the note"
[[ "$(count_matches "${VAULT}/Novels/NOVEL-41.md" 'assignee `pi` は対応していない')" == "1" ]] || fail "unsupported assignee logged once"
set_note_assignee NOVEL-41 boxp
tick
assert_contains "${BOARD}" "[[Novels/NOVEL-41|NOVEL-41: 初回導入テスト]] #novel status::draft assignee::boxp"
[[ ! -d "${STATE}/runs/NOVEL-41" ]] || fail "unassigning via the note must not start a run"
set_note_assignee NOVEL-41 pi2
tick
assert_contains "${BOARD}" "status::draft assignee::pi2"
[[ "$(count_matches "${VAULT}/Novels/NOVEL-41.md" 'assignee `pi2` は対応していない')" == "1" ]] || fail "unsupported note assignee is logged once and kept"
echo "PASS: card edit, unassign via note, unsupported via note"

# Both sides changed since the last agreement: the card wins, recorded once
set_assignee NOVEL-41 pi3
set_note_assignee NOVEL-41 pi4
tick
assert_contains "${BOARD}" "status::draft assignee::pi3"
[[ "$(note_assignee NOVEL-41)" == "pi3" ]] || fail "conflict should settle on the card value"
[[ "$(count_matches "${VAULT}/Novels/NOVEL-41.md" '担当の同時変更を検出しました: カード `pi3` / 管理ノート `pi4`')" == "1" ]] || fail "conflict is recorded once"
sha256sum "${BOARD}" "${VAULT}/Novels/NOVEL-41.md" >"${TMP}/conflict.sha"
tick
sha256sum -c "${TMP}/conflict.sha" >/dev/null || fail "re-tick after a conflict must be idempotent"
[[ "$(count_matches "${VAULT}/Novels/NOVEL-41.md" '担当の同時変更を検出しました')" == "1" ]] || fail "conflict must not be recorded on every tick"
set_assignee NOVEL-41 boxp
tick

# Note re-assigned during an active run is kept and handed over after the run
add_card Draft "- [ ] [[Novels/NOVEL-42|NOVEL-42: run中ノート変更テスト]] #novel status::draft assignee::localllm"
cp "${VAULT}/Templates/Novel Management.md" "${VAULT}/Novels/NOVEL-42.md"
write_requirements NOVEL-42
echo slow >"${MODE_FILE}"
tick & T1=$!
sleep 1.5
set_note_assignee NOVEL-42 pi
wait "${T1}"
echo normal >"${MODE_FILE}"
[[ "$(lane_of "${BOARD}" NOVEL-42)" == "Review" ]] || fail "run should finish in Review"
assert_contains "${BOARD}" "status::review assignee::boxp"
[[ "$(note_assignee NOVEL-42)" == "pi" ]] || fail "a note re-assignment made during the run must survive the hand-off"
tick
assert_contains "${BOARD}" "status::review assignee::pi"
[[ "$(count_matches "${VAULT}/Novels/NOVEL-42.md" 'assignee `pi` は対応していない')" == "1" ]] || fail "handed-over note assignee is processed after the run"
[[ "$(find "${STATE}/runs/NOVEL-42" -name summary.edn | wc -l)" == "1" ]] || fail "exactly one run expected for NOVEL-42"
set_assignee NOVEL-42 boxp
tick
echo "PASS: note re-assignment during a run is handed over after the run"

# Kanban UI doubles the checkbox on manually added titles; scaffold strips it
add_card Backlog "- [ ] - [ ] 二重チェックボックス assignee::localllm"
tick
NEW_ID="$(grep -o 'NOVEL-[0-9]*: 二重チェックボックス' "${BOARD}" | head -1 | cut -d: -f1)"
[[ -n "${NEW_ID}" ]] || fail "double-checkbox title should be scaffolded with a clean title"
assert_not_contains "${BOARD}" "- [ ] 二重チェックボックス]]"
assert_contains "${VAULT}/Novels/${NEW_ID}.md" "# ${NEW_ID}: 二重チェックボックス"
assert_contains "${VAULT}/Novels/${NEW_ID}.md" "title: 二重チェックボックス"
[[ "$(lane_of "${BOARD}" "${NEW_ID}")" == "Draft" ]] || fail "scaffolded card with localllm should be groomed"
echo "PASS: duplicated checkbox is stripped at scaffold"

# Rule cards are never scaffolded
[[ "$(grep -c '#novel-rule' "${BOARD}")" == "5" ]] || fail "rule cards must stay untouched"
assert_not_contains "${BOARD}" "NOVEL-17"

# Private root permissions
[[ "$(stat -c %a "${STATE}")" == "700" ]] || fail "state root must be 0700"

echo "All novel-board runner tests passed."
