#!/usr/bin/env bb
;; BOXP-204: agent CLI 認証期限の観測。fake credential だけを使い、秘密値の sentinel が
;; 出力・保存・例外のどこにも出ないことと、access 期限と再ログイン期限の区別を確かめる。
(require '[clojure.test :refer [deftest is testing run-tests]]
         '[babashka.fs :as fs]
         '[babashka.process :as p]
         '[cheshire.core :as json]
         '[clojure.string :as str])
(def module (str (fs/path (fs/parent (fs/parent (fs/parent (fs/canonicalize *file*))))
                          "docker/codex-workspace/task-board/agent_auth_expiry.bb")))
(load-file module)
(alias 'a 'agent-auth-expiry)

(def sentinel "SENTINEL-SECRET-6f1d0c")
(def now 1795000000)
(def tmp (str (fs/create-temp-dir {:prefix "agent-auth-test."})))

(defn- put [rel content]
  (let [path (fs/path tmp rel)]
    (fs/create-dirs (fs/parent path))
    (spit (str path) (if (string? content) content (json/generate-string content)))
    (str path)))

(def claude-file
  (put "claude/.credentials.json"
       {:claudeAiOauth {:accessToken sentinel :refreshToken sentinel
                        :expiresAt (* 1000 (+ now 3600)) :refreshTokenExpiresAt (* 1000 (+ now (* 50 3600)))
                        :scopes [sentinel] :subscriptionType sentinel}}))
(def codex-file
  (put "codex/auth.json"
       {:auth_mode "chatgpt" :OPENAI_API_KEY nil :last_refresh "2026-11-18T12:00:00.123Z"
        :tokens {:id_token sentinel :access_token sentinel :refresh_token sentinel :account_id sentinel}}))

(defn- leak? [x] (str/includes? (pr-str x) "SENTINEL"))

(deftest claude-separates-access-and-relogin
  (let [m (a/claude-metadata claude-file)]
    (is (= "ok" (:state m)))
    (is (= (+ now 3600) (:access-expiry m)) "access token 期限は自動更新対象として別に持つ")
    (is (= (+ now (* 50 3600)) (:relogin-deadline m)) "再ログイン期限は refresh token の期限")
    (is (not (leak? m)))))

(deftest codex-relogin-unknown
  (let [m (a/codex-metadata codex-file)]
    (is (= "ok" (:state m)))
    (is (nil? (:relogin-deadline m)) "期限非公開は unknown のまま推測しない")
    (is (number? (:last-refresh m)))
    (is (not (leak? m)))))

(deftest failure-states-are-fixed-enums
  (is (= "missing" (:state (a/claude-metadata (str (fs/path tmp "none.json"))))))
  (is (= "unreadable" (:state (a/claude-metadata (put "broken.json" (str "{\"x\": " sentinel)))))
      "壊れた JSON の例外メッセージ（中身を引用し得る）は捨てる")
  (is (= "unsupported" (:state (a/claude-metadata (put "other.json" {:claudeAiOauth {:expiresAt 1}})))))
  (is (= "policy_disallowed" (:state (a/codex-metadata (put "apikey.json" {:auth_mode "apikey" :OPENAI_API_KEY sentinel})))))
  (is (= "policy_disallowed" (:state (a/codex-metadata (put "mixed.json" {:auth_mode "chatgpt" :OPENAI_API_KEY sentinel
                                                                         :tokens {:refresh_token sentinel}})))))
  (is (= "unsupported" (:state (a/codex-metadata (put "nolog.json" {:auth_mode "chatgpt"})))))
  (is (not (leak? (a/claude-metadata (put "broken2.json" (str "[" sentinel)))))))

(deftest outcomes-and-exposition
  (let [root (str (fs/path tmp "root"))]
    (a/record-run-outcome! root "antigravity" :auth (- now 100))
    (a/record-run-outcome! root "unknown-provider" :auth now)
    (let [m (a/antigravity-metadata root)]
      (is (= {:provider "antigravity" :state "not_read" :run-auth-failure (- now 100)} m)))
    (a/record-run-outcome! root "antigravity" :success now)
    (let [entries [(a/claude-metadata claude-file) (a/codex-metadata codex-file) (a/antigravity-metadata root)]
          text (a/prom-text entries now)
          status (str/join "\n" (a/status-lines entries now))]
      (is (not (str/includes? text "SENTINEL")))
      (is (not (str/includes? status "SENTINEL")))
      (is (str/includes? text "ai_agent_auth_relogin_deadline_timestamp_seconds{provider=\"claude\",kind=\"refresh_token\"} 1795180000"))
      (is (str/includes? text "ai_agent_auth_relogin_deadline_known{provider=\"codex\"} 0"))
      (is (str/includes? text "ai_agent_auth_metadata_state{provider=\"antigravity\",state=\"not_read\"} 1"))
      (is (str/includes? text "ai_agent_auth_run_success_timestamp_seconds{provider=\"antigravity\"} 1795000000"))
      (is (str/includes? status "antigravity: metadata=not_read relogin-deadline=unknown last-run=ok"))
      (is (not (str/includes? (slurp (str (a/outcomes-path root))) "unknown-provider"))))))

(deftest cli-output-has-no-secret
  (let [env {"CLAUDE_CONFIG_DIR" (str (fs/path tmp "claude")) "CODEX_HOME" (str (fs/path tmp "codex"))
             "PATH" (System/getenv "PATH") "HOME" tmp}]
    (doseq [cmd ["status" "prom"]]
      (let [{:keys [out err exit]} (p/shell {:out :string :err :string :continue true :extra-env env}
                                            "bb" module cmd (str (fs/path tmp "root")))]
        (is (zero? exit))
        (is (not (str/includes? (str out err) "SENTINEL")) cmd)))))

(let [{:keys [fail error]} (run-tests)]
  (fs/delete-tree tmp)
  (System/exit (if (zero? (+ fail error)) 0 1)))
