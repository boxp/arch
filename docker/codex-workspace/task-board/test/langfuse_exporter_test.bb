#!/usr/bin/env bb
;; Fixtures are synthetic. Secret-shaped strings are built at runtime so scanners do not fire.
(require '[babashka.fs :as fs]
         '[cheshire.core :as json]
         '[clojure.string :as str]
         '[clojure.test :refer [deftest is run-tests testing]]
         '[org.httpkit.server :as server])
(load-file "docker/codex-workspace/task-board/langfuse_exporter.bb")
(alias 'lf 'langfuse-exporter)

(def run-id "20991231T000000Z-11111111-2222-3333-4444-555555555555")
(def ticket "BOXP-1")
(def thread-delegate "aaaaaaaa-0000-0000-0000-000000000001")
(def thread-review "aaaaaaaa-0000-0000-0000-000000000002")

(def s-github (str "ghp_" "syntheticgithubvalue123456"))
(def s-provider (str "sk-" "syntheticprovidervalue"))
(def s-password (str "synthetic" "PasswordValue"))
(def s-bearer (str "syntheticBearer" "Value9"))
(def s-env (str "synthetic" "EnvironmentValue"))
(def s-url (str "syntheticUrl" "Pass"))
(def s-thinking "SYNTHETIC-THINKING-BODY")
(def s-reasoning "SYNTHETIC-REASONING-BODY")
(def s-withheld "SYNTHETIC-WITHHELD-FILE-BODY")
(def all-secrets [s-github s-provider s-password s-bearer s-env s-url s-thinking s-reasoning s-withheld])

(defn jsonl [lines] (str (str/join "\n" (map json/generate-string lines)) "\n"))

(defn write-fixture!
  "A finished Claude run with a subagent, a delegated Codex child and a review gate."
  [base {:keys [run finished] :or {run run-id finished "2000-01-01T00:00:00Z"}}]
  (let [root (fs/path base ".codex-task-board")
        run-dir (fs/path root "runs" ticket run)
        project (fs/path base ".claude" "projects"
                         (str/replace (str (fs/path root "workspaces" ticket run)) #"[^A-Za-z0-9]" "-"))
        day (fs/path base ".codex" "sessions" "2099" "12" "31")
        assistant (fn [id ts content]
                    {:type "assistant" :timestamp ts
                     :message {:id id :model "claude-test" :role "assistant" :content content
                               :usage {:input_tokens 10 :output_tokens 5
                                       :cache_read_input_tokens 3 :cache_creation_input_tokens 2}}})
        codex-lines (fn [prefix]
                      [{:timestamp "2099-12-31T00:01:00Z" :type "session_meta"
                        :payload {:base_instructions {:text "CODEX-BASE-INSTRUCTIONS"}}}
                       {:timestamp "2099-12-31T00:01:01Z" :type "turn_context" :payload {:model "codex-test"}}
                       {:timestamp "2099-12-31T00:01:02Z" :type "response_item"
                        :payload {:type "message" :role "user" :content [{:type "input_text" :text (str prefix " request " s-provider)}]}}
                       {:timestamp "2099-12-31T00:01:03Z" :type "response_item"
                        :payload {:type "reasoning" :encrypted_content s-reasoning :summary [{:text s-reasoning}]}}
                       {:timestamp "2099-12-31T00:01:04Z" :type "response_item"
                        :payload {:type "custom_tool_call" :call_id "c1" :name "exec" :input "ls" :status "completed"}}
                       {:timestamp "2099-12-31T00:01:05Z" :type "event_msg"
                        :payload {:type "token_count"
                                  :info {:last_token_usage {:input_tokens 100 :cached_input_tokens 40 :cache_write_input_tokens 0
                                                            :output_tokens 30 :reasoning_output_tokens 10 :total_tokens 130}}}}
                       {:timestamp "2099-12-31T00:01:06Z" :type "response_item"
                        :payload {:type "custom_tool_call_output" :call_id "c1" :output "listing"}}
                       {:timestamp "2099-12-31T00:01:07Z" :type "response_item"
                        :payload {:type "message" :role "assistant" :content [{:type "output_text" :text (str prefix " done")}]}}])]
    (fs/create-dirs run-dir)
    (fs/create-dirs (fs/path project "sess" "subagents"))
    (fs/create-dirs day)
    (spit (str (fs/path run-dir "summary.edn"))
          (pr-str {:status :retrying :agent "claude-opus" :action :implement :lane "In Progress" :finished-at finished}))
    (spit (str (fs/path run-dir "prompt.md")) (str "runner prompt token=" s-password))
    (spit (str (fs/path run-dir "last-message.md")) (str "final Authorization: Bearer " s-bearer))
    (spit (str (fs/path run-dir "delegation.json")) (json/generate-string {:kind "delegated" :thread thread-delegate}))
    (spit (str (fs/path run-dir "codex-review-x-usage.jsonl")) (jsonl [{:thread_id thread-review}]))
    (spit (str (fs/path project "sess.jsonl"))
          (jsonl
           [{:type "api-request-blob" :hash "h1" :message {:role "system" :content [{:type "text" :text "CLI-SYSTEM-PROMPT"}]}}
            {:type "api-request-blob" :hash "h1" :message {:role "system" :content [{:type "text" :text "CLI-SYSTEM-PROMPT"}]}}
            {:type "api-request-blob" :hash "h2" :message {:role "assistant" :content [{:type "thinking" :thinking s-thinking}]}}
            {:type "user" :timestamp "2099-12-31T00:00:01Z"
             :message {:role "user" :content (str "hello " s-github " https://u:" s-url "@example.test/x")}}
            {:type "attachment" :timestamp "2099-12-31T00:00:01Z" :attachment {:type "environment" :text (str "value " s-env)}}
            (assistant "m1" "2099-12-31T00:00:02Z" [{:type "thinking" :thinking s-thinking}])
            (assistant "m1" "2099-12-31T00:00:02Z" [{:type "text" :text "reading"}])
            (assistant "m1" "2099-12-31T00:00:03Z"
                       [{:type "tool_use" :id "t1" :name "Read" :input {:file_path "/home/test/.ssh/id_rsa"}}])
            {:type "user" :timestamp "2099-12-31T00:00:04Z"
             :message {:role "user" :content [{:type "tool_result" :tool_use_id "t1" :content s-withheld}]}}
            (assistant "m2" "2099-12-31T00:00:05Z"
                       [{:type "tool_use" :id "t2" :name "Bash" :input {:command (str "curl -H 'x: y' secret-looking " s-provider)}}])
            {:type "user" :timestamp "2099-12-31T00:00:06Z"
             :message {:role "user" :content [{:type "tool_result" :tool_use_id "t2" :is_error true
                                               :content [{:type "text" :text "failed"}
                                                         {:type "image" :source {:data "QUJD"}}]}]}}]))
    (spit (str (fs/path project "sess" "subagents" "agent-a.jsonl"))
          (jsonl [{:type "user" :timestamp "2099-12-31T00:00:07Z" :message {:role "user" :content "sub request"}}
                  (assistant "s1" "2099-12-31T00:00:08Z" [{:type "text" :text "sub answer"}])]))
    (spit (str (fs/path project "sess" "subagents" "agent-a.meta.json")) "{}")
    (spit (str (fs/path day (str "rollout-" thread-delegate ".jsonl"))) (jsonl (codex-lines "delegate")))
    (spit (str (fs/path day (str "rollout-" thread-review ".jsonl"))) (jsonl (codex-lines "review")))
    root))

(defn test-config [base & {:as overrides}]
  (merge (lf/config {"CODEX_TASK_BOARD_ROOT" (str (fs/path base ".codex-task-board"))
                     "CLAUDE_HOME" (str (fs/path base ".claude"))
                     "CODEX_HOME" (str (fs/path base ".codex"))
                     "LANGFUSE_PUBLIC_KEY" "fixture-ingest-public" "LANGFUSE_SECRET_KEY" "fixture-ingest-private"
                     "FIXTURE_TOKEN" s-env})
         {:batch-pause-ms 0}
         overrides))

(defn set-cutoff! [cfg ms]
  (lf/save-state cfg (assoc (lf/load-state cfg 0) :cutoff-ms ms)))

(defn with-server* [handler f]
  (let [captured (atom [])
        stop (server/run-server (fn [req]
                                  (swap! captured conj (slurp (:body req)))
                                  (handler req))
                                {:port 0 :ip "127.0.0.1" :legacy-return-value? false})
        port (server/server-port stop)]
    (try (f (str "http://127.0.0.1:" port) captured)
         (finally (server/server-stop! stop)))))

(defn attr-value [span k]
  (some (fn [a] (when (= k (:key a)) (get-in a [:value :stringValue]))) (:attributes span)))

(defn spans-of [payload]
  (mapcat #(get-in % [:scopeSpans 0 :spans]) (:resourceSpans (json/parse-string payload true))))

(defn prepared [cfg]
  (lf/prepare-spans cfg (lf/build-run cfg ticket run-id)))

;; ------------------------------------------------------------------- redact

(deftest numeric-values-are-only-kept-for-token-counters
  (doseq [text ["password=123456" "\"pin_secret\": 123456" "api_key: 123456"]]
    (is (not (str/includes? (:value (lf/redact text [])) "123456")) text))
  (doseq [text ["\"input_tokens\": 12" "\"cached_input_tokens\":12,\"x\":1" "total_token_count: 12"]]
    (is (= text (:value (lf/redact text []))) text)))

(deftest masks-secret-forms
  (doseq [secret [(str "sk-" "notarealsecret123")
                  (str "ghp_" "synthetic123456789")
                  (str "Bearer " "synthetic-token-123")
                  (str "password=" "synthetic-value")
                  (str "\\\"password\\\":\\\"" "two words" "\\\"")
                  (str "https://user:" "syntheticpass@example.test")
                  (str "AKIA" "1234567890ABCDEF")
                  (str "-----BEGIN " "PRIVATE KEY-----\ncut before the end")]]
    (is (not (str/includes? (:value (lf/redact secret [])) secret)))
    (is (false? (lf/guard-safe? secret []))))
  (let [secret (str "synthetic" "environmentvalue")]
    (is (= "[REDACTED:env]" (:value (lf/redact secret [secret]))))
    (is (false? (lf/guard-safe? secret [secret])))))

(deftest leaves-identifiers-alone
  (doseq [text [(apply str (repeat 40 "a"))
                "0123456789abcdef0123456789abcdef01234567"
                run-id
                "codex-task-board/BOXP-428-20261105T083608Z-63a17ae1-65ba-4bea-9bf3-f7555da07d83"
                "\"input_tokens\":123"
                "max_tokens: 100,"]]
    (is (= text (:value (lf/redact text []))))
    (is (true? (lf/guard-safe? text [])))))

(deftest flags-high-entropy-tokens
  (let [token (str "aB3dE6gH9jK2mN5pQ8sT" "1vW4yZ7bC0eF3hJ6kL9n")]
    (is (= "[REDACTED:entropy]" (:value (lf/redact token []))))))

(deftest redaction-failure-drops-the-field
  (is (= "[dropped: redaction error]" (:value (lf/redact "text" [(Object.)])))))

(deftest structural-withholding
  (doseq [input ["cat /home/test/.ssh/id_rsa" "printenv" "gh auth token" "kubectl get secret"
                 {:path "/home/test/.ssh"} {:path "/home/test/auth.json"}
                 {:path "/home/test/secrets"} {:path "/home/test/access_token"}]]
    (is (lf/withhold-output? input)))
  (is (not (lf/withhold-output? "cat README.md"))))

;; -------------------------------------------------------------- trace model

(deftest ids-are-deterministic
  (is (= (lf/trace-id "BOXP-1" "r") (lf/trace-id "BOXP-1" "r")))
  (is (not= (lf/trace-id "BOXP-1" "r") (lf/trace-id "BOXP-1" "r2")))
  (is (re-matches #"[0-9a-f]{32}" (lf/trace-id "BOXP-1" "r")))
  (is (re-matches #"[0-9a-f]{16}" (lf/span-id "t" "k"))))

(deftest usage-buckets-are-exclusive
  (is (= {:input 60 :output 20 :input_cached_tokens 40 :output_reasoning_tokens 10}
         (lf/codex-usage {:input_tokens 100 :cached_input_tokens 40 :output_tokens 30 :reasoning_output_tokens 10})))
  (is (= {:input 10 :output 5 :cache_read_input_tokens 3 :cache_creation_input_tokens 2}
         (lf/claude-usage {:input_tokens 10 :output_tokens 5 :cache_read_input_tokens 3 :cache_creation_input_tokens 2}))))

(deftest builds-the-whole-trace
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base)
          {:keys [spans]} (prepared cfg)
          root (first spans)
          by-name (group-by :name spans)
          types (frequencies (map #(attr-value % "langfuse.observation.type") spans))
          serialized (json/generate-string spans)]
      (testing "root"
        (is (= "task-board-run BOXP-1" (:name root)))
        (is (nil? (:parentSpanId root)))
        (is (= "[REDACTED:secret_line]" (attr-value root "langfuse.observation.input")))
        (is (= "runner_assembled" (attr-value root "langfuse.observation.metadata.source"))))
      (testing "observation types"
        ;; 2 main + 1 subagent + 2 in each of the two Codex threads
        (is (= 7 (get types "generation")))
        (is (= 4 (get types "tool"))))
      (testing "agents"
        (is (= 1 (count (by-name "delegate:codex"))))
        (is (= 1 (count (by-name "review-gate"))))
        (is (= 1 (count (by-name "subagent:0")))))
      (testing "trace attributes on every span"
        (doseq [span spans]
          (is (= ticket (attr-value span "langfuse.session.id")))
          (is (= "observed" (attr-value span "langfuse.trace.metadata.coverage.delegate")))
          (is (= "observed" (attr-value span "langfuse.trace.metadata.coverage.review_gate")))
          (is (= "not_collected" (attr-value span "langfuse.trace.metadata.coverage.reasoning"))))
        (is (not (str/includes? serialized "langfuse.trace.public"))))
      (testing "system prompts are deduplicated and marked"
        (is (= 2 (count (by-name "cli-system-prompt"))))
        (is (every? #(= "cli_internal" (attr-value % "langfuse.observation.metadata.source"))
                    (by-name "cli-system-prompt"))))
      (testing "tool failure and withheld output"
        (let [tools (by-name "tool:Read")]
          (is (= "withheld_known_source" (attr-value (first tools) "langfuse.observation.metadata.body_policy"))))
        (let [bash (first (by-name "tool:Bash"))]
          (is (= 2 (get-in bash [:status :code])))
          (is (= "withheld_after_known_source" (attr-value bash "langfuse.observation.metadata.body_policy")))))
      (testing "generation usage and delta input"
        (let [first-gen (first (by-name "generation:claude-test"))]
          (is (= {:input 10 :output 5 :cache_read_input_tokens 3 :cache_creation_input_tokens 2}
                 (json/parse-string (attr-value first-gen "langfuse.observation.usage_details") true)))
          (is (= "delta" (attr-value first-gen "langfuse.observation.metadata.input_scope")))))
      (testing "parents resolve inside the trace"
        (let [ids (set (map :spanId spans))]
          (doseq [span (rest spans)]
            (is (contains? ids (:parentSpanId span)) (:name span))))))))

(deftest missing-sources-are-explicit
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (fs/delete-tree (fs/path base ".codex"))
    (fs/delete-tree (fs/path base ".claude"))
    (let [cfg (test-config base)
          root (first (:spans (prepared cfg)))]
      (is (= "missing:no_session" (attr-value root "langfuse.trace.metadata.coverage.claude_session")))
      (is (= "missing:no_session" (attr-value root "langfuse.trace.metadata.coverage.delegate")))
      (is (= "missing:no_session" (attr-value root "langfuse.trace.metadata.coverage.review_gate"))))))

(deftest caps-are-enforced-and-reported
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [{:keys [spans stats]} (prepared (test-config base :max-spans 3))]
      (is (<= (count spans) 3))
      (is (:truncated stats))
      (is (= "true" (attr-value (first spans) "langfuse.trace.metadata.coverage.truncated"))))
    (let [{:keys [spans]} (prepared (test-config base :max-field-bytes 10))]
      (is (some #(str/includes? (or (attr-value % "langfuse.observation.input") "") "[truncated") spans)))))

;; ------------------------------------------------------------ secret corpus

(deftest no-secret-reaches-spool-or-http
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [spooled (atom [])]
      (with-server* (fn [_] {:status 500})
        (fn [url _]
          (let [cfg (test-config base :url url)]
            (set-cutoff! cfg 0)
            (lf/once cfg)
            (reset! spooled (mapv #(slurp (str %)) (fs/list-dir (:spool cfg))))
            (is (seq @spooled) "kept for retry")
            (doseq [secret all-secrets body @spooled]
              (is (not (str/includes? body secret)) secret)))))
      (with-server* (fn [_] {:status 200})
        (fn [url captured]
          (let [cfg (test-config base :url url)
                state (lf/load-state cfg 0)]
            (lf/save-state cfg (dissoc state :next-attempt-ms :failures))
            (lf/once cfg)
            (is (seq @captured))
            (is (empty? (fs/list-dir (:spool cfg))))
            (doseq [secret all-secrets body @captured]
              (is (not (str/includes? body secret)) secret))
            (let [body (str/join @captured)]
              (is (str/includes? body "CLI-SYSTEM-PROMPT"))
              (is (str/includes? body "[REDACTED:"))))))
      (testing "state and metrics hold no secret either"
        (let [cfg (test-config base)]
          (doseq [secret all-secrets
                  f [(:state-file cfg) (:metrics-file cfg)]]
            (is (not (str/includes? (slurp (str f)) secret)))))))))

(deftest final-guard-catches-a-pattern-miss
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base)
          raw (lf/build-run cfg ticket run-id)
          leaky-span (assoc (first (:spans raw)) :name (str "leak " s-github))
          no-op (fn [s _] {:value s :redactions {}})]
      (testing "a leaky child is dropped and counted, the rest continues"
        (let [clean-root (assoc raw :root (update (:root raw) :attributes
                                                  (fn [items] (remove #(str/includes? (:key %) "observation.") items))))
              {:keys [spans stats]}
              (binding [lf/*redact-field* (fn [s values] (if (str/includes? s "leak ") (no-op s values) (lf/redact s values)))]
                (lf/prepare-spans cfg (assoc clean-root :spans [leaky-span])))]
          (is (= 1 (:dropped-secret-guard stats)))
          (is (= 1 (count spans)))
          (is (not (str/includes? (json/generate-string spans) s-github)))
          (is (= "1" (attr-value (first spans) "langfuse.trace.metadata.coverage.dropped_guard")))))
      (testing "a leaky root fails the whole run and spools nothing"
        (binding [lf/*redact-field* no-op]
          (let [state (lf/export-run! cfg (lf/load-state cfg 0) {:ticket ticket :run run-id} 0)]
            (is (= :failed (get-in state [:markers (str ticket "/" run-id) :status])))
            (is (empty? (fs/list-dir (:spool cfg))))))))))

;; ------------------------------------------------------------------ failures

(deftest idle-without-credentials
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base :public-key nil)]
      (set-cutoff! cfg 0)
      (let [state (lf/once cfg)]
        (is (= "no_credentials" (:idle-reason state)))
        (is (empty? (:markers state)) "a run is not consumed while idle")
        (is (empty? (fs/list-dir (:spool cfg))))))))

(deftest no-backfill-before-cutoff
  (fs/with-temp-dir [base {}]
    ;; Started before the cutoff that the first tick creates, and recent enough to pass the age floor.
    (write-fixture! base {:run (str (.format (java.time.format.DateTimeFormatter/ofPattern "yyyyMMdd'T'HHmmss'Z'")
                                             (.atZone (.minusSeconds (java.time.Instant/now) 3600) java.time.ZoneOffset/UTC))
                                    "-11111111-2222-3333-4444-555555555555")})
    (with-server* (fn [_] {:status 200})
      (fn [url captured]
        (let [cfg (test-config base :url url)]
          (lf/once cfg)
          (is (empty? @captured))
          (is (empty? (:markers (lf/load-state cfg 0)))))))))

(deftest waits-for-terminal-runs
  (fs/with-temp-dir [base {}]
    (write-fixture! base {:finished (str (java.time.Instant/now))})
    (with-server* (fn [_] {:status 200})
      (fn [url captured]
        (let [cfg (test-config base :url url)]
          (set-cutoff! cfg 0)
          (lf/once cfg)
          (is (empty? @captured) "finished less than 60 s ago")
          (is (empty? (:markers (lf/load-state cfg 0)))))))))

(deftest retries-are-bounded-and-nothing-escapes
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (with-server* (fn [_] {:status 500})
      (fn [url captured]
        (let [cfg (test-config base :url url :max-attempts 2)]
          (set-cutoff! cfg 0)
          (is (some? (lf/once cfg)))
          (is (= 1 (count @captured)) "stops at the first failure of a tick")
          (let [state (lf/load-state cfg 0)]
            (is (pos? (:next-attempt-ms state)) "backoff recorded")
            (is (= 1 (count (filter #(= :spooled (:status %)) (vals (:markers state))))))
            (lf/once cfg)
            (is (= 1 (count @captured)) "no request during backoff")
            (lf/save-state cfg (dissoc (lf/load-state cfg 0) :next-attempt-ms))
            (lf/once cfg)
            (is (= 2 (count @captured)))
            (is (= {"max_attempts" 1} (get-in (lf/load-state cfg 0) [:metrics :batches_dropped])))))))))

(deftest request-timeout-is-bounded
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (with-server* (fn [_] (Thread/sleep 1500) {:status 200})
      (fn [url _]
        (let [cfg (test-config base :url url :request-timeout-ms 200)]
          (set-cutoff! cfg 0)
          (is (some? (lf/once cfg)))
          (is (= 1 (get-in (lf/load-state cfg 0) [:metrics :batches_failed]))))))))

(deftest unreachable-service-does-not-escape
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base :url "http://127.0.0.1:1")]
      (set-cutoff! cfg 0)
      (is (some? (lf/once cfg)))
      (is (seq (fs/list-dir (:spool cfg)))))))

(deftest rejected-payload-is-not-retried
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (with-server* (fn [_] {:status 400})
      (fn [url captured]
        (let [cfg (test-config base :url url)]
          (set-cutoff! cfg 0)
          (lf/once cfg)
          (is (pos? (count @captured)))
          (is (empty? (fs/list-dir (:spool cfg))))
          (is (pos? (get-in (lf/load-state cfg 0) [:metrics :batches_dropped "rejected"]))))))))

(deftest spool-is-bounded
  (fs/with-temp-dir [base {}]
    (let [cfg (test-config base :spool-max-bytes 100 :spool-ttl-ms 60000)
          state (lf/load-state cfg 0)
          now (System/currentTimeMillis)]
      (lf/enqueue! cfg "a" [(apply str (repeat 80 "x"))] 1)
      (lf/enqueue! cfg "b" [(apply str (repeat 80 "y"))] 2)
      (let [after (lf/bound-spool cfg state now)
            names (map (comp str fs/file-name) (fs/list-dir (:spool cfg)))]
        (is (= 1 (count names)))
        (is (str/includes? (first names) "-b-") "the oldest goes first")
        (is (= {"spool_full" 1} (get-in after [:metrics :batches_dropped]))))
      (let [only (first (fs/list-dir (:spool cfg)))]
        (fs/set-last-modified-time only (java.nio.file.attribute.FileTime/fromMillis (- now 120000)))
        (lf/bound-spool cfg state now)
        (is (empty? (fs/list-dir (:spool cfg))) "expired by TTL")))))

(deftest spool-and-state-permissions
  (fs/with-temp-dir [base {}]
    (let [cfg (test-config base)
          state (lf/load-state cfg 0)]
      (lf/save-state cfg state)
      (lf/enqueue! cfg "a" ["{}"] 1)
      (is (= "rwx------" (fs/posix->str (fs/posix-file-permissions (:spool cfg)))))
      (is (= "rw-------" (fs/posix->str (fs/posix-file-permissions (first (fs/list-dir (:spool cfg))))))))))

(deftest export-marker-is-idempotent
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (with-server* (fn [_] {:status 200})
      (fn [url captured]
        (let [cfg (test-config base :url url)]
          (set-cutoff! cfg 0)
          (lf/once cfg)
          (let [sent (count @captured)]
            (is (pos? sent))
            (lf/once cfg)
            (is (= sent (count @captured)))))))))

(deftest corrupt-run-is-marked-and-not-looped
  (fs/with-temp-dir [base {}]
    (let [root (write-fixture! base {})
          cfg (test-config base)]
      ;; terminal? reads this summary too, so the failure is injected below it.
      (with-redefs [lf/build-run (fn [& _] (throw (ex-info (str "boom " s-github) {})))]
        (let [state (lf/export-run! cfg (lf/load-state cfg 0) {:ticket ticket :run run-id} 0)
              marker (get-in state [:markers (str ticket "/" run-id)])]
          (is (= :failed (:status marker)))
          (is (not (str/includes? (pr-str state) s-github)) "the message is not recorded")))
      (is (fs/exists? root)))))

(deftest dry-run-reports-counts-only
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [report (pr-str (lf/dry-run-report (test-config base) ticket run-id))]
      (is (str/includes? report ":observations"))
      (doseq [secret all-secrets] (is (not (str/includes? report secret))))
      (is (not (str/includes? report "runner prompt"))))))

(deftest hardening-corpus
  (let [v "plainwordvalue"
        j json/generate-string
        groups {"A1" [(j {:output (j {:password v})}) (j {:a (j {:b (j {:api_key v})})})
                        (j {:output (json/generate-string {:token v} {:pretty true})})
                        (j {:output (j {:secret (str "x " v)})}) (j {:output (j {:password (str "x\" " v)})})
                        (j {:password (str "x\" " v)}) (str "{&quot;password&quot;:&quot;x " v "&quot;}")
                        (str "{\\\"password\\\":\\\"x " v)]
                "A2" [(j {:output (j {:password v :name "keptvalue"})})]
                "A3" [(str "mytool --password " v) (str "mytool --api-key \"x " v "\"")
                        (j {:cmd (str "mytool --token " v)}) (str "curl -u a:" v " https://x")
                        (str "curl --user a:" v) (str "mysql -h db -p" v) (str "sshpass -p " v)]
                "A4" [(j {:authorization v}) (j {:auth v}) (str "DB_PASS=" v) (j {:pass v}) (str "passphrase: " v)]
                "A5" [(str "- name: DB_PASSWORD\n  value: " v) (j {:name "DB_PASSWORD" :value v})
                        (j (array-map :value v :name "DB_PASSWORD")) (j {:o (j {:name "API_TOKEN" :value v})})]
                "A6" [(str "password: |\n  a\n  " v "\n") (j {:o (str "token: >-\n  " v "\n")})
                        (str "password=|\n  " v "\n")]}]
    (doseq [[group cases] groups text cases]
      (is (not (str/includes? (:value (lf/redact text [])) v)) (str group " " text)))
    (is (not (str/includes? (:value (lf/redact (first (groups "A2")) [])) "keptvalue")) "A2 whole line")
    (doseq [text ["bypass=k" "compass: k" "tests passed: k" "author: k" "{\"name\":\"DB_HOST\",\"value\":\"k\"}" "--name k" "mysql -h k" "curl -u k https://x" "grep -p k"]]
      (is (= text (:value (lf/redact text []))) (str "keep " text)))
    (is (lf/guard-safe? (:value (lf/redact "--password plainwordvalue cleanbodymarker" [])) []) "A3 guard")))

(deftest sensitive-command-corpus
  (doseq [[group commands] {"B1" ["kubectl get -n ns secret x" "kubectl -n ns get secrets" "kubectl describe secret" "oc -n ns get secret"]
                            "B2" ["env" "env LANG=C" "env -i" "env -0" "printenv" "export" "export -p" "set" "declare -p" "declare" "typeset" "cat /proc/1/environ" "process.env" "os.environ" "getenv"]
                            "B4" ["aws ssm get-parameter" "aws ssm get-parameter --with-decryption" "aws secretsmanager get-secret-value" "aws configure get x" "aws configure export-credentials" "helm get values x" "gh auth token" "git credential" "cat auth.json" "cat .credentials-old" "cat .env.local" "cat .ssh/x" "cat .aws/x" "cat kubeconfig" "cat .git-credentials" "cat .netrc" "cat id_rsa" "cat id_ed25519" "cat secret/x" "cat tokens.json"]} command commands]
    (is (lf/withhold-output? command) (str group " " command)))
  (doseq [command ["echo hello" "cat README.md" "reset" "kubectl get pods"]]
    (is (not (lf/withhold-output? command)) (str "B6 " command))))

(deftest sensitive-session-bodies
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        lines [{:type "response_item" :payload {:type "function_call" :call_id "1" :name "exec" :arguments "echo plainwordvalue > .env"}}
               {:type "response_item" :payload {:type "function_call_output" :call_id "1" :output "opaqueoutput"}}
               {:type "response_item" :payload {:type "message" :role "assistant" :content "lateropaquebody"}}]
        spans (doall (lf/codex-spans ctx "root" "test" lines))
        body (json/generate-string spans)]
    (is (not (str/includes? body "plainwordvalue")) "B5 input")
    (is (not (str/includes? body "opaqueoutput")) "B5 output")
    (is (not (str/includes? body "lateropaquebody")) "B5 later body"))
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        lines [{:type "response_item" :payload {:type "function_call" :call_id "1" :name "exec" :arguments "echo hello"}}
               {:type "response_item" :payload {:type "function_call_output" :call_id "1" :output "PATH=/bin\nHOME=/root\nOPAQUE=plainwordvalue"}}]
        body (json/generate-string (doall (lf/codex-spans ctx "root" "test" lines)))]
    (is (not (str/includes? body "plainwordvalue")) "B3 env output")))

(deftest structured-values
  (let [a "firstplainvalue" b "secondplainvalue" j json/generate-string
        cases [(j {:password [a b]}) (str "{\"password\":[\"" a "\",\"" b "\"]}")
               (j {:credentials {:user a :pw b}}) (j {:auth [[a] {:x [b]}]})
               (j {:password [(str "a]" a) (str "b}" b)]}) (j {:password ["a\\" (str "]" a) b]})
               (j {:password [a b]} {:pretty true}) (j {:output (j {:password [a b]})})
               (j {:o (j {:o (j {:token [a b]})})}) (str "{'password': ['" a "', '" b "']}")
               (str "password = ('" a "', '" b "')") (str "PASSWORDS=(" a " " b ")")
               (str "password: [" a ", " b "]") (str "auth: {user: " a ", pw: " b "}")
               (str "password:\n  - " a "\n  - " b "\n") (str "password:\n- " a "\n- " b "\n")
               (str "  credentials:\n    user: " a "\n    pw: " b "\n")
               (j {:o (str "password:\n  - " a "\n  - " b "\n")})
               (str "{\"password\":[\"" a "\",\"" b)
               (j {:name "DB_PASSWORD" :value [a b]}) (j (array-map :value [a b] :name "DB_PASSWORD"))
               (str "- name: DB_PASSWORD\n  value:\n    - " a "\n    - " b "\n")
               (str "mytool --password [" a "," b "]")]]
    (doseq [text cases] (testing text
      (let [out (:value (lf/redact text []))]
        (is (not (str/includes? out a))) (is (not (str/includes? out b))))))))

(deftest structured-value-boundaries
  (doseq [text [(json/generate-string {:password ["plainwordvalue" "]"] :name "keptvalue"})
                (json/generate-string {:output (json/generate-string {:password ["plainwordvalue"] :name "keptvalue"})})
                (json/generate-string {:auth {:a {:b "plainwordvalue"}} :name "keptvalue"})
                "password:\n  - plainwordvalue\nname: keptvalue\n"
                "a:\n  password:\n  - plainwordvalue\n  name: keptvalue\n"
                (json/generate-string (array-map :value ["plainwordvalue"] :name "DB_PASSWORD" :other "keptvalue"))]]
    (testing text (let [out (:value (lf/redact text []))]
      (is (not (str/includes? out "plainwordvalue"))) (is (not (str/includes? out "keptvalue")))))))

(deftest ordinary-structured-values
  (doseq [text [(json/generate-string {:items ["keptvalue" "keptother"]}) "names:\n  - keptvalue\n"
                (json/generate-string {:name "DB_HOST" :value ["keptvalue"]})
                (json/generate-string (array-map :value ["keptvalue"] :name "DB_HOST")) "prompt_tokens: 3"]]
    (is (= text (:value (lf/redact text []))) text)))

(deftest structured-performance
  (doseq [text [(str "{\"password\":[" (apply str (repeat 200000 "\"a\",")))
                (str "password:\n" (apply str (repeat 200000 "  - a\n")))
                (apply str (repeat 50000 "{\"password\":["))]]
    (let [start (System/nanoTime) _ (lf/redact text []) elapsed (/ (- (System/nanoTime) start) 1e9)]
      (is (< elapsed 5.0) (str "seconds: " elapsed)))))

(deftest structured-mask-accounting-and-limit
  (is (= {:value "[REDACTED:secret_line]" :redactions {:assignment 1 :secret_line 1}}
         (lf/redact "{\"password\":[\"first\",\"second\"]}" [])))
  (is (= {:value "[dropped: redaction error]" :redactions {:error 1}}
         (lf/redact (apply str (repeat 1001 "value: [x], name: HOST\n")) []))))

(deftest body-policy-and-format-independent-redaction
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        span (#'lf/tool-span ctx {:key "x" :name "Bash" :input {:command "FOO=bar /bin/echo hidden" :path "src/a" :content "hidden"} :output "one\ntwo"})
        input (json/parse-string (attr-value span "langfuse.observation.input") true)
        output (attr-value span "langfuse.observation.output")]
    (is (= "FOO=bar /bin/echo hidden" (:command input)))
    (is (= "src/a" (:path input)))
    (is (str/includes? (pr-str input) "hidden"))
    (is (= "one\ntwo" output)))
  (doseq [text ["before\nmy passphrase is sample\nafter\nkeep" "before\\n秘密鍵 sample\\nafter\\nkeep" "before。token sample！after？keep"]]
    (let [out (:value (lf/redact text []))]
      (is (not (str/includes? out "sample")))
      (is (not (str/includes? out "before")))
      (is (not (str/includes? out "after")))
      (is (str/includes? out "keep"))))
  (doseq [text ["<secret>opaque</secret> tail" "&lt;api_key&gt;opaque&lt;/api_key&gt; tail" "<credential>opaque"]]
    (is (str/includes? (:value (lf/redact text [])) "[REDACTED:element]")))
  (is (false? (lf/guard-safe? "a passphrase is here" [])))
  (is (true? (lf/guard-safe? "input_tokens token_count coverage [REDACTED:secret_line]" []))))

(deftest delegation-and-coverage-policy
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [name ["Task" "Agent" "TodoWrite" "delegate_task" "spawn_agent"]]
      (let [span (#'lf/tool-span ctx {:key name :name name :input {:prompt "work item"} :output "result"})]
        (is (str/includes? (attr-value span "langfuse.observation.input") "work item"))
        (is (= "result" (attr-value span "langfuse.observation.output")))))
    (let [span (#'lf/tool-span ctx {:key "c" :name "exec" :input "{\"command\":\"A=b /usr/bin/echo hi\",\"notebook_path\":\"x.ipynb\",\"other\":\"opaque\"}" :output "ok" :status "completed"})
          view (json/parse-string (attr-value span "langfuse.observation.input") true)]
      (is (= "A=b /usr/bin/echo hi" (:command view)))
      (is (= "x.ipynb" (:notebook_path view)))
      (is (= "completed" (attr-value span "langfuse.observation.metadata.status")))
      (is (str/includes? (pr-str view) "opaque"))))
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (is (= "sent through the known-format mask; withheld after a known source, an environment dump or a known format in a tool result (body_policy on each observation)" (attr-value (first (:spans (prepared (test-config base)))) "langfuse.trace.metadata.coverage.tool_bodies")))))

(defn privacy-lines [format tool value]
  (if (= format :claude)
    [{:type "user" :message {:content "first request"}}
     {:type "assistant" :message {:id "a" :model "test" :content [{:type "text" :text "before tool"} {:type "tool_use" :id "t" :name tool :input {:command "cat /etc/app/config.yaml"}}]}}
     {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content value}]}}
     {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text value}]}}]
    [{:type "response_item" :payload {:type "message" :role "user" :content "first request"}}
     {:type "response_item" :payload {:type "message" :role "assistant" :content "before tool"}}
     {:type "response_item" :payload {:type "function_call" :call_id "t" :name tool :arguments "{\"command\":\"cat /etc/app/config.yaml\"}"}}
     {:type "response_item" :payload {:type "function_call_output" :call_id "t" :output value}}
     {:type "response_item" :payload {:type "message" :role "assistant" :content value}}]))

(deftest private-tool-output-and-safe-tools
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [format [:claude :codex] tool ["Bash" "Read" "unknown_tool" "TodoWrite" "WebSearch" "web_search"]]
      (let [lines (privacy-lines format tool "plainconfigvalue")
            spans ((if (= format :claude) lf/claude-spans lf/codex-spans) ctx "root" "test:" lines)
            serialized (pr-str spans)]
        (is (str/includes? serialized "first request") (str format tool))
        (is (str/includes? serialized "before tool") (str format tool))
        (is (str/includes? serialized "plainconfigvalue") (str format tool))))))

(deftest private-child-and-root-output
  (doseq [format [:claude :codex] tool ["Bash" "Read" "unknown_tool"]]
    (fs/with-temp-dir [base {}]
      (write-fixture! base {})
      (let [cfg (test-config base)
            run-dir (fs/path (:root cfg) "runs" ticket run-id)
            project (lf/claude-project-dir cfg ticket run-id)
            day (fs/path base ".codex" "sessions" "2099" "12" "31")]
        (spit (str (fs/path run-dir "last-message.md")) "plainconfigvalue")
        (spit (str (fs/path run-dir "prompt.md")) "runner prompt")
        (spit (str (fs/path project "sess.jsonl")) (jsonl (privacy-lines :claude "TodoWrite" "plainconfigvalue")))
        (if (= format :claude)
          (spit (str (fs/path project "sess" "subagents" "agent-a.jsonl")) (jsonl (privacy-lines :claude tool "plainconfigvalue")))
          (spit (str (fs/path day (str "rollout-" thread-delegate ".jsonl"))) (jsonl (privacy-lines :codex tool "plainconfigvalue"))))
        (let [spans (:spans (prepared cfg))]
          (is (str/includes? (pr-str spans) "plainconfigvalue") (str format tool))
          (is (str/includes? (pr-str spans) "runner prompt")))))))

(deftest child-prompt-after-the-parent-read-a-file
  ;; The parent passes on what it read: the child's first prompt holds the value and the child runs no private tool.
  (doseq [format [:claude :codex]]
    (fs/with-temp-dir [base {}]
      (write-fixture! base {})
      (let [cfg (test-config base)
            run-dir (fs/path (:root cfg) "runs" ticket run-id)
            project (lf/claude-project-dir cfg ticket run-id)
            day (fs/path base ".codex" "sessions" "2099" "12" "31")
            child (if (= format :claude)
                    [{:type "user" :message {:content "goal plainconfigvalue"}}
                     {:type "assistant" :message {:id "a" :model "test" :content [{:type "text" :text "childsaysdone"}]}}]
                    [{:type "response_item" :payload {:type "message" :role "user" :content "goal plainconfigvalue"}}
                     {:type "response_item" :payload {:type "message" :role "assistant" :content "childsaysdone"}}])]
        (spit (str (fs/path run-dir "last-message.md")) "done")
        (spit (str (fs/path run-dir "prompt.md")) "runner prompt")
        (spit (str (fs/path project "sess.jsonl")) (jsonl (privacy-lines :claude "Bash" "plainconfigvalue")))
        (if (= format :claude)
          (spit (str (fs/path project "sess" "subagents" "agent-a.jsonl")) (jsonl child))
          (spit (str (fs/path day (str "rollout-" thread-delegate ".jsonl"))) (jsonl child)))
        (let [spans (:spans (prepared cfg))]
          (is (str/includes? (pr-str spans) "plainconfigvalue") (str format))
          (is (some #(re-find #"subagent:|delegate" (:name %)) spans) "the child's span exists")
          (is (str/includes? (pr-str spans) "runner prompt")))))))

(deftest child-known-format-after-the-parent-read-a-known-source
  ;; The parent read a known source. A later child tool result holds a known format and, further down, a value the
  ;; parent passed on in plain text. The child's span is withheld, not just masked, because the lineage is already withheld.
  (doseq [format [:claude :codex]]
    (fs/with-temp-dir [base {}]
      (write-fixture! base {})
      (let [cfg (test-config base)
            run-dir (fs/path (:root cfg) "runs" ticket run-id)
            project (lf/claude-project-dir cfg ticket run-id)
            day (fs/path base ".codex" "sessions" "2099" "12" "31")
            child-output (str "password: " s-password "\nmiddle line\nanother line\nparentplainvalue childleakmarker")
            parent [{:type "user" :message {:content "first request"}}
                    {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat .env"}}]}}
                    {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content "PARENT_VALUE=parentplainvalue"}]}}
                    {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text "parent done"}]}}]
            child (if (= format :claude)
                    [{:type "user" :message {:content "child goal"}}
                     {:type "assistant" :message {:id "c" :model "test" :content [{:type "tool_use" :id "u" :name "Bash" :input {:command "cat notes.txt"}}]}}
                     {:type "user" :message {:content [{:type "tool_result" :tool_use_id "u" :content child-output}]}}
                     {:type "assistant" :message {:id "d" :model "test" :content [{:type "text" :text "child done"}]}}]
                    [{:type "response_item" :payload {:type "message" :role "user" :content "child goal"}}
                     {:type "response_item" :payload {:type "function_call" :call_id "u" :name "exec" :arguments "{\"command\":\"cat notes.txt\"}"}}
                     {:type "response_item" :payload {:type "function_call_output" :call_id "u" :output child-output}}
                     {:type "response_item" :payload {:type "message" :role "assistant" :content "child done"}}])]
        (spit (str (fs/path run-dir "last-message.md")) "done")
        (spit (str (fs/path run-dir "prompt.md")) "runner prompt")
        (spit (str (fs/path project "sess.jsonl")) (jsonl parent))
        (if (= format :claude)
          (spit (str (fs/path project "sess" "subagents" "agent-a.jsonl")) (jsonl child))
          (spit (str (fs/path day (str "rollout-" thread-delegate ".jsonl"))) (jsonl child)))
        (let [spans (:spans (prepared cfg))
              text (pr-str spans)
              ;; child spans follow the main session's spans
              child-tool (last (filter #(contains? #{"tool:Bash" "tool:exec"} (:name %)) spans))]
          (is (not (str/includes? text "parentplainvalue")) (str format))
          (is (not (str/includes? text "childleakmarker")) (str format))
          (is (not (str/includes? text s-password)) (str format))
          (is (= "withheld_after_known_source" (attr-value child-tool "langfuse.observation.metadata.body_policy")) (str format))
          (is (str/includes? text "runner prompt") "the root input is not part of the lineage withhold"))))))

(defn- nested-json [value depth ascii-only?]
  (nth (iterate (fn [v] (let [out (json/generate-string v {:escape-non-ascii ascii-only?})]
                          (subs out 1 (dec (count out)))))
                value)
       depth))

(deftest value-is-masked-in-every-serialized-form
  (let [env {"A_TOKEN" "ab\"1" "B_TOKEN" "q'z" "C_TOKEN" "l1\nl2" "D_TOKEN" "b\\s" "E_TOKEN" "é7"
             "F_TOKEN" "😀k" "G_TOKEN" "s p/c" "H_TOKEN" "t\tu&v<w>" "LONG_PASSWORD" "long\"value\nwith\\all"}
        values (lf/secret-values env)
        html (fn [v] (-> v (str/replace "&" "&amp;") (str/replace "<" "&lt;") (str/replace ">" "&gt;")
                         (str/replace "\"" "&quot;") (str/replace "'" "&#x27;")))
        percent (fn [v] (-> (java.net.URLEncoder/encode v "UTF-8")))]
    (doseq [value (vals env)]
      (doseq [form (concat [value (html value) (percent value) (str/replace (percent value) "+" "%20")
                            (str/replace value "/" "\\/")]
                           (for [depth [1 2 3 4] ascii-only? [false true]] (nested-json value depth ascii-only?)))]
        (is (= "answer [REDACTED:env] end" (:value (lf/redact (str "answer " form " end") values))) form)
        (is (false? (lf/guard-safe? (str "answer " form " end") values)) form))
      ;; What the review found: a structure goes through JSON before it reaches the mask.
      (doseq [structure [{:k [value]} {:k {:n (str value "x")}}]]
        (let [text (json/generate-string structure)
              out (:value (lf/redact text values))]
          (is (str/includes? out "[REDACTED:env]") text)
          (is (not (str/includes? out (nested-json value 1 false))) text)
          (is (false? (lf/guard-safe? text values)) text))))
    (testing "a value read from a file keeps its newline; the text shows it without"
      (is (= "answer [REDACTED:env]" (:value (lf/redact "answer zq7mw" (lf/secret-values {"FILE_TOKEN" "zq7mw\n"}))))))
    (testing "neighbours of a value survive"
      (is (= "ab\"2 ab 1" (:value (lf/redact "ab\"2 ab 1" (lf/secret-values {"A_TOKEN" "ab\"1"}))))))))

(deftest alphanumerics-are-masked-when-encoded-by-code-point
  (doseq [value ["abc" "aB7" "x\"9"]]
    (let [codes (map int value)
          values (lf/secret-values {"API_TOKEN" value})
          each (fn [fmt cs] (str/join (map #(format fmt %) cs)))]
      (doseq [form [(each "\\u%04x" codes) (each "\\u%04X" codes) (each "\\\\\\u%04x" codes) (each "\\x%02x" codes)
                    (each "%%%02x" codes) (each "%%%02X" codes) (each "%%25%02x" codes) (each "%%2525%02x" codes)
                    (each "&#%d;" codes) (each "&#x%x;" codes)
                    (str (first value) (each "%%%02x" (rest codes)))
                    (str (format "\\u%04x" (first codes)) (subs value 1))]]
        (is (= "answer [REDACTED:env] end" (:value (lf/redact (str "answer " form " end") values))) form)
        (is (false? (lf/guard-safe? (str "answer " form " end") values)) form))))
  (testing "a long run of backslashes neither hides a value nor slows the scan down"
    (let [values (lf/secret-values {"API_TOKEN" "abc" "B_TOKEN" "x\"y"})
          run (str/join (repeat 300 "\\"))
          started (System/currentTimeMillis)]
      (is (= "[REDACTED:env]" (:value (lf/redact (str run "u0061\\u0062\\u0063") values))))
      (is (= "[REDACTED:env]" (:value (lf/redact (str run "u0078\\\"y") values))))
      (is (nil? (re-find (lf/values-pattern (vec values)) (str/join (repeat 100000 "\\")))))
      (is (< (- (System/currentTimeMillis) started) 5000))))
  (testing "case stays exact for the literal form, and other code points are left alone"
    (let [text "ABC %61%62%64 \\u0061bd"]
      (is (= text (:value (lf/redact text (lf/secret-values {"API_TOKEN" "abc"}))))))))

(deftest short-and-passphrase-env-values-are-masked-without-their-name
  (let [short (str "ab" "1!")
        phrase (str "horse" "77")
        env {"DB_PASS" short "GPG_PASSPHRASE" phrase "API_TOKEN" "zq7"
             "AUTH_ENABLED" "true" "TOKENIZERS_PARALLELISM" "false" "SECRET_ROTATION" "1"
             "CLAUDE_CODE_MAX_OUTPUT_TOKENS" "64000" "PWD" "/tmp" "OLDPWD" "/"
             "GIT_AUTHOR_NAME" "boxp" "UNRELATED" "visible" "EMPTY_TOKEN" ""
             "PIN_PASSWORD" "4821"}
        values (lf/secret-values env)
        masked (fn [text] (:value (lf/redact text values)))]
    (testing "a value short of 8 characters and PASSPHRASE reach the value mask"
      (is (some #{short} values))
      (is (some #{phrase} values))
      (is (some #{"zq7"} values))
      (is (some #{"4821"} values)))
    (testing "no name is needed in the text"
      (doseq [text [(str "answer: " short) (str "答えは" short "です") (str "(" phrase ")") (str "user:" short "@host") (str "zq7") (str "pin 4821.") "{\"a\":\"x\\nzq7\"}" "{\"a\":\"\\u3048zq7\"}"]]
        (is (= [] (filter #(str/includes? (masked text) %) [short phrase "zq7" "4821"])) text)
        (is (str/includes? (masked text) "[REDACTED:env]") text)))
    (testing "a value can be part of a longer word, so it is masked there too"
      (doseq [text ["zq77" "xzq7" "horse777" "abzq7cd"]]
        (is (= [] (filter #(str/includes? (masked text) %) ["zq7" phrase])) text)
        (is (str/includes? (masked text) "[REDACTED:env]") text)
        (is (false? (lf/guard-safe? text values)) text)))
    (testing "flags, counters, working directories and authors are not credentials"
      (doseq [v ["true" "false" "1" "64000" "/tmp" "/" "boxp" "visible" ""]]
        (is (not-any? #{v} values) v))
      (is (= "true false 1 64000 /tmp boxp/lolice" (masked "true false 1 64000 /tmp boxp/lolice"))))
    (testing "one pass: a later value does not rewrite the mark of an earlier one"
      (is (= "[REDACTED:env] [REDACTED:env]" (:value (lf/redact "longsecretvalue env" ["longsecretvalue" "env"])))))
    (testing "the final guard sees the value too"
      (is (false? (lf/guard-safe? (str "answer " short) values)))
      (is (true? (lf/guard-safe? "[REDACTED:env] done" ["env"]))))))

(deftest a-value-counts-as-a-setting-only-under-a-setting-name
  (let [credentials {"PASSWORD" (str "dis" "abled") "DB_PASSWORD" (str "tr" "ue") "AUTHORIZATION" (str "xy" "z9")
                     "HTTP_AUTHORIZATION" (str "qw" "e8") "MINIO_ROOT_PASSWORD" (str "1234" "5678")
                     "ADMIN_TOKEN" (str "48" "21") "SUPPORT_SECRET" (str "51" "50") "EXPORT_KEY_TOKEN" (str "77" "31")
                     "AUTH_PORT" (str "hun" "ter2") "API_TOKENS" (str "tr" "ue2")}
        settings {"AUTH_ENABLED" "disabled" "PASSWORD_REQUIRED" "false" "NO_AUTH" "true" "USE_TOKEN" "yes"
                  "AUTH_TIMEOUT" "30" "TOKEN_TTL" "3600" "SESSION_COOKIE_MAX_AGE" "86400"
                  "MAX_OUTPUT_TOKENS" "64000" "GIT_AUTHOR_NAME" "boxp" "AUTHORS" "boxp"}
        values (lf/secret-values credentials)]
    (doseq [[name value] credentials]
      (is (lf/secret-value? name value) name)
      (is (= "answer: [REDACTED:env] done" (:value (lf/redact (str "answer: " value " done") values))) name)
      (is (false? (lf/guard-safe? (str "answer: " value " done") values)) name))
    (doseq [[name value] settings]
      (is (not (lf/secret-value? name value)) name))))

(deftest later-tool-inputs-are-withheld
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [format [:claude :codex]]
      (let [lines (privacy-lines format "Bash" "plainconfigvalue")
            extra (if (= format :claude)
                    [{:type "assistant" :message {:id "c" :content [{:type "tool_use" :id "u" :name "Read" :input {:file_path "/tmp/plainconfigvalue"}} {:type "tool_use" :id "v" :name "TodoWrite" :input {:text "plainconfigvalue"}}]}}]
                    [{:type "response_item" :payload {:type "function_call" :call_id "u" :name "Read" :arguments "{\"file_path\":\"/tmp/plainconfigvalue\"}"}}
                     {:type "response_item" :payload {:type "function_call" :call_id "v" :name "TodoWrite" :arguments "{\"text\":\"plainconfigvalue\"}"}}])
            spans ((if (= format :claude) lf/claude-spans lf/codex-spans) ctx "root" "test:" (concat lines extra))]
        (is (str/includes? (pr-str spans) "plainconfigvalue") (str format))))))

(deftest post-batch-does-not-request-h2c-upgrade
  ;; Langfuse closes the connection on the JDK's default `Upgrade: h2c`, without any response.
  (fs/with-temp-dir [base {}]
    (with-server* (fn [req] {:status (if (get-in req [:headers "upgrade"]) 500 200)})
      (fn [url _]
        (is (= :ok (lf/post-batch (test-config base :url url) "{}")))))))

(deftest settled-observation-contract
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [format [:claude :codex] tool ["Bash" "Read"]]
      (let [lines (privacy-lines format tool "harmlesslistingmarker")
            lines (assoc-in lines (if (= format :claude) [3 :message :content 0 :text] [4 :payload :content]) "harmlessreplymarker")
            spans ((if (= format :claude) lf/claude-spans lf/codex-spans) ctx "root" "test:" lines)
            text (pr-str spans)]
        (is (str/includes? text "harmlesslistingmarker"))
        (is (str/includes? text "harmlessreplymarker"))
        (is (not (str/includes? text "[withheld")))
        (is (not-any? #(str/starts-with? (or (attr-value % "langfuse.observation.metadata.body_policy") "") "withheld_") spans))
        (is (= "sent" (attr-value (last (filter #(str/starts-with? (:name %) "generation:") spans)) "langfuse.observation.metadata.body_policy")))))
    (doseq [path [".kube/config" ".npmrc" ".pypirc" ".pgpass" ".my.cnf" ".docker/config.json" ".boto" ".s3cfg" ".vault-token" ".terraformrc" ".htpasswd" ".config/gh/hosts.yml" ".config/gcloud/" ".azure/" ".cargo/credentials.toml" ".gem/credentials" "a.key" "a.pem" "a.p8" "a.p12" "a.pfx" "a.jks" "a.keystore" "a.ppk" "id_dsa" "id_ecdsa_sk" "id_ed25519_sk" ".gnupg/" "tokens.json" "/tmp/tokens"
                  ;; token files without an extension or a directory
                  "cat mytoken" "mytoken" "cat access_token" "cat refresh_tokens_backup" "sed -n 1p my-token" "{\"file_path\":\"mytoken\"}" "{\"command\":\"head mytoken\"}" "f=mytoken"]]
      (is (lf/withhold-output? path) path))
    (doseq [safe ["keyboard.md" "api-keys.md" "keymap.py" "package.json" ".bashrc" "kube-config.md" "ls ~/.config" "gcloud auth list" "az account show" "aws sts get-caller-identity" "oc whoami" "vault status" "kubectl get pods" "git commit -m 'count tokens per request'" "codex exec --max-output-tokens 5" "{\"max_output_tokens\":5}" "input_tokens: 12" "echo $TOKENS" "tokenize input"]]
      (is (not (lf/withhold-output? safe)) safe))))

(deftest observation-evidence-and-limits
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [format [:claude :codex]]
      ;; [tool output, tool policy before sanitizing, later generation policy, policy after sanitizing]
      ;; A credential shape (bearer, provider key, URL credentials ...) withholds what follows. A secret name with a value
      ;; (assignment, flag, XML element) is masked in place only: ordinary code and logs match it too.
      (doseq [[value expected gen-expected clean-expected secret]
              [[(str "host: db\nAuthorization: Bearer " s-bearer "\nneighbour\nkeptdistantmarker") "masked_known_format" "withheld_after_known_format_in_tool_output" "masked_known_format" s-bearer]
               [(str "host: db\nurl: https://user:" s-url "@db.example\nneighbour\nkeptdistantmarker") "masked_known_format" "withheld_after_known_format_in_tool_output" "masked_known_format" s-url]
               [(str "host: db\npassword: " s-password "\nneighbour\nkeptdistantmarker") "sent" "sent" "masked_known_format" s-password]
               [(str "<password>" s-password "</password>\nneighbour\nkeptdistantmarker") "sent" "sent" "masked_known_format" s-password]
               ["Set the password in settings" "sent" "sent" "masked_known_format" nil]
               [(apply str (repeat (inc (* 1024 1024)) "x")) "withheld_unscanned_output" "withheld_after_unscanned_output" "withheld_unscanned_output" nil]]]
        (let [spans ((if (= format :claude) lf/claude-spans lf/codex-spans) ctx "root" "test:" (privacy-lines format "Bash" value))
              tool (first (filter #(= "tool:Bash" (:name %)) spans))
              gen (last (filter #(str/starts-with? (:name %) "generation:") spans))
              clean (lf/sanitize-span {:secret-values [] :max-field-bytes (* 2 1024 1024)} (atom {}) tool)]
          (is (= expected (attr-value tool "langfuse.observation.metadata.body_policy")) (str format " " (subs value 0 (min 30 (count value)))))
          (is (= gen-expected (attr-value gen "langfuse.observation.metadata.body_policy")) (str format " " (subs value 0 (min 30 (count value)))))
          (is (= clean-expected (attr-value clean "langfuse.observation.metadata.body_policy")) (str format " " (subs value 0 (min 30 (count value)))))
          (when secret
            (is (not (str/includes? (pr-str clean) secret)))
            (is (str/includes? (pr-str clean) "keptdistantmarker"))))))
    (doseq [command ["gcloud auth print-access-token" "gcloud auth print-identity-token" "gcloud auth application-default print-access-token" "gcloud secrets versions access 1" "az account get-access-token" "az keyvault secret show" "aws sts get-session-token" "aws sts assume-role-with-web-identity" "aws sts get-federation-token" "aws ecr get-login-password" "aws iam create-access-key" "kubectl -n x create token y" "oc whoami -t" "vault read x" "vault kv get x" "vault token create" "vault token lookup" "vault login" "op read x" "op item get x" "docker-credential-helper" "env -u X"]]
      (is (lf/withhold-output? command) command))))

;; Regression (BOXP-428, production 2026-11-07): ordinary code and logs that only name a secret with a non-credential
;; value withheld every later body of the run. The value is still masked in place; what follows stays readable.
(deftest ordinary-secret-names-in-code-do-not-withhold-the-lineage
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [format [:claude :codex]
            value ["TOKEN_FILE=/work/.cache/state\nlaterreplymarker"
                   "headers = {}\ntoken = os.environ['API']\nlaterreplymarker"
                   "fetch(url, { credentials: 'same-origin' })\nlaterreplymarker"
                   "PASS: disk check\nlaterreplymarker"
                   "mytool --token $TOKEN run\nlaterreplymarker"]]
      (let [spans ((if (= format :claude) lf/claude-spans lf/codex-spans) ctx "root" "test:" (privacy-lines format "Bash" value))
            gen (last (filter #(str/starts-with? (:name %) "generation:") spans))]
        (is (= "sent" (attr-value gen "langfuse.observation.metadata.body_policy")) (str format " " value))
        (is (str/includes? (pr-str gen) "laterreplymarker") (str format " " value))
        (is (not-any? #(str/starts-with? (or (attr-value % "langfuse.observation.metadata.body_policy") "") "withheld_") spans) (str format " " value))))))

(deftest direct-source-policy
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [source [".kube/config" ".npmrc" ".pypirc" ".pgpass" ".my.cnf" ".docker/config.json" ".boto" ".s3cfg" ".vault-token" ".terraformrc" ".htpasswd" ".config/gh/hosts.yml" ".config/gcloud/" ".azure/" ".cargo/credentials" ".gem/credentials" "a.key" "a.pem" "a.p8" "a.p12" "a.pfx" "a.jks" "a.keystore" "a.ppk" "id_dsa" "id_ecdsa" "id_ecdsa_sk" "id_ed25519_sk" ".gnupg/" "tokens.json" "/tmp/tokens" "mytoken" "access_tokens_backup"]]
      (let [lines [{:type "response_item" :payload {:type "function_call" :call_id "1" :name "exec" :arguments (str "cat " source)}}
                   {:type "response_item" :payload {:type "function_call_output" :call_id "1" :output "opaquebody"}}]
            tool (first (filter #(= "tool:exec" (:name %)) (lf/codex-spans ctx "root" "test" lines)))]
        (is (= "withheld_known_source" (attr-value tool "langfuse.observation.metadata.body_policy")) source)
        (is (not (str/includes? (pr-str tool) "opaquebody")) source)))))

;; Regression (BOXP-428, arch#14548 review): a name-based known format no longer withholds the lineage, so the
;; value it named is masked in every field of the run; a bare restatement in a later reply must not be sent.
(deftest named-values-are-masked-across-the-run
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        root {:spanId "r" :name "root" :attributes [{:key "langfuse.observation.input" :value {:stringValue "runner prompt"}}]}]
    (doseq [format [:claude :codex]
            [result secret] [["password: hunterhorsebattery\n" "hunterhorsebattery"]
                             ["db:\n  password: \"plumorchardtree\"\n" "plumorchardtree"]
                             ["{\"api_key\": \"quietmeadowstone\"}" "quietmeadowstone"]
                             ["run --token silverlakefern now" "silverlakefern"]
                             ["curl -u admin:goldenriverbank x" "goldenriverbank"]
                             ["{\"name\": \"APP_SECRET\", \"value\": \"brightcanyonmist\"}" "brightcanyonmist"]
                             ["secret: |\n  firstblockline\n  secondblockline\n" "secondblockline"]]]
      (let [lines (if (= format :claude)
                    [{:type "user" :message {:content "first request"}}
                     {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat notes.txt"}}]}}
                     {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content result}]}}
                     {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text (str "it is " secret " and laterreplymarker")}]}}]
                    [{:type "response_item" :payload {:type "message" :role "user" :content "first request"}}
                     {:type "response_item" :payload {:type "function_call" :call_id "t" :name "exec" :arguments "{\"command\":\"cat notes.txt\"}"}}
                     {:type "response_item" :payload {:type "function_call_output" :call_id "t" :output result}}
                     {:type "response_item" :payload {:type "message" :role "assistant" :content (str "it is " secret " and laterreplymarker")}}])
            spans ((if (= format :claude) lf/claude-spans lf/codex-spans) ctx "root" "test:" lines)
            run {:root root :spans spans :pinned-values (lf/pinned-values-of (cons root spans))}
            {:keys [spans failed]} (lf/prepare-spans {:secret-values [] :max-spans 100 :max-field-bytes 65536 :max-run-bytes 10000000} run)
            body (pr-str spans)]
        (is (nil? failed) (str format " " result))
        (is (not (str/includes? body secret)) (str format " " result))
        (is (str/includes? body "laterreplymarker") (str format " " result))
        (is (str/includes? body "first request") (str format " " result))))))

(deftest short-named-values-withhold-the-lineage
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [format [:claude :codex]]
      (let [spans ((if (= format :claude) lf/claude-spans lf/codex-spans) ctx "root" "test:" (privacy-lines format "Bash" "password: q7z\nlaterreplymarker"))
            gen (last (filter #(str/starts-with? (:name %) "generation:") spans))]
        (is (str/starts-with? (attr-value gen "langfuse.observation.metadata.body_policy") "withheld_after_") (str format))
        (is (not (str/includes? (pr-str gen) "q7z")) (str format))))))

(deftest named-values-ignore-references-and-settings
  (is (= [] (:values (lf/named-values "--token $TOKEN and password: ${DB_PASSWORD} and PASSWORD_REQUIRED=true"))))
  (is (false? (:unpinned? (lf/named-values "--token $TOKEN and password: ${DB_PASSWORD} and PASSWORD_REQUIRED=true")))))

(let [{:keys [fail error]} (run-tests)]
  (when (pos? (+ fail error)) (System/exit 1)))
