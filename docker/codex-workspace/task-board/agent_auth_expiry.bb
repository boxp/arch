#!/usr/bin/env bb

;; BOXP-204: agent CLI の認証期限を、手動再ログインが必要になる前に知らせるための観測。
;; 定義 agent-auth/v1。ここでは非秘密のメタデータ（期限の時刻・最終更新時刻・存在の有無）
;; だけを数値と enum で書き出し、通知は Prometheus のルールと Alertmanager → Hermes
;; (boxp-notify: 家と Telegram) が担う。
;;
;; 守ること:
;; - token / refresh token / API key / account 識別子 / メール / 例外メッセージを出力・保存しない。
;;   認証ファイルは process 内で読み、許可した数値と enum だけを取り出してすぐ捨てる。
;; - access token の期限（CLI が自動更新する）と、手動再ログインが必要になる期限
;;   （refresh token の期限）を区別する。後者が公開されていない provider は unknown のまま。
;; - Antigravity (agy) の認証は読まない（BOXP-630: runner は Antigravity / Google の
;;   credential を読まない契約）。run の認証失敗と成功の時刻だけを記録する。
;; - CLI の login / logout / refresh を呼ばない。独自の OAuth 更新はしない。

(ns agent-auth-expiry
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.string :as str]))

(def definition-version "agent-auth/v1")

(def max-credential-bytes (* 64 1024))

(def providers ["claude" "codex" "antigravity"])

(defn- home [] (System/getProperty "user.home"))

(defn claude-credentials-path []
  (let [dir (System/getenv "CLAUDE_CONFIG_DIR")]
    (str (fs/path (if (str/blank? dir) (fs/path (home) ".claude") dir) ".credentials.json"))))

(defn codex-auth-path []
  (let [dir (System/getenv "CODEX_HOME")]
    (str (fs/path (if (str/blank? dir) (fs/path (home) ".codex") dir) "auth.json"))))

(defn- epoch-seconds
  "Epoch seconds from a number that may be in ms or s. Anything else is nil."
  [v]
  (when (and (number? v) (pos? v))
    (let [v (long v)]
      (if (> v 100000000000) (quot v 1000) v))))

(defn- iso-seconds [v]
  (when (string? v)
    (try (.getEpochSecond (java.time.Instant/parse v))
         (catch Exception _
           (try (.toEpochSecond (java.time.OffsetDateTime/parse v))
                (catch Exception _ nil))))))

(defn- read-json-file
  "Parsed JSON or a fixed failure keyword. The exception (which can quote the
  file) is dropped on purpose."
  [path]
  (try
    (cond
      (not (fs/exists? path)) :missing
      (not (fs/readable? path)) :unreadable
      (> (fs/size path) max-credential-bytes) :unsupported
      :else (let [v (json/parse-string (slurp path))]
              (if (map? v) v :unsupported)))
    (catch Exception _ :unreadable)))

(defn- present-string? [v] (and (string? v) (not (str/blank? v))))

(defn claude-metadata
  "Claude Code subscription login (Linux: <config>/.credentials.json).
  expiresAt = access token (the CLI refreshes it by itself);
  refreshTokenExpiresAt = after this the Owner has to log in again."
  [path]
  (let [doc (read-json-file path)]
    (if (keyword? doc)
      {:provider "claude" :state (name doc)}
      (let [oauth (get doc "claudeAiOauth")
            access (epoch-seconds (get oauth "expiresAt"))
            relogin (epoch-seconds (get oauth "refreshTokenExpiresAt"))
            refresh? (present-string? (get oauth "refreshToken"))]
        (if (and (map? oauth) refresh?)
          (cond-> {:provider "claude" :state "ok" :method "subscription-login"}
            access (assoc :access-expiry access)
            relogin (assoc :relogin-deadline relogin :relogin-kind "refresh_token"))
          {:provider "claude" :state "unsupported"})))))

(defn codex-metadata
  "Codex CLI ChatGPT login ($CODEX_HOME/auth.json). The refresh token lifetime is
  not published, so the re-login deadline stays unknown; last_refresh shows
  whether the CLI's own refresh keeps happening."
  [path]
  (let [doc (read-json-file path)]
    (if (keyword? doc)
      {:provider "codex" :state (name doc)}
      (let [mode (get doc "auth_mode")
            refresh? (present-string? (get-in doc ["tokens" "refresh_token"]))
            last-refresh (iso-seconds (get doc "last_refresh"))]
        (cond
          ;; An API key in the file is not the subscription login this environment allows.
          (or (present-string? (get doc "OPENAI_API_KEY")) (= "apikey" mode))
          {:provider "codex" :state "policy_disallowed"}
          (and (= "chatgpt" mode) refresh?)
          (cond-> {:provider "codex" :state "ok" :method "subscription-login"}
            last-refresh (assoc :last-refresh last-refresh))
          :else {:provider "codex" :state "unsupported"})))))

;; ---- run outcomes (Antigravity: the credentials are never read) ----

(def outcome-lock (Object.))

(defn outcomes-path [root] (fs/path root "ai-ops" "agent-auth-outcomes.json"))

(defn atomic-write! [path content]
  (fs/create-dirs (fs/parent path))
  (let [tmp (fs/create-temp-file {:dir (fs/parent path) :prefix ".agent-auth-"})]
    (try (spit (str tmp) content)
         (fs/move tmp path {:replace-existing true :atomic-move true})
         (finally (fs/delete-if-exists tmp)))))

(defn read-outcomes [root]
  (let [path (outcomes-path root)]
    (try (let [v (when (fs/exists? path) (json/parse-string (slurp (str path))))]
           (if (map? v) v {}))
         (catch Exception _ {}))))

(defn record-run-outcome!
  "Record that a run of `provider` ended with an auth failure (:auth) or
  succeeded (:success). Only the provider enum and the time are kept."
  [root provider outcome now-s]
  (when (and (some #{provider} providers) (#{:auth :success} outcome))
    (locking outcome-lock
      (let [k (if (= :auth outcome) "auth_failure_at" "success_at")
            data (assoc-in (read-outcomes root) [provider k] now-s)]
        (atomic-write! (outcomes-path root) (json/generate-string data))))))

(defn antigravity-metadata [root]
  (let [o (get (read-outcomes root) "antigravity")
        fail (epoch-seconds (get o "auth_failure_at"))
        ok (epoch-seconds (get o "success_at"))]
    (cond-> {:provider "antigravity" :state "not_read"}
      fail (assoc :run-auth-failure fail)
      ok (assoc :run-success ok))))

(defn snapshot [root]
  [(claude-metadata (claude-credentials-path))
   (codex-metadata (codex-auth-path))
   (antigravity-metadata root)])

;; ---- exposition ----

(def states ["ok" "missing" "unreadable" "unsupported" "policy_disallowed" "not_read"])

(defn- line [metric labels value]
  (str metric "{" (str/join "," (map (fn [[k v]] (str (name k) "=\"" v "\"")) labels)) "} " value "\n"))

(defn prom-text [entries now-s]
  (let [gauge (fn [m help] (str "# HELP " m " " help "\n# TYPE " m " gauge\n"))]
    (str
     (gauge "ai_agent_auth_observed_timestamp_seconds" "When this agent auth snapshot was taken.")
     (line "ai_agent_auth_observed_timestamp_seconds" [[:definition_version definition-version]] now-s)
     (gauge "ai_agent_auth_metadata_state" "Whether the non-secret auth metadata could be read (1 for the current state).")
     (apply str (for [{:keys [provider state]} entries s states]
                  (line "ai_agent_auth_metadata_state" [[:provider provider] [:state s]] (if (= s state) 1 0))))
     (gauge "ai_agent_auth_relogin_deadline_known" "1 when the provider publishes when a manual re-login becomes necessary.")
     (apply str (for [{:keys [provider relogin-deadline]} entries]
                  (line "ai_agent_auth_relogin_deadline_known" [[:provider provider]] (if relogin-deadline 1 0))))
     (gauge "ai_agent_auth_relogin_deadline_timestamp_seconds" "After this time the Owner has to log in again (refresh token expiry).")
     (apply str (for [{:keys [provider relogin-deadline relogin-kind]} entries :when relogin-deadline]
                  (line "ai_agent_auth_relogin_deadline_timestamp_seconds" [[:provider provider] [:kind relogin-kind]] relogin-deadline)))
     (gauge "ai_agent_auth_access_expiry_timestamp_seconds" "Access token expiry. The CLI refreshes it by itself; not a re-login deadline.")
     (apply str (for [{:keys [provider access-expiry]} entries :when access-expiry]
                  (line "ai_agent_auth_access_expiry_timestamp_seconds" [[:provider provider]] access-expiry)))
     (gauge "ai_agent_auth_last_refresh_timestamp_seconds" "When the CLI last refreshed its own tokens.")
     (apply str (for [{:keys [provider last-refresh]} entries :when last-refresh]
                  (line "ai_agent_auth_last_refresh_timestamp_seconds" [[:provider provider]] last-refresh)))
     (gauge "ai_agent_auth_run_auth_failure_timestamp_seconds" "Last task-board run that ended with a login failure.")
     (apply str (for [{:keys [provider run-auth-failure]} entries :when run-auth-failure]
                  (line "ai_agent_auth_run_auth_failure_timestamp_seconds" [[:provider provider]] run-auth-failure)))
     (gauge "ai_agent_auth_run_success_timestamp_seconds" "Last task-board run that ended without a login failure.")
     (apply str (for [{:keys [provider run-success]} entries :when run-success]
                  (line "ai_agent_auth_run_success_timestamp_seconds" [[:provider provider]] run-success))))))

(defn write-metrics! [root]
  (try (atomic-write! (fs/path root "ai-ops" "agent-auth.prom")
                      (prom-text (snapshot root) (quot (System/currentTimeMillis) 1000)))
       true
       (catch Exception _ nil)))

;; ---- human status (after a re-login, to confirm the recovery) ----

(defn- hours [from to] (format "%.1fh" (/ (- to from) 3600.0)))

(defn status-lines [entries now-s]
  (for [{:keys [provider state relogin-deadline access-expiry last-refresh run-auth-failure run-success]} entries]
    (str provider ": metadata=" state
         " relogin-deadline=" (if relogin-deadline (str "in " (hours now-s relogin-deadline)) "unknown")
         (when access-expiry (str " access-token=in " (hours now-s access-expiry) " (auto refresh)"))
         (when last-refresh (str " last-refresh=" (hours last-refresh now-s) " ago"))
         (when (or run-auth-failure run-success)
           (str " last-run=" (if (and run-auth-failure (or (nil? run-success) (> run-auth-failure run-success)))
                               "auth-failure" "ok"))))))

(when (= (str (fs/canonicalize *file*)) (some-> (System/getProperty "babashka.file") fs/canonicalize str))
  (let [[cmd root] *command-line-args*
        root (or root (System/getenv "CODEX_TASK_BOARD_ROOT") (str (fs/path (home) ".codex-task-board")))
        now-s (quot (System/currentTimeMillis) 1000)]
    (case cmd
      "prom" (print (prom-text (snapshot root) now-s))
      "status" (doseq [l (status-lines (snapshot root) now-s)] (println l))
      (do (binding [*out* *err*] (println "usage: agent_auth_expiry.bb status|prom [TASK_BOARD_ROOT]"))
          (System/exit 2)))))
