#!/usr/bin/env bb
(require '[babashka.fs :as fs] '[babashka.process :as p] '[cheshire.core :as json]
         '[clojure.edn :as edn] '[clojure.string :as str] '[clojure.java.io :as io])
(import '[java.time Instant LocalDate ZoneOffset] '[java.nio.file Files StandardCopyOption] '[java.io RandomAccessFile])
(def families {"claude-fable" "fable" "claude-opus" "opus" "claude-sonnet" "sonnet"})
(def official-source "https://platform.claude.com/docs/en/about-claude/models/overview.md")
(def args (vec *command-line-args*))
(def command (first args))
(defn opt [key] (some->> (partition 2 1 (rest args)) (some #(when (= key (first %)) (second %)))))
(defn env [k default] (or (System/getenv k) default))
(def root (str (System/getProperty "user.home") "/.codex-task-board/model-updates"))
(def state-path (env "CODEX_TASK_BOARD_MODEL_STATE" (str root "/state.edn")))
(def catalog-path (or (opt "--catalog") (System/getenv "CODEX_TASK_BOARD_MODEL_CATALOG") "/opt/codex-workspace/model-catalog.edn"))
(defn read-edn [path fallback] (try (edn/read-string (slurp path)) (catch Exception _ fallback)))
(defn atomic! [path value] (let [f (io/file path) _ (fs/create-dirs (.getParentFile (.getAbsoluteFile f))) tmp (str path "." (java.util.UUID/randomUUID) ".tmp")]
                             (spit tmp (str (pr-str value) "\n"))
                             (Files/move (.toPath (io/file tmp)) (.toPath f) (into-array StandardCopyOption [StandardCopyOption/ATOMIC_MOVE StandardCopyOption/REPLACE_EXISTING]))))
(defn model-version [family model] (when (string? model) (when-let [[_ a b] (re-matches (re-pattern (str "claude-" family "-([0-9]+)-([0-9]+)")) model)] [(bigint a) (bigint b)])))
(defn run [cmd & [options]] (try @(p/process cmd (merge {:out :string :err :string} options)) (catch Exception e {:exit 1 :out "" :err (.getMessage e)})))
(defn get-text [url file] (if file (try (slurp file) (catch Exception _ nil)) (let [r (run ["curl" "-fsSL" "--max-time" "30" url])] (when (zero? (:exit r)) (:out r)))))
(defn catalog! []
  (let [c (with-open [reader (java.io.PushbackReader. (io/reader catalog-path))]
            (let [eof (Object.) value (edn/read {:eof eof} reader)]
              (when-not (identical? eof (edn/read {:eof eof} reader)) (throw (ex-info "trailing catalog data" {})))
              value))]
    (when-not (and (= 1 (:version c)) (map? (:roles c))
                   (every? (fn [[role family]]
                             (let [entry (get-in c [:roles role]) previous (:previous entry)]
                               (and (= family (:family entry)) (model-version family (:model entry))
                                    (or (nil? previous) (model-version family previous))))) families))
      (throw (ex-info "invalid catalog" {}))) c))
(defn canary [model]
  (when-not (some #(model-version % model) (vals families)) (throw (ex-info "invalid canary model" {})))
  (let [bin (env "MODEL_UPDATES_CLAUDE_BIN" "claude")
        r (run ["timeout" "300" bin "--print" "--model" model "--output-format" "stream-json" "--verbose" "--tools" "Bash" "--allowedTools" "Bash(echo:*)" "--no-session-persistence" "Run the shell command: echo boxp-model-canary. Then reply with exactly the command output."]
               {:env (apply dissoc (into {} (System/getenv)) ["ANTHROPIC_API_KEY" "ANTHROPIC_AUTH_TOKEN" "ANTHROPIC_BASE_URL" "ANTHROPIC_CUSTOM_HEADERS" "CLAUDE_CODE_USE_BEDROCK" "CLAUDE_CODE_USE_VERTEX" "CLAUDE_CODE_USE_FOUNDRY"])})
        events (keep #(try (json/parse-string % true) (catch Exception _ nil)) (str/split-lines (:out r)))
        result (last (filter #(= "result" (:type %)) events))
        tool? (boolean (some (fn [e] (or (= "tool_use" (:type e)) (some #(= "tool_use" (:type %)) (get-in e [:message :content])))) events))
        usage (set (map name (keys (:modelUsage result))))
        ok? (boolean (and (zero? (:exit r)) (= false (:is_error result)) (str/includes? (str (:result result)) "boxp-model-canary") (= #{model} usage) tool? (not (str/includes? (:err r) "unrecognized_model"))))
        report {:model model :at (str (Instant/now)) :exit (:exit r) :result-ok (= false (:is_error result)) :marker (str/includes? (str (:result result)) "boxp-model-canary") :model-usage (vec usage) :tool-use tool? :unrecognized-model (str/includes? (:err r) "unrecognized_model") :ok ok?}
        path (str root "/canary/" (str/replace (str (Instant/now)) #":" "-") "-" model ".json")]
    (fs/create-dirs (fs/parent path)) (spit path (json/generate-string report)) report))
(def retention-source "https://platform.claude.com/docs/en/manage-claude/api-and-data-retention.md")
(defn retention-covered
  "Whether the official retention page lists this model as requiring 30-day
  retention. nil when the page or its requirement lines cannot be read."
  [text family model]
  (when-let [[major minor] (model-version family model)]
    (let [lines (filter #(and (re-find #"(?i)data retention" %) (re-find #"(?i)requires?" %)) (some-> text str/split-lines))
          name (str "Claude " (str/capitalize family) " " major "." minor)
          pattern (re-pattern (str (java.util.regex.Pattern/quote name) "(?![0-9])"))]
      (when (seq lines) (boolean (some #(re-find pattern %) lines))))))
(defn ticket! [role model kind]
  (let [summary (java.io.File/createTempFile "model-update-" ".md")
        cmd (env "MODEL_UPDATES_TASK_BOARD_CMD" (str (System/getProperty "user.home") "/.claude/skills/obsidian-task-board/bin/task-board.bb"))
        _ (spit summary (str "モデル " role " を " model " へ更新します。種別: " (name kind) "\n\n種別が waiting-cli の場合は 2 段階で進める。(1) pin はまだ変えず、npm の @anthropic-ai/claude-code で候補 ID を内蔵する版 (platform package を npm pack して strings で確認) へ CLAUDE_CODE_VERSION と :min-cli だけを上げる通常 PR → review/CI → merge → 配備。(2) 配備後 `bb /opt/codex-workspace/model-updates/model_updates.bb tick --force` で候補の status が proposed (候補 canary 合格) になったことを確認してから次へ進む。canary-failed なら pin せず Notes に記録して止める。\n\n候補 canary 合格後 (種別 candidate は起票時点で合格済み) に `bb /opt/codex-workspace/model-updates/model_updates.bb pin --catalog docker/codex-workspace/model-catalog.edn --role " role " --model " model " --ticket BOXP-N` を実行。pin は候補 canary の合格記録が無ければその場で canary し、不合格なら失敗する。通常 PR → review/CI → merge → 配備後 `model_updates.bb tick --force` で verified を確認。\n"))
        prefix (if (str/ends-with? cmd ".bb") ["bb" cmd] [cmd])
        r (run (into prefix ["create" "--vault" (env "CODEX_TASK_BOARD_VAULT" "/home/boxp/Documents/obsidian-headless/BOXP") "--lane" "Ready" "--assignee" "codex-terra" "--priority" "medium" "--repo" "boxp/arch" "--title" (str "モデル自動追従: " role " を " model " へ更新") "--summary-file" (str summary)]))]
    (.delete summary)
    (when (zero? (:exit r)) (some-> (re-find #"BOXP-[0-9]+" (:out r)) str))))
(defn proposal [state role model kind]
  (let [key [role model] ticket (get-in state [:proposals key])
        note-key [role model :verification-failed]]
    (cond
      (and ticket (= kind :verification-failed) (not (get-in state [:verification-notes note-key])))
      (let [cmd (env "MODEL_UPDATES_TASK_BOARD_CMD" (str (System/getProperty "user.home") "/.claude/skills/obsidian-task-board/bin/task-board.bb"))
            prefix (if (str/ends-with? cmd ".bb") ["bb" cmd] [cmd])
            result (run (into prefix ["append-note" ticket "--vault" (env "CODEX_TASK_BOARD_VAULT" "/home/boxp/Documents/obsidian-headless/BOXP") "--source" "model-updates" "--note" (str "配備後 canary 失敗: " role " " model "。previous がある場合は hold します。")]))]
        (if (zero? (:exit result)) (assoc-in state [:verification-notes note-key] true) state))
      ticket state
      :else (if-let [created (ticket! role model kind)] (assoc-in state [:proposals key] created) state))))
(defn json-safe [v]
  (cond (map? v) (into {} (map (fn [[k x]] [(if (or (string? k) (keyword? k)) k (pr-str k)) (json-safe x)]) v))
        (vector? v) (mapv json-safe v)
        (sequential? v) (mapv json-safe v)
        :else v))
(defn tick! []
  (let [catalog (catalog!) state (read-edn state-path {}) today (str (LocalDate/now ZoneOffset/UTC)) now (str (Instant/now))]
    (if (and (= today (:last-check-date state)) (not (some #{"--force"} args)))
      {:status :skipped :date today}
      (let [text (get-text (env "MODEL_UPDATES_OFFICIAL_URL" official-source) (opt "--official-file"))
            line (some #(when (str/starts-with? % "| Claude API ID") %) (some-> text str/split-lines))
            ids (set (map second (re-seq #"`([^`]+)`" (or line ""))))
            cli (env "MODEL_UPDATES_CLAUDE_BIN" "claude") version (run [cli "--version"])
            bin (run ["sh" "-c" "command -v -- \"$1\"" "sh" cli])
            resolved (when (zero? (:exit bin)) (try (str (.toRealPath (.toPath (io/file (str/trim (:out bin)))) (make-array java.nio.file.LinkOption 0))) (catch Exception _ nil)))
            cli-text (if-let [f (opt "--cli-ids-file")] (get-text nil f) (when resolved (:out (run ["strings" resolved]))))
            cli-ids (set (map second (re-seq #"(?:^|[^a-zA-Z0-9_.-])(claude-(?:fable|opus|sonnet)-[0-9]+-[0-9]+)(?![a-zA-Z0-9_.-])" (or cli-text ""))))
            initial (assoc state :last-check-date today :last-check-at now :cli-version (str/trim (:out version)))
            final (reduce (fn [s [role family]]
                     (let [entry (get-in catalog [:roles role]) current (:model entry) old (get-in s [:verified role])
                           verification (when (and current (not= current old)) (canary current))
                           s (if verification
                               (if (:ok verification) (cond-> (-> s (assoc-in [:verified role] current) (update :history (fnil conj []) {:role role :model current :at now}))
                                     (get-in s [:auto-hold role]) (-> (update :hold dissoc role) (update :auto-hold dissoc role)))
                                   (cond-> (proposal s role current :verification-failed) (and (:previous entry) (or (nil? (get-in s [:hold role])) (get-in s [:auto-hold role]))) (-> (assoc-in [:hold role] (:previous entry)) (assoc-in [:auto-hold role] true)))) s)
                           candidates (filter #(when-let [v (model-version family %)] (and (model-version family current) (pos? (compare v (model-version family current))))) ids)
                           candidate (last (sort-by #(model-version family %) candidates))
                           retention (when candidate (get-text (env "MODEL_UPDATES_RETENTION_URL" retention-source) (opt "--retention-file")))
                           old-cover (when candidate (retention-covered retention family current)) new-cover (when candidate (retention-covered retention family candidate))
                           existing (when candidate (get-in s [:proposals [role candidate]]))
                           result (cond (nil? line) {:status :catalog-error :reason "公式 catalog の取得または解析に失敗"}
                                        (and verification (not (:ok verification))) {:status :verification-failed :reason "配備後 canary 失敗"}
                                        (nil? candidate) {:status :current}
                                        (or (nil? old-cover) (nil? new-cover) (not= old-cover new-cover)) {:status :policy-diff :candidate candidate :reason "保持条件の取得失敗または差分"}
                                        (not (contains? cli-ids candidate)) {:status :waiting-cli :candidate candidate :reason "配備 CLI が未対応: 更新票で CLAUDE_CODE_VERSION も上げる"}
                                        (and existing (get-in s [:candidate-verified [role candidate]])) {:status :proposed :candidate candidate}
                                        :else (if (:ok (canary candidate)) {:status :proposed :candidate candidate :canary-ok true} {:status :canary-failed :candidate candidate :reason "canary の判定に失敗"}))
                           s (if (:canary-ok result) (assoc-in s [:candidate-verified [role candidate]] true) s)
                           result (dissoc result :canary-ok)
                           s (if (#{:proposed :waiting-cli} (:status result)) (proposal s role candidate (if (= :waiting-cli (:status result)) :waiting-cli :candidate)) s)
                           result (if (and (#{:proposed :waiting-cli} (:status result)) (nil? (get-in s [:proposals [role candidate]]))) (assoc result :status :ticket-error :reason "起票失敗") result)]
                       (assoc-in s [:roles role] (merge {:candidate candidate :reason nil} result)))) initial families)]
        (atomic! state-path final) {:status :checked :roles (:roles final)}))))
;; tick holds the lock for its whole read-modify-write of state; hold, release
;; and pin wait for it (blocking) so a running tick cannot overwrite their change.
(defn with-lock [f & [wait?]] (fs/create-dirs root) (with-open [raf (RandomAccessFile. (str root "/tick.lock") "rw") ch (.getChannel raf)]
                       (if (if wait? (.lock ch) (try (.tryLock ch) (catch Exception _ nil))) (f) ;; closing the channel releases the lock (bb does not expose FileLock methods)
                         (let [event {:status :locked :at (str (Instant/now))}]
                           (spit (str root "/lock-events.jsonl") (str (json/generate-string event) "\n") :append true) event))))
(try
  (let [result (case command
                 "status" (let [state (read-edn state-path {})] {:catalog (catalog!) :state state :last-check (select-keys state [:last-check-date :last-check-at :roles])})
                 "tick" (with-lock tick!)
                 "canary" (canary (or (opt "--model") (throw (ex-info "--model required" {}))))
                 "pin" (with-lock #(let [c (catalog!) role (opt "--role") model (opt "--model") family (get families role) old (get-in c [:roles role :model])]
                         (when-not (and family (model-version family model) old) (throw (ex-info "invalid role or model" {})))
                         ;; Never pin an unverified candidate: require the tick's recorded canary pass, or pass one now.
                         (let [s (read-edn state-path {})]
                           (when-not (get-in s [:candidate-verified [role model]])
                             (if (:ok (canary model))
                               (atomic! state-path (assoc-in s [:candidate-verified [role model]] true))
                               (throw (ex-info "candidate canary failed; not pinning" {:model model})))))
                         (let [c (-> c (assoc-in [:roles role :previous] old) (assoc-in [:roles role :model] model) (assoc-in [:roles role :verified-at] (str (Instant/now))) (update-in [:roles role :history] (fnil conj []) {:model model :since (str (LocalDate/now ZoneOffset/UTC)) :ticket (opt "--ticket")}))] (atomic! catalog-path c) {:status :pinned :role role :model model})) true)
                 "hold" (with-lock #(let [c (catalog!) role (opt "--role") model (opt "--model") entry (get-in c [:roles role])]
                          (when-not (and (model-version (get families role) model) (some #{model} [(:model entry) (:previous entry)])) (throw (ex-info "invalid hold" {})))
                          (let [s (-> (read-edn state-path {}) (assoc-in [:hold role] model) (update :auto-hold dissoc role))] (atomic! state-path s) {:status :held :role role :model model})) true)
                 "release" (with-lock #(let [role (opt "--role") _ (when-not (contains? families role) (throw (ex-info "invalid role" {}))) s (-> (read-edn state-path {}) (update :hold dissoc role) (update :auto-hold dissoc role))] (atomic! state-path s) {:status :released :role role}) true)
                 (throw (ex-info "expected status, tick, canary, pin, hold or release" {})))]
    (println (json/generate-string (json-safe result))) (when (and (= command "canary") (not (:ok result))) (System/exit 1)))
  (catch Exception e (binding [*out* *err*] (println (.getMessage e))) (System/exit 1)))
