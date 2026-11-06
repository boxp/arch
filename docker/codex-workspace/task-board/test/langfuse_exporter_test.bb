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
          (is (str/includes? (attr-value (first tools) "langfuse.observation.output") "[withheld")))
        (let [bash (first (by-name "tool:Bash"))]
          (is (= 2 (get-in bash [:status :code])))
          (is (str/includes? (attr-value bash "langfuse.observation.output") "[withheld"))))
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
          (is (= "1" (attr-value (first spans) "langfuse.trace.metadata.coverage.dropped_secret_guard")))))
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
                            "B4" ["aws ssm get-parameter" "aws ssm get-parameter --with-decryption" "aws secretsmanager get-secret-value" "aws configure get x" "aws configure export-credentials" "helm get values x" "gh auth token" "git credential" "cat auth.json" "cat .credentials-old" "cat .env.local" "cat .ssh/x" "cat .aws/x" "cat kubeconfig" "cat .git-credentials" "cat .netrc" "cat id_rsa" "cat id_ed25519" "cat secret/x" "cat mytoken"]} command commands]
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
        span (#'lf/tool-span ctx {:key "x" :name "Bash" :input {:command "echo hello"} :output "one\ntwo"})]
    (is (str/includes? (attr-value span "langfuse.observation.input") "echo hello"))
    (is (= "one\ntwo" (attr-value span "langfuse.observation.output")))
    (is (= "sent" (attr-value span "langfuse.observation.metadata.body_policy"))))
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
    (is (= "all_tools_masked_unless_secret_exposed" (attr-value (first (:spans (prepared (test-config base)))) "langfuse.trace.metadata.coverage.tool_body")))))

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
        (spit (str (fs/path project "sess.jsonl")) (jsonl (privacy-lines :claude "Read" "plainconfigvalue")))
        (if (= format :claude)
          (spit (str (fs/path project "sess" "subagents" "agent-a.jsonl")) (jsonl child))
          (spit (str (fs/path day (str "rollout-" thread-delegate ".jsonl"))) (jsonl child)))
        (let [spans (:spans (prepared cfg))]
          (is (str/includes? (pr-str spans) "plainconfigvalue") (str format))
          (is (some #(re-find #"subagent:|delegate" (:name %)) spans) "the child's span exists")
          (is (str/includes? (pr-str spans) "runner prompt")))))))

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

(deftest evidence-based-tool-bodies
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        lines [{:type "user" :message {:content "initial request"}}
               {:type "assistant" :message {:id "a" :content [{:type "tool_use" :id "r" :name "Read" :input {:file_path "/repo/README.md"}}]}}
               {:type "user" :message {:content [{:type "tool_result" :tool_use_id "r" :content "safe readme body MARKER_SAFE_OUT"}]}}
               {:type "assistant" :message {:id "b" :content [{:type "tool_use" :id "b" :name "Bash" :input {:command "ls -la"}}]}}
               {:type "user" :message {:content [{:type "tool_result" :tool_use_id "b" :content "listing"}]}}
               {:type "assistant" :message {:id "c" :content [{:type "text" :text "final answer MARKER_SAFE_REPLY"}]}}
               {:type "user" :message {:content "later user turn"}}
               {:type "assistant" :message {:id "d" :content [{:type "text" :text "done"}]}}]
        body (json/generate-string (doall (lf/claude-spans ctx "root" "test:" lines)))]
    (doseq [marker ["MARKER_SAFE_OUT" "/repo/README.md" "ls -la" "MARKER_SAFE_REPLY" "later user turn" "body_policy" "sent"]]
      (is (str/includes? body marker) marker))
    (is (not (str/includes? body "[withheld")))))

(deftest evidence-based-value-exposure
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        value (str "Zq7" "plainvalue9")
        spans (doall (lf/claude-spans ctx "root" "test:" (privacy-lines :claude "Read" (str "password: " value))))]
    ;; TD-05: a secret that can be pinned to its value is masked wherever it appears; later bodies stay readable.
    (is (not (str/includes? (pr-str spans) "withheld_after_secret_exposure")))
    (is (some #(contains? (:session-values %) value) spans))
    (is (not (str/includes? (pr-str (map #(lf/sanitize-span {:secret-values (mapcat :session-values spans) :max-field-bytes 100000} (atom {}) %) spans)) value)))))

(deftest unpinned-secret-still-withholds-later-bodies
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [output ["-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----"]]
      (let [spans (doall (lf/claude-spans ctx "root" "test:" (privacy-lines :claude "Read" output)))]
        (is (some #(= "value_exposure" (:private-reason %)) spans) output)
        (is (str/includes? (pr-str spans) "withheld_after_secret_exposure") output)))))

(deftest pinned-block-and-element-values-are-masked-and-bodies-continue
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [[output value] [["db:\n  password:\n    - Zq7blockvalue9\n" "Zq7blockvalue9"] ["<password>Zq7xmlvalue9</password>" "Zq7xmlvalue9"]]]
      (let [spans (doall (lf/claude-spans ctx "root" "test:" (privacy-lines :claude "Read" output)))
            values (mapcat :session-values spans)]
        (is (not (str/includes? (pr-str spans) "withheld_after_secret_exposure")) output)
        (is (some #{value} values) output)
        (is (not (str/includes? (pr-str (map #(lf/sanitize-span {:secret-values values :max-field-bytes 100000} (atom {}) %) spans)) value)) output)))))

(deftest references-and-counters-are-not-evidence
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [output ["env:\n  - name: API_KEY\n    valueFrom:\n      secretKeyRef:\n        name: app-secrets\n        key: API_KEY\n"
                    "token: ${GITHUB_TOKEN}" "password: <your password>" "max_output_tokens: 4000"]]
      (let [spans (doall (lf/claude-spans ctx "root" "test:" (privacy-lines :claude "Read" output)))]
        (is (not (str/includes? (pr-str spans) "withheld_")) output))))
  (is (not (lf/withhold-output? "{\"cmd\":\"ls\",\"max_output_tokens\":12000}")))
  (is (lf/withhold-output? "cat /run/secrets/token"))
  (is (lf/withhold-output? "cat /etc/app/secret"))
  (is (not (lf/withhold-output? "grep -rn secret src")))
  (is (not (lf/withhold-output? "/usr/bin/env python3 x.py")))
  (is (not (lf/withhold-output? "env LANG=C ls")))
  (doseq [c ["env" "env | grep A" "printenv HOME" "x; env > out"]] (is (lf/withhold-output? c) c))
  (is (= #{"Zq7passvalue9"} (:values (#'lf/exposure "password = Zq7passvalue9")))))

(deftest token-and-key-files-are-sensitive-sources
  ;; A file named for tokens holds a bare value with no key or format to mask, so reading it withholds the body.
  (doseq [c ["cat /tmp/tokens" "cat /tmp/token" "cat tokens" "{\"path\":\"/tmp/tokens\"}" "cat /var/lib/app/tokens"
             "cat tokens.json" "cat refresh_tokens.txt" "cat /run/app/access-token" "cat token.txt" "ls /var/lib/tokens/"
             "cat /etc/app/private.key" "cat /etc/ssl/server.pem" "cat client.pfx" "cat ~/.ssh/id_ecdsa" "cat ~/.gnupg/x"
             "cat .env.local"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["{\"cmd\":\"ls\",\"max_output_tokens\":12000}" "cat keyboard.md" "cat api-keys.md" "cat keymap.py"
             "echo pem_path" "grep -rn max_tokens src"]]
    (is (not (lf/withhold-output? c)) c))
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        value "abcde12345"
        spans (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "first request"}}
                                                           {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat /tmp/tokens"}}]}}
                                                           {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content value}]}}
                                                           {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text value}]}}]))]
    (is (not (str/includes? (pr-str spans) value)))))

(deftest plain-lowercase-prose-words-are-not-session-values
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        spans (doall (lf/claude-spans ctx "root" "test:" (privacy-lines :claude "Read" "the token generation configuration is documented")))]
    (is (empty? (mapcat :session-values spans)))))

(deftest word-only-values-propagate-through-run
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base) project (lf/claude-project-dir cfg ticket run-id)
          value (str "Zq7" "plainvalue9")
          lines (privacy-lines :claude "Read" (str "the password is " value))
          lines (assoc-in lines [3 :message :content] [{:type "text" :text (str "here it is " value)}])]
      (spit (str (fs/path project "sess.jsonl")) (jsonl lines))
      (let [body (pr-str (:spans (prepared cfg)))]
        (is (not (str/includes? body value)))
        (is (str/includes? body "here it is"))))))

(deftest exposure-limits-and-metadata
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [[output reason] [[(apply str (repeat 262145 "x")) "unscanned_large_output"]
                             [(str "password " (str/join " " (map #(str "Value" % "X") (range 2049)))) "too_many_session_values"]]]
      (let [spans (doall (lf/claude-spans ctx "root" "test:" (privacy-lines :claude "Read" output)))]
        (is (some #(= reason (:private-reason %)) spans))
        (is (some #(= "withheld_after_secret_exposure" (attr-value % "langfuse.observation.metadata.body_policy")) spans)))))
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base) data (lf/build-run cfg ticket run-id)
          root (first (:spans (lf/prepare-spans cfg data)))]
      (is (= "sensitive_source" (attr-value root "langfuse.trace.metadata.coverage.withheld_reason")))
      (is (pos? (get-in data [:counts :bodies_withheld_sensitive_source] 0)))
      (is (pos? (get-in data [:counts :bodies_withheld_after_secret_exposure] 0))))))

(deftest sensitive-child-still-withholds-parent-and-root
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base) project (lf/claude-project-dir cfg ticket run-id)
          run-dir (fs/path (:root cfg) "runs" ticket run-id)
          value (str "synthetic" "ChildPrivateValue")
          child (privacy-lines :claude "Read" value)
          child (assoc-in child [1 :message :content 1 :input] {:file_path "/a/.env"})]
      (spit (str (fs/path run-dir "last-message.md")) value)
      (spit (str (fs/path project "sess.jsonl")) (jsonl (privacy-lines :claude "Task" value)))
      (spit (str (fs/path project "sess" "subagents" "agent-a.jsonl")) (jsonl child))
      (let [body (pr-str (:spans (prepared cfg)))]
        (is (not (str/includes? body value)))
        (is (str/includes? body "withheld_sensitive_source"))))))

(deftest same-generation-tools-after-sensitive-source-are-withheld
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        value "ordinarySyntheticValue"
        lines [{:type "assistant" :message {:id "a" :content [{:type "tool_use" :id "a" :name "Read" :input {:file_path "/tmp/.env"}}
                                                                  {:type "tool_use" :id "b" :name "Bash" :input {:command "ls"}}]}}
               {:type "user" :message {:content [{:type "tool_result" :tool_use_id "a" :content value}
                                                  {:type "tool_result" :tool_use_id "b" :content value}]}}]
        spans (lf/claude-spans ctx "root" "test:" lines)]
    (is (not (str/includes? (pr-str spans) value)))))

(deftest policy-metadata-does-not-expose-known-values
  (let [value "withheld_after_secret_exposure"
        span {:name "safe" :attributes [{:key "langfuse.observation.metadata.body_policy" :value {:stringValue value}}]}
        cfg {:secret-values [value] :max-field-bytes 10000}
        clean (lf/sanitize-span cfg (atom {}) span)]
    (is (not (str/includes? (pr-str clean) value)))))

(deftest candidates-from-withheld-tools-mask-root-fields
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base) project (lf/claude-project-dir cfg ticket run-id)
          run-dir (fs/path (:root cfg) "runs" ticket run-id)
          value "UnusualSyntheticValue"
          lines (privacy-lines :claude "Read" "ignored")
          lines (assoc-in lines [1 :message :content 1 :input] {:file_path "/tmp/.env"})
          lines (concat lines [{:type "assistant" :message {:id "z" :content [{:type "tool_use" :id "z" :name "Read" :input {:file_path "README.md"}}]}}
                               {:type "user" :message {:content [{:type "tool_result" :tool_use_id "z" :content (str "the password is " value)}]}}])]
      (spit (str (fs/path project "sess.jsonl")) (jsonl lines))
      (spit (str (fs/path run-dir "prompt.md")) (str "please use " value))
      (is (not (str/includes? (pr-str (:spans (prepared cfg))) value))))))

(deftest candidate-overflow-fails-closed-for-entire-run
  (fs/with-temp-dir [base {}]
    (write-fixture! base {})
    (let [cfg (test-config base) project (lf/claude-project-dir cfg ticket run-id)
          run-dir (fs/path (:root cfg) "runs" ticket run-id)
          values (mapv #(str "Value" % "X") (range 2049))]
      (spit (str (fs/path project "sess.jsonl")) (jsonl (privacy-lines :claude "Read" (str "password " (str/join " " values)))))
      (spit (str (fs/path run-dir "prompt.md")) (str/join " " values))
      (is (:failed (prepared cfg))))))

(deftest post-batch-does-not-request-h2c-upgrade
  ;; Langfuse closes the connection on the JDK's default `Upgrade: h2c`, without any response.
  (fs/with-temp-dir [base {}]
    (with-server* (fn [req] {:status (if (get-in req [:headers "upgrade"]) 500 200)})
      (fn [url _]
        (is (= :ok (lf/post-batch (test-config base :url url) "{}")))))))

(deftest password-files-are-sensitive-sources
  ;; A file named for a password holds a bare value with no label or format to mask.
  (doseq [c ["cat /tmp/password" "cat /tmp/passwords" "cat /run/secrets/db_password" "{\"file_path\":\"/tmp/password\"}"
             "cat password" "cat password.txt" "cat db-passphrase.txt" "cat /etc/app/passwd" "cat /var/lib/app/password/current"
             "cat ./secret" "cat secret.txt" "cat /tmp/credentials"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["grep -rn password src" "echo password reset" "cat docs/reset.md" "{\"cmd\":\"ls\",\"max_output_tokens\":12000}"]]
    (is (not (lf/withhold-output? c)) c))
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        value "q7Zr"
        spans (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "first request"}}
                                                           {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat /tmp/password"}}]}}
                                                           {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content value}]}}
                                                           {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text (str "it is " value)}]}}]))]
    (is (not (str/includes? (pr-str spans) value)))))

(deftest short-labelled-values-withhold-later-bodies
  ;; A value under 4 characters cannot be masked everywhere without blanking ordinary text, so it withholds.
  (doseq [text ["password: 123" "password = ab" "{\"password\":\"x9\"}" "api_key: z1"]]
    (is (:reason (#'lf/exposure text)) text))
  (testing "settings and counters stay readable"
    (doseq [text ["password_min_length: 8" "PASSWORD_REQUIRED=true" "\"input_tokens\": 12" "password: ${DB_PASSWORD}"]]
      (is (nil? (:reason (#'lf/exposure text))) text)))
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        spans (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "first request"}}
                                                           {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat app.conf"}}]}}
                                                           {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content "password: 123"}]}}
                                                           {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text "zz 123 zz"}]}}]))]
    (is (not (str/includes? (pr-str spans) "zz 123 zz")))))

(deftest plain-prose-values-named-by-a-secret-word
  ;; "the password is huntertwo": a plain lowercase value named with a copula or separator is pinned, so a later
  ;; bare repeat is masked (P0 arch#14503 :424). A short one cannot be pinned and withholds like password: 123.
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [[output value] [["the password is huntertwo" "huntertwo"]
                            ["The api_key was plumorchard." "plumorchard"]
                            ["db password: hunter otterpaw" "otterpaw"]
                            ["kiwimango is my password" "kiwimango"]]]
      (let [lines (assoc-in (privacy-lines :claude "Bash" output) [3 :message :content] [{:type "text" :text (str "zz " value " zz")}])
            spans (doall (lf/claude-spans ctx "root" "test:" lines))
            sanitized (pr-str (map #(lf/sanitize-span {:secret-values (mapcat :session-values spans) :max-field-bytes 100000} (atom {}) %) spans))]
        (is (some #(contains? (:session-values %) value) spans) output)
        (is (not (str/includes? sanitized (str "zz " value " zz"))) output)
        (is (not (str/includes? (pr-str spans) "withheld_after_secret_exposure")) output)))
    (doseq [output ["the password is abc" "the token was qz7 now"]]
      (is (= "value_exposure" (:reason (#'lf/tool-exposure {:input "cat notes.txt"} {:output output}))) output)))
  (testing "a secret word without a named value stays readable and pins nothing"
    (doseq [output ["the token generation configuration is documented" "Reset your password from the settings page"
                    "if token is None:" "password_min_length: 8" "password: ${DB_PASSWORD}" "what is the password"]]
      (let [{:keys [reason values]} (#'lf/tool-exposure {:input "cat notes.txt"} {:output output})]
        (is (nil? reason) output)
        (is (not-any? #{"generation" "configuration" "documented" "reset" "settings" "page" "what"} values) output)))))

;; P0 arch#14503 :272 (BOXP-428). A secret word inside a file name (db_password, app-secret, aws_credentials)
;; names a file holding a bare value just like password itself; only whole-argument names were caught before.
(deftest secret-word-inside-file-name
  (doseq [c ["cat db_password" "cat db_password /tmp/other" "head -n 1 ./db_password" "cat app-secret" "cat aws_credentials"
             "cat DB_PASSWORD_FILE" "less root.passwd" "tail -n1 mysql_root_password" "bat old_passwords"
             "{\"command\":\"cat db_password\"}" "cat db_password; echo done"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["grep -rn db_password src" "echo set db_password in vault" "rg db_password docs" "cat docs/reset.md README.md"
             "git commit -m 'rename db_password'" "{\"cmd\":\"ls\",\"max_output_tokens\":12000}"]]
    (is (not (lf/withhold-output? c)) c)))

;; P0 arch#14503 :272 / :580 (BOXP-428). A secret-named file read with further arguments is still a source, and a
;; value named in prose in the tool input is pinned so the bare output and later repeats are masked.
(deftest secret-named-file-with-more-arguments
  (doseq [c ["cat password /tmp/other" "head -n 5 secret /tmp/x" "less credentials notes.txt" "cat -n passwords other.txt"
             "tail -f /tmp/app.log password"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["grep -rn password src" "echo password reset" "rg password docs" "git commit -m 'rotate password docs'"
             "cat docs/reset.md README.md"]]
    (is (not (lf/withhold-output? c)) c)))

(deftest prose-values-in-tool-input
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        value "huntertwo"
        lines [{:type "user" :message {:content "first request"}}
               {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command (str "echo the password is " value)}}]}}
               {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content value}]}}
               {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text (str "zz " value " zz")}]}}]
        spans (doall (lf/claude-spans ctx "root" "test:" lines))
        sanitized (pr-str (map #(lf/sanitize-span {:secret-values (mapcat :session-values spans) :max-field-bytes 100000} (atom {}) %) spans))]
    (is (contains? (set (:values (#'lf/tool-exposure {:input (str "echo the password is " value)} {:output value}))) value))
    (is (not (str/includes? sanitized value)))
    (is (= "value_exposure" (:reason (#'lf/tool-exposure {:input "echo the password is abc"} {:output "abc"}))))
    (testing "an ordinary command stays readable"
      (is (nil? (:reason (#'lf/tool-exposure {:input "grep -rn 'reset your password page' docs"} {:output "docs/a.md:1: reset your password"}))))
      (is (str/includes? sanitized "first request") "control: the request body is sent"))))


;; P0 arch#14503 :272 (BOXP-428). A file-reading tool takes the path as a JSON argument ({"file_path":"db_password"}),
;; not as a shell argument, so a secret word inside the file name must also make that read a sensitive source.
(deftest secret-word-inside-tool-file-path
  (doseq [c ["{\"file_path\":\"db_password\"}" "{\"file_path\":\"./conf/app-secret.yaml\"}" "{\"path\":\"aws_credentials\"}"
             "{\"notebook_path\":\"/work/db_password.ipynb\"}" "{\"file_path\":\"mysql_root_password.txt\",\"limit\":10}"
             "{\"filename\": \"DB_PASSWORD_FILE\"}"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["{\"file_path\":\"src/reset.md\"}" "{\"pattern\":\"db_password\",\"path\":\"src\"}" "{\"file_path\":\"docs/auth.md\"}"
             "{\"command\":\"grep -rn db_password src\"}" "{\"cmd\":\"ls\",\"max_output_tokens\":12000}"]]
    (is (not (lf/withhold-output? c)) c))
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        value "plainbarevalue7"
        spans (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "first request"}}
                                                           {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Read" :input {:file_path "db_password"}}]}}
                                                           {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content value}]}}
                                                           {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text (str "it is " value)}]}}]))]
    (is (not (str/includes? (pr-str spans) value)))))

;; P0 arch#14503 :541 (BOXP-428). Every secret word on a prose line is looked at, not only the first, so a value named
;; by a later word ("Reset your password; kiwimango is my token") is pinned and its later repeats are masked.
(deftest prose-values-after-a-mention-on-the-same-line
  (doseq [[line value] [["Reset your password; kiwimango is my token" "kiwimango"]
                        ["Reset your password, the token is limequartz" "limequartz"]
                        ["see password docs. the secret is plumvortex" "plumvortex"]]]
    (is (contains? (:values (#'lf/prose-values line)) value) line))
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        spans (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "first request"}}
                                                           {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Read" :input {:file_path "notes.txt"}}]}}
                                                           {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content "Reset your password; kiwimango is my token"}]}}
                                                           {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text "repeat: kiwimango"}]}}]))]
    (is (some #(contains? (:session-values %) "kiwimango") spans))
    (is (not (str/includes? (pr-str (map #(lf/sanitize-span {:secret-values (mapcat :session-values spans) :max-field-bytes 100000} (atom {}) %) spans)) "kiwimango"))))
  (is (nil? (:reason (#'lf/prose-values "Reset your password from the settings page; the token generation is documented")))))

;; P0 arch#14503 :280 (BOXP-428). Any program that takes a secret-named file as an argument (sed -n 1p db_password,
;; awk 1 db_password, python3 x.py db_password, < db_password) can print it, so the reader is no longer enumerated:
;; only commands that mention a name without printing the file (grep/rg pattern, echo, git, ls, ...) stay readable.
(deftest any-program-reading-a-secret-named-file
  (doseq [c ["sed -n 1p db_password" "awk 1 db_password" "awk '{print}' ./conf/app-secret" "cut -c1- aws_credentials"
             "sort db_password" "jq . credentials.json" "python3 show.py db_password" "perl -pe 1 db_password"
             "while read l; do echo $l; done < db_password" "tr a-z A-Z < /tmp/password" "grep . db_password"
             "rg -e x src db_password" "cp db_password /dev/stdout" "dd if=db_password" "sudo sed -n 1p db_password"
             "python3 -c \"print(open('db_password').read())\"" "x=$(sed 1q db_password)" "sed 1q db_password | head"
             "{\"command\":[\"bash\",\"-lc\",\"awk 1 db_password\"]}" "{\"cmd\":\"sed -n 1p db_password\"}" "f=db_password; cat $f"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["grep -rn db_password src" "rg db_password docs" "echo set db_password in vault" "git commit -m 'rename db_password'"
             "ls secrets-docs" "bb task-board.bb append-note --note 'rotate the password docs'"
             "bb task-board.bb append-note --note \"please do (rotate) password; then credentials later\"" "if true; then echo password; fi"
             "sed -n 1,20p docs/reset.md" "awk 1 README.md" "python3 x.py --password-file-flag-doc"
             "{\"command\":\"ls\",\"description\":\"show password policy docs\"}" "{\"cmd\":\"ls\",\"max_output_tokens\":12000}"]]
    (is (not (lf/withhold-output? c)) c)))
;; P0 arch#14503 segment-reads-secret-file? (BOXP-428). A pattern given through an option joined to its value
;; (grep -ex db_password, grep -iex, grep -fpatterns, grep --regexp=x, rg -e=x) leaves no separate pattern operand,
;; so every operand is a file and a secret-named one is a source. The pattern of a plain search stays readable.
(deftest search-with-joined-pattern-option-reads-a-secret-named-file
  (doseq [c ["grep -ex db_password" "grep -iex db_password" "grep -e. db_password" "grep -fpats.txt db_password"
             "grep --regexp=x db_password" "grep --file=pats.txt db_password" "rg -ex db_password" "rg --regexp=x db_password"
             "egrep -rex src db_password" "{\"command\":\"grep -ex db_password\"}"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["grep -rn db_password src" "grep -i db_password src" "rg -n db_password docs" "grep -rn --include=*.md password docs"
             "grep -c db_password src" "rg -w db_password"]]
    (is (not (lf/withhold-output? c)) c)))
;; P0 arch#14503 :296 (BOXP-428). git is not mention-only as a whole: git show HEAD:db_password, git cat-file -p,
;; git diff/log -p/blame/grep and the -p/-v forms of add/status/checkout print a secret-named file's content. Only
;; subcommands that do not print file content stay readable (deny by default). Same for gh api/gist/release, which
;; print remote file content, and find/fd with an exec action, which hand the file to an arbitrary reader.
(deftest mention-programs-that-print-a-secret-named-file
  (doseq [c ["git show HEAD:db_password" "git --no-pager show HEAD:db_password" "git -C repo show main:conf/app-secret"
             "git cat-file -p HEAD:db_password" "git diff db_password" "git log -p -- db_password" "git blame db_password"
             "git grep x -- db_password" "git add -p db_password" "git status -v db_password" "git checkout -p db_password"
             "git stash show -p db_password" "git archive HEAD db_password" "git config -f db_password --list"
             "git somealias db_password" "gh api repos/o/r/contents/db_password" "gh gist view db_password"
             "find . -name db_password -exec cat {} \\;" "fd db_password -x cat" "command cat db_password"
             "{\"command\":\"git show HEAD:db_password\"}"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["git add db_password" "git rm --cached db_password" "git mv db_password conf_db_password"
             "git commit -m 'rename db_password'" "git status" "git checkout main -- db_password" "git push origin main"
             "git -C repo add app-secret" "gh pr create --title 'rotate password docs'" "find . -name README.md -exec wc -l {} +"
             "ls db_password" "wc -c db_password" "stat db_password"]]
    (is (not (lf/withhold-output? c)) c)))
;; P0 arch#14503 :548 (BOXP-428). A value that is a literal or looks like a placeholder (password: true, none, xxxxx)
;; is still the value: it is pinned (4+ characters) so a later bare repeat is masked, or withholds when shorter. A
;; toggle or counter name with such a value (password_required: true, max_output_tokens: null) is a setting.
(deftest literal-values-are-values
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [[output value] [["password: true" "true"] ["api_key = false" "false"] ["{\"password\": \"none\"}" "none"]
                            ["secret: xxxxx" "xxxxx"] ["password: null" "null"]]]
      (let [lines [{:type "user" :message {:content "first request"}}
                   {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat config.txt"}}]}}
                   {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content output}]}}
                   {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text (str "zz " value " zz")}]}}]
            spans (doall (lf/claude-spans ctx "root" "test:" lines))
            sanitized (pr-str (map #(lf/sanitize-span {:secret-values (mapcat :session-values spans) :max-field-bytes 100000} (atom {}) %) spans))]
        (is (contains? (set (:values (#'lf/tool-exposure {:input "cat config.txt"} {:output output}))) value) output)
        (is (not (str/includes? sanitized (str "zz " value " zz"))) output)
        (is (str/includes? sanitized "first request") "control: the request body is sent")))
    (doseq [output ["password: nil" "token: ***"]]
      (is (= "value_exposure" (:reason (#'lf/tool-exposure {:input "cat config.txt"} {:output output}))) output))
    (doseq [output ["password_required: true" "max_output_tokens: null" "AUTH_DISABLE_PASSWORD=true" "use_secret: false"]]
      (let [{:keys [reason values]} (#'lf/tool-exposure {:input "cat config.txt"} {:output output})]
        (is (nil? reason) output)
        (is (not-any? #{"true" "false" "null"} values) output)))))

;; P0 arch#14503 :272 (BOXP-428). Well-known credential files (~/.npmrc, ~/.pypirc, ~/.pgpass, ~/.docker/config.json,
;; ...) hold bare tokens with no key or known format after a cut, so reading them is a sensitive source.
(deftest well-known-credential-files
  (doseq [c ["cat ~/.npmrc | cut -d= -f2" "cat .npmrc" "{\"file_path\":\"/home/u/.npmrc\"}" "cat ~/.pypirc" "cat ~/.pgpass"
             "cat ~/.my.cnf" "cat ~/.docker/config.json" "cat ~/.dockercfg" "cat ~/.boto" "cat ~/.s3cfg" "cat ~/.vault-token"
             "cat ~/.terraformrc" "cat ~/.terraform.d/credentials.tfrc.json" "cat ~/.kube/config" "cat ~/.config/gh/hosts.yml"
             "cat ~/.yarnrc.yml" "cat ~/.cargo/credentials.toml" "cat ~/.gem/credentials" "cat ~/.m2/settings.xml"
             "cat ~/.gradle/gradle.properties" "cat ~/.config/gcloud/application_default_credentials.json" "cat ~/.azure/accessTokens.json"
             "cat ~/.curlrc" "cat ~/.wgetrc" "cat ~/.config/rclone/rclone.conf" "cat /etc/nginx/.htpasswd"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["cat package.json" "npm install" "cat README.md" "ls ~/.config" "cat ~/.bashrc" "cat docs/npm-guide.md"]]
    (is (not (lf/withhold-output? c)) c)))

;; P0 arch#14503 :273 (BOXP-428). A token word inside a file name with more name after it (access_tokens_backup,
;; refresh_token_old, api-tokens-2024) names a file holding a bare token just like tokens.json or db_password, so
;; any program reading it (or a file tool given it as a path) is a source. Mentions stay readable.
(deftest token-word-inside-file-name
  (doseq [c ["cat access_tokens_backup" "head -n1 refresh_token_old" "sed -n 1p ./conf/api-tokens-2024" "awk 1 tokens_backup"
             "cat access_tokens_backup /tmp/other" "less /var/lib/app/access_tokens_backup" "f=access_tokens_backup; cat $f"
             "{\"file_path\":\"access_tokens_backup\"}" "{\"command\":\"cat access_tokens_backup\"}" "python3 show.py ACCESS_TOKEN_BACKUP"]]
    (is (lf/withhold-output? c) c))
  (doseq [c ["grep -rn access_tokens_backup src" "echo rotate access_tokens_backup" "rg tokens_backup docs"
             "git commit -m 'rename access_tokens_backup'" "{\"cmd\":\"ls\",\"max_output_tokens\":12000}" "grep -rn max_tokens src"
             "cat docs/reset.md README.md" "cat keyboard.md"]]
    (is (not (lf/withhold-output? c)) c))
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}
        value "plainbaretok9q"
        spans (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "first request"}}
                                                           {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat access_tokens_backup"}}]}}
                                                           {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content value}]}}
                                                           {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text value}]}}]))]
    (is (not (str/includes? (pr-str spans) value)))))

;; P0 arch#14503 :728 (BOXP-428). A value shown in a user message or model text (not a tool output) is pinned too,
;; so a later bare repeat by the model is masked; a short one withholds that generation and the bodies after it.
(deftest values-in-user-and-model-text
  (let [state (atom #{})
        ctx {:tid "01234567890123456789012345678901" :trace-attrs {} :session-state state}
        ;; prepare-spans masks with the run's session values, as the exporter does.
        clean (fn [spans] (let [spans (doall spans) values @state] (reset! state #{})
                            (pr-str (map #(lf/sanitize-span {:secret-values values :max-field-bytes 100000} (atom {}) %) spans))))]
    (doseq [[request value] [["password: huntertwo" "huntertwo"] ["the password is plumorchard" "plumorchard"]]]
      (testing "claude"
        (let [spans (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content request}}
                                                                 {:type "assistant" :message {:id "a" :model "test" :content [{:type "text" :text (str "zz " value " zz")}]}}
                                                                 {:type "user" :message {:content "thanks, what next"}}
                                                                 {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text (str "yy " value " yy")}]}}]))
              out (clean spans)]
          (is (not (str/includes? out (str "zz " value " zz"))) request)
          (is (not (str/includes? out (str "yy " value " yy"))) request)
          (is (str/includes? out "thanks, what next") "control: a later safe request is sent")))
      (testing "codex"
        (let [lines [{:type "response_item" :timestamp "2026-11-06T00:00:00Z" :payload {:type "message" :role "user" :content [{:type "input_text" :text request}]}}
                     {:type "response_item" :timestamp "2026-11-06T00:00:01Z" :payload {:type "message" :role "assistant" :content [{:type "output_text" :text (str "zz " value " zz")}]}}]
              out (clean (doall (lf/codex-spans ctx "root" "test:" lines)))]
          (is (not (str/includes? out (str "zz " value " zz"))) request))))
    (testing "the model names a value itself"
      (let [out (clean (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "make one up"}}
                                                                    {:type "assistant" :message {:id "a" :model "test" :content [{:type "text" :text "password: kiwimango"}]}}
                                                                    {:type "user" :message {:content "again"}}
                                                                    {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text "zz kiwimango zz"}]}}])))]
        (is (not (str/includes? out "zz kiwimango zz")))))
    (testing "a short value in a request withholds the replies that can repeat it"
      (let [out (clean (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "password: 123"}}
                                                                    {:type "assistant" :message {:id "a" :model "test" :content [{:type "text" :text "zz 123 zz"}]}}])))]
        (is (not (str/includes? out "zz 123 zz")))))
    (testing "ordinary requests and replies stay readable"
      (let [out (clean (doall (lf/claude-spans ctx "root" "test:" [{:type "user" :message {:content "list the files please"}}
                                                                    {:type "assistant" :message {:id "a" :model "test" :content [{:type "text" :text "harmlessreplymarker done"}]}}])))]
        (is (str/includes? out "harmlessreplymarker done"))
        (is (nil? (:reason (#'lf/body-exposure "run date -u +%Y-%m-%dT%H:%M:%SZ and curl -u $USER:$PASS later"))) "date -u format is no credential")
        (is (:reason (#'lf/body-exposure "curl -u admin:x9 https://example.test")) "control: a real -u credential still counts")
        (is (str/includes? out "list the files"))))))

;; P0 arch#14503 :46 (BOXP-428). A percent-encoded user name (user%40example.com) is a real -u credential; the
;; password after it is masked and pinned. A date format with % after -u stays readable.
(deftest cli-user-with-percent-encoding
  (doseq [cmd ["curl -u user%40example.com:huntertwopct https://x"
               "curl --user=me%2Bci:huntertwopct https://x"
               "curl -u 'user%40example.com:huntertwopct' https://x"]]
    (is (not (str/includes? (:value (lf/redact cmd #{})) "huntertwopct")) cmd)
    (is (contains? (:values (#'lf/body-exposure cmd)) "huntertwopct") cmd))
  (doseq [cmd ["date -u +%Y-%m-%dT%H:%M:%SZ" "date -u '+%H:%M'" "date -u \"+%d%H:%M\""]]
    (is (= cmd (:value (lf/redact cmd #{}))) cmd)
    (is (nil? (:reason (#'lf/body-exposure cmd))) cmd)))

;; P0 arch#14503 :552 (BOXP-428). A whole value that is a structure word (password: username, token = value) is still
;; the value and is pinned, so a later bare repeat is masked. A key word inside a structure (secretKeyRef name/key)
;; stays a reference.
(deftest structure-words-as-whole-values
  (let [ctx {:tid "01234567890123456789012345678901" :trace-attrs {}}]
    (doseq [[output value] [["password: username" "username"] ["token = value" "value"] ["{\"api_key\": \"name\"}" "name"]
                            ["the password is username" "username"] ["password: value horsestaple" "value"]]]
      (let [lines [{:type "user" :message {:content "first request"}}
                   {:type "assistant" :message {:id "a" :model "test" :content [{:type "tool_use" :id "t" :name "Bash" :input {:command "cat config.txt"}}]}}
                   {:type "user" :message {:content [{:type "tool_result" :tool_use_id "t" :content output}]}}
                   {:type "assistant" :message {:id "b" :model "test" :content [{:type "text" :text (str "zz " value " zz")}]}}]
            spans (doall (lf/claude-spans ctx "root" "test:" lines))
            sanitized (pr-str (map #(lf/sanitize-span {:secret-values (mapcat :session-values spans) :max-field-bytes 100000} (atom {}) %) spans))]
        (is (contains? (set (:values (#'lf/tool-exposure {:input "cat config.txt"} {:output output}))) value) output)
        (is (not (str/includes? sanitized (str "zz " value " zz"))) output)
        (is (str/includes? sanitized "first request") "control: the request body is sent")))
    (doseq [output ["secretKeyRef:\n  name: app-secrets\n  key: password" "password: ${DB_PASSWORD}"]]
      (let [{:keys [reason values]} (#'lf/tool-exposure {:input "cat deploy.yaml"} {:output output})]
        (is (nil? reason) output)
        (is (not-any? #{"name" "key"} values) output)))))

;; P0 arch#14503 :48 (BOXP-428). A user name starting with + (curl -u +admin:huntertwo) is a real -u credential; only
;; a date format (+%H) after -u is skipped.
(deftest cli-user-with-leading-plus
  (doseq [cmd ["curl -u +admin:huntertwoplus https://x" "curl -u '+admin:huntertwoplus' https://x" "curl --user=+ci:huntertwoplus https://x"]]
    (is (not (str/includes? (:value (lf/redact cmd #{})) "huntertwoplus")) cmd)
    (is (contains? (:values (#'lf/body-exposure cmd)) "huntertwoplus") cmd))
  (doseq [cmd ["date -u +%Y-%m-%dT%H:%M:%SZ" "date -u '+%H:%M'" "date -u \"+%d%H:%M\""]]
    (is (= cmd (:value (lf/redact cmd #{}))) cmd)))

;; P0 arch#14503 :49 (BOXP-428). A user name and password of digits only (curl -u 12345:67890) is a real -u
;; credential, not a time; only a date format (+%H) after -u is skipped.
(deftest cli-user-with-digits-only
  (doseq [cmd ["curl -u 12345:67890 https://x" "curl --user=12345:67890 https://x" "curl -u '12345:67890' https://x"]]
    (is (not (str/includes? (:value (lf/redact cmd #{})) "67890")) cmd)
    (is (contains? (:values (#'lf/body-exposure cmd)) "67890") cmd))
  (doseq [cmd ["date -u +%Y-%m-%dT%H:%M:%SZ" "date -u '+%H:%M'" "date -u \"+%d%H:%M\""]]
    (is (= cmd (:value (lf/redact cmd #{}))) cmd)
    (is (nil? (:reason (#'lf/body-exposure cmd))) cmd)))

;; P0 arch#14503 :1130 (BOXP-428). With no session log, the run's prompt.md and last-message.md are the only bodies.
;; A value named in the prompt is pinned, so a bare repeat in the last message is masked; one that cannot be pinned
;; withholds the root bodies. An ordinary prompt and reply stay readable.
(deftest root-bodies-without-session-logs
  (let [base (fs/create-temp-dir)
        cfg (test-config base)
        run-dir (fs/path (:root cfg) "runs" ticket run-id)
        write! (fn [prompt last]
                 (fs/create-dirs run-dir)
                 (spit (str (fs/path run-dir "summary.edn")) (pr-str {:status :ok :agent "codex" :action :implement :finished-at "2000-01-01T00:00:00Z"}))
                 (spit (str (fs/path run-dir "prompt.md")) prompt)
                 (spit (str (fs/path run-dir "last-message.md")) last))
        out (fn [] (pr-str (prepared cfg)))]
    (doseq [[prompt last value] [["password: huntertworoot" "zz huntertworoot zz" "huntertworoot"]
                                 ["the password is plumrootvalue" "zz plumrootvalue zz" "plumrootvalue"]
                                 ["make a password" "password: kiwirootvalue then zz kiwirootvalue zz" "kiwirootvalue"]
                                 ["password: 123" "zz 123 zz" "zz 123 zz"]]]
      (write! prompt last)
      (is (not (str/includes? (out) value)) prompt))
    (write! "please list the files rootpromptmarker" "done rootreplymarker")
    (let [o (out)]
      (is (str/includes? o "rootpromptmarker") "control: an ordinary prompt is sent")
      (is (str/includes? o "rootreplymarker") "control: an ordinary reply is sent"))))

(let [{:keys [fail error]} (run-tests)]
  (when (pos? (+ fail error)) (System/exit 1)))
