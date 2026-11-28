#!/usr/bin/env bb
;; BOXP-775: the runner records unresolved PR gate review findings in the ticket Notes.
;; Expected values come from Projects/task-board-review-findings/spec.md (Obsidian vault),
;; not from the implementation. All data below is synthetic and harmless.
(require '[clojure.test :refer [deftest is testing run-tests]] '[clojure.string :as str] '[babashka.fs :as fs])
(System/setProperty "babashka.file" "/tmp/load-runner.bb")
(load-file "docker/codex-workspace/task-board/task_board_runner.bb")

(def url "https://github.com/boxp/example/pull/7")
(def head "0e01838aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")
(def fake-secret "ghp_SYNTHETICabcdefghijklmnop1234")

(defn blocking-gate [& {:as extra}]
  (merge {:ok? false :gate :codex-review :failure-kind :findings :url url :head head :retryable? true
          :blocking-items [{:severity "P1" :location "src/a.bb:12" :description (str "empty input throws; token=" fake-secret)}
                           {:severity "P0" :location "src/b.bb:3" :description "EXPLOIT-DETAIL: send crafted header to bypass auth"}]
          :blocking-findings {:count 2 :path "/root/runs/BOXP-1/r1/codex-review-boxp__example-7-blocking.md"}
          :low-priority-findings {:count 1 :paths ["/root/runs/BOXP-1/r1/codex-review-boxp__example-7.md"]}
          :retry-count 1 :retry-limit 2}
         extra))

(defn with-env [f]
  (let [dir (fs/create-temp-dir)
        vault-dir (fs/path dir "vault")
        root-dir (fs/path dir "root")]
    (fs/create-dirs (fs/path vault-dir "Tickets"))
    (spit (str (fs/path vault-dir "Tickets" "BOXP-1.md")) "---\nid: BOXP-1\n---\n\n# BOXP-1: t\n\n## Notes\n\n- 2026-11-28: start\n")
    (try
      (with-redefs [root (fn [] (str root-dir)) vault (fn [] (str vault-dir)) log! (fn [& _] nil)]
        (f {:ticket (fs/path vault-dir "Tickets" "BOXP-1.md") :root root-dir}))
      (finally (fs/delete-tree dir)))))

;; Process restart = every in-memory table is gone.
(defn- restart! []
  (doseq [s '[review-findings-memory-pending review-findings-state-backlog]]
    (when-let [v (resolve s)] (reset! @v {}))))
(defn- ticket-state [] (#'review-findings-ticket-state "BOXP-1"))

(defn finding-lines [ticket] (filterv #(str/includes? % "review-findings:") (str/split-lines (slurp (str ticket)))))

(deftest blocking-entry-content
  (let [[e & more] (review-findings-entries "BOXP-1" "r1" (blocking-gate) {})]
    (is (empty? more))
    (is (= :blocking (:kind e)))
    (is (re-find #"review-findings:[0-9a-f]{12}" (:note e)))
    (doseq [part [url "0e01838" "r1" "P0/P1 2件" "P2/P3/nit 1件" "[P1] src/a.bb:12" "empty input throws" "[P0] src/b.bb:3"
                  "詳細は証跡を参照" "再試行 1/2" "codex-review-boxp__example-7-blocking.md"]]
      (is (str/includes? (:note e) part) part))
    (testing "secrets are redacted and P0 detail is never written"
      (is (not (str/includes? (:note e) fake-secret)))
      (is (not (str/includes? (:note e) "EXPLOIT-DETAIL")))
      (is (not (str/includes? (:note e) "crafted header"))))
    (testing "one line, bounded description"
      (is (not (str/includes? (:note e) "\n")))
      (let [long-desc (apply str (repeat 500 "x"))
            e2 (first (review-findings-entries "BOXP-1" "r1" (blocking-gate :blocking-items [{:severity "P1" :location "a\nb" :description long-desc}]) {}))]
        (is (not (str/includes? (:note e2) "\n")))
        (is (not (str/includes? (:note e2) (apply str (repeat 161 "x")))))))))

(deftest quoted-secrets-are-redacted
  ;; spec: 鍵と値の間に引用符があっても値を伏字にする
  (doseq [[desc value] [["leaks {\"password\":\"hunter2\"} in body" "hunter2"]
                        ["config password: \"hunter 2\" is logged" "hunter 2"]
                        ["escaped {\\\"api_key\\\":\\\"xyzSYNTH\\\"} printed" "xyzSYNTH"]
                        ["single 'secret': 'sq-val' here" "sq-val"]
                        ["{\"access_token\": \"tok123SYNTH\", \"x\": 1}" "tok123SYNTH"]]]
    (let [e (first (review-findings-entries "BOXP-1" "r1"
                                            (blocking-gate :blocking-items [{:severity "P1" :location "src/a.bb:1" :description desc}]) {}))]
      (is (not (str/includes? (:note e) value)) desc)
      (is (str/includes? (:note e) "[REDACTED]") desc))))

(deftest stop-states
  (let [id #(:id (first (review-findings-entries "BOXP-1" "r1" % {})))
        base (blocking-gate)]
    (is (= (id base) (id (assoc base :retry-count 2))) "same findings, same head, still retrying: same record")
    (is (= (id base) (:id (first (review-findings-entries "BOXP-1" "r2" base {})))) "another run of the same result: same record")
    (is (not= (id base) (id (assoc base :retry-exhausted? true))))
    (is (not= (id base) (id (assoc base :budget-exhausted? true))))
    (is (not= (id base) (id (assoc base :head "1111111111111111111111111111111111111111"))))
    (is (str/includes? (:note (first (review-findings-entries "BOXP-1" "r1" (assoc base :retry-exhausted? true :retry-count 3) {}))) "自動再試行は停止"))
    (is (str/includes? (:note (first (review-findings-entries "BOXP-1" "r1" (assoc base :budget-exhausted? true) {}))) "予算枯渇"))))

(deftest unavailable-is-not-clean
  (doseq [[gate reason] [[{:ok? false :gate :codex-review :failure-kind :command-error :url url :head head :message (str "stderr " fake-secret)} "command-error"]
                         [{:ok? false :gate :codex-review :failure-kind :invalid-output :url url :review-judgment-failure "missing-result-marker"
                           :message "raw prose output"} "invalid-output:missing-result-marker"]]]
    (let [[e & more] (review-findings-entries "BOXP-1" "r1" gate {})]
      (is (empty? more))
      (is (= :unavailable (:kind e)))
      (is (str/includes? (:note e) "実指摘なしではない"))
      (is (str/includes? (:note e) reason))
      (is (not (str/includes? (:note e) fake-secret)))
      (is (not (str/includes? (:note e) "raw prose"))))))

(deftest passes-and-other-gates
  (is (empty? (review-findings-entries "BOXP-1" "r1" {:ok? true :checked-pr-urls [url] :checked-pr-heads {url head}} {})) "clean without a prior record writes nothing")
  (is (empty? (review-findings-entries "BOXP-1" "r1" {:ok? false :gate :ci :url url :retryable? true} {})) "CI failure is not a review record")
  (is (empty? (review-findings-entries "BOXP-1" "r1" {:ok? true :skipped? true} {})))
  (let [[e] (review-findings-entries "BOXP-1" "r1" {:ok? true :checked-pr-urls [url] :checked-pr-heads {url head}
                                                    :low-priority-findings {:count 2 :paths ["/p/a.md"]}} {})]
    (is (= :low-only (:kind e)))
    (is (str/includes? (:note e) "2件"))
    (is (str/includes? (:note e) "/p/a.md")))
  (let [[e] (review-findings-entries "BOXP-1" "r9" {:ok? true :checked-pr-urls [url] :checked-pr-heads {url head}} {url {:id "abcdefabcdef" :kind :blocking}})]
    (is (= :resolved (:kind e)))
    (is (str/includes? (:note e) "abcdefabcdef"))))

(deftest record-once-and-reprocess
  (with-env
    (fn [{:keys [ticket root]}]
      (let [r1 (record-review-findings! "BOXP-1" "r1" (blocking-gate))
            r2 (record-review-findings! "BOXP-1" "r1" (blocking-gate))]
        (is (= [:recorded] (mapv :status r1)))
        (is (= [:duplicate] (mapv :status r2)))
        (is (= 1 (count (finding-lines ticket))))
        (is (= :recorded (-> (read-edn-file (fs/path root "runs" "BOXP-1" "r1" "review-findings.edn") nil) :entries first :status))))
      (testing "the later pass records the resolution once"
        (record-review-findings! "BOXP-1" "r2" {:ok? true :checked-pr-urls [url] :checked-pr-heads {url "2222222222222222222222222222222222222222"}})
        (record-review-findings! "BOXP-1" "r2" {:ok? true :checked-pr-urls [url] :checked-pr-heads {url "2222222222222222222222222222222222222222"}})
        (is (= 2 (count (finding-lines ticket))))
        (is (str/includes? (last (finding-lines ticket)) "未検出"))))))

(deftest write-failure-is-kept-and-retried
  (with-env
    (fn [{:keys [ticket root]}]
      (let [r (with-redefs [append-note-once! (fn [& _] (throw (ex-info "disk full (synthetic)" {})))]
                (record-review-findings! "BOXP-1" "r1" (blocking-gate)))]
        (is (= [:failed] (mapv :status r)))
        (is (empty? (finding-lines ticket)))
        (is (= 1 (count (get (read-edn-file (fs/path root "review-findings-pending.edn") {}) "BOXP-1"))) "kept in the pending file")
        (is (= :failed (-> (read-edn-file (fs/path root "runs" "BOXP-1" "r1" "review-findings.edn") nil) :entries first :status))))
      (testing "after a restart the pending record is flushed once"
        (is (= [:recorded] (mapv :status (flush-pending-review-findings! "BOXP-1"))))
        (is (empty? (flush-pending-review-findings! "BOXP-1")))
        (is (= 1 (count (finding-lines ticket))))
        (is (empty? (get (read-edn-file (fs/path root "review-findings-pending.edn") {}) "BOXP-1"))))
      (testing "a flush whose write state is unknown does not duplicate"
        (record-review-findings! "BOXP-1" "r1" (blocking-gate))
        (is (= 1 (count (finding-lines ticket))))))))

(deftest concurrent-records-write-one-line
  (with-env
    (fn [{:keys [ticket]}]
      (let [fs* (doall (for [i (range 8)] (future (record-review-findings! "BOXP-1" (str "r" i) (blocking-gate)))))]
        (doseq [f fs*] @f)
        (is (= 1 (count (finding-lines ticket))))))))

(defn run-card [gate-result & {:keys [owner? throw-after-gate?] :or {owner? true}}]
  (let [calls (atom [])
        record! (fn [k & _] (swap! calls conj k) nil)
        lock {:run-id "rf-run" :owner-id "test-owner"}
        ;; Never touch the live runner root: its locks would be taken for real.
        tmp-root (str (fs/create-temp-dir))]
    (with-redefs [root (fn [] tmp-root)
                  vault (fn [] (str (fs/path tmp-root "vault")))
                  ticket-frontmatter (fn [_] {:assignee "claude-opus"})
                  candidate-action (fn [& _] :implement)
                  acquire-lock! (fn [& _] lock)
                  heartbeat! (fn [& _] (future nil))
                  lifecycle-commit-owner? (fn [& _] owner?)
                  superseded-revision (fn [& _] nil)
                  move-card! (fn [& _] (record! :move-card!))
                  update-frontmatter! (fn [& _] nil)
                  append-note! (fn [_ note] (when (str/includes? note "finished with result") (record! :final-note)))
                  mark-run! (fn [& _] nil)
                  release-lock! (fn [& _] nil)
                  block-ticket! (fn [& _] (record! :block-ticket!) true)
                  restore-card-state! (fn [& _] nil)
                  record-ai-ops-gate! (fn [& _] nil)
                  record-ai-ops-event! (fn [& _] nil)
                  record-ai-ops-finish! (fn [& _] nil)
                  record-task-board-event! (fn [& _] (record! :event))
                  persist-pr-gate-diagnostic! (fn [& _] nil)
                  record-gate-pr-registrations! (fn [& _] (when throw-after-gate? (throw (ex-info "synthetic crash" {}))))
                  record-same-file-review-streak! (fn [& _] nil)
                  record-pr-gate-failure! (fn [_ _ _ g] g)
                  clear-pr-gate-retries! (fn [& _] nil)
                  reserve-gate-budget-run! (fn [& _] true)
                  log! (fn [& _] nil)
                  run-agent! (fn [& _] {:exit 0 :result "continue" :run-id (:run-id lock) :dir "/nonexistent"
                                        :last-message url :idle-timeout? false :shutdown? false})
                  review-gate! (fn [& _] gate-result)
                  record-review-findings! (fn [_ _ g] (record! [:review-findings (:gate g)]) [])
                  consume-continuation! (fn [_ _ gate] gate)
                  clear-continuation-budget! (fn [_] nil)
                  conflict-observe! (fn [& _] nil)]
      (try (process-card! {:ticket-id "TEST-RF" :lane "In Progress" :status "in-progress"})
           (finally (fs/delete-tree tmp-root))))
    @calls))

(deftest lifecycle-order
  (testing "recorded after the ownership check, before the lane move, final note and event"
    (let [calls (run-card (blocking-gate))
          idx #(.indexOf calls %)]
      (is (= 1 (count (filter #(= [:review-findings :codex-review] %) calls))) (pr-str calls))
      (is (< (idx [:review-findings :codex-review]) (idx :move-card!)) (pr-str calls))
      (is (< (idx [:review-findings :codex-review]) (idx :final-note)) (pr-str calls))
      (is (< (idx [:review-findings :codex-review]) (idx :event)) (pr-str calls))))
  (testing "a run that lost the lock writes no record"
    (is (not-any? #(and (vector? %) (= :review-findings (first %))) (run-card (blocking-gate) :owner? false))))
  (testing "a crash after the gate still records (once)"
    (let [calls (run-card (blocking-gate) :throw-after-gate? true)]
      (is (some #{[:review-findings :codex-review]} calls) (pr-str calls))
      (is (some #{:block-ticket!} calls) (pr-str calls)))))


;; --- PR gate retry (codex review P1 x3) --------------------------------------
(def url2 "https://github.com/boxp/example/pull/8")
(def head2 "8888888888888888888888888888888888888888")

(deftest multi-pr-gate-keeps-passed-heads
  (testing "a later PR failing keeps the head of the PR that passed before it"
    (with-redefs [wait-for-pr-state! (fn [_] {:ok? true :gate-results []})
                  pr-head-oid (fn [u] (if (= u url) head head2))
                  run-codex-review! (fn [_ u] (if (= u url)
                                                {:ok? true :gate-results [["codex-review" "pass"]]}
                                                {:ok? false :gate :codex-review :failure-kind :findings :url u
                                                 :blocking-items [{:severity "P1" :location "x.bb:1" :description "d"}]
                                                 :blocking-findings {:count 1 :path "/p/b.md"}}))]
      (let [g (review-gate! "/nonexistent" (str url " " url2))
            entries (review-findings-entries "BOXP-1" "r3" g {url {:id "abcdefabcdef" :kind :blocking}})
            resolved (first (filter #(= :resolved (:kind %)) entries))]
        (is (= {url head} (:checked-pr-heads g)))
        (is (str/includes? (:note resolved) "0e01838"))
        (is (not (str/includes? (:note resolved) "不明")))))))

(deftest multi-pr-low-only-per-pr
  (testing "each PR gets its own count and evidence; a PR without findings is not listed"
    (with-redefs [wait-for-pr-state! (fn [_] {:ok? true :gate-results []})
                  pr-head-oid (fn [u] (if (= u url) head head2))
                  run-codex-review! (fn [_ u] (if (= u url)
                                                {:ok? true :gate-results [] :low-priority-findings {:count 2 :paths ["/p/7.md"]}}
                                                {:ok? true :gate-results []}))]
      (let [g (review-gate! "/nonexistent" (str url " " url2))
            entries (review-findings-entries "BOXP-1" "r4" g {})]
        (is (= 1 (count entries)))
        (is (= url (:pr-url (first entries))))
        (is (str/includes? (:note (first entries)) "2件"))
        (is (str/includes? (:note (first entries)) "/p/7.md"))
        (is (not (str/includes? (:note (first entries)) url2))))))
  (let [g {:ok? true :checked-pr-urls [url url2] :checked-pr-heads {url head url2 head2}
           :low-priority-findings {:count 3 :paths ["/p/7.md" "/p/8.md"]
                                   :by-pr {url {:count 1 :paths ["/p/7.md"]} url2 {:count 2 :paths ["/p/8.md"]}}}}
        [a b :as entries] (review-findings-entries "BOXP-1" "r4" g {})]
    (is (= 2 (count entries)))
    (is (and (str/includes? (:note a) "1件") (str/includes? (:note a) "/p/7.md") (not (str/includes? (:note a) "/p/8.md"))))
    (is (and (str/includes? (:note b) "2件") (str/includes? (:note b) "/p/8.md") (not (str/includes? (:note b) "/p/7.md"))))))

(deftest total-write-failure-does-not-advance-state
  (with-env
    (fn [{:keys [ticket root]}]
      (reset! review-findings-memory-pending {})
      (let [r (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))
                            write-edn-atomically! (fn [& _] (throw (ex-info "root down (synthetic)" {})))]
                (record-review-findings! "BOXP-1" "r1" (blocking-gate)))]
        (is (= [:failed] (mapv :status r)))
        (is (empty? (finding-lines ticket)))
        (is (= :blocking (:kind (get (ticket-state) url))) "memory record is part of the queue"))
      (testing "the record is still re-sent, and only then is it unresolved"
        (flush-all-pending-review-findings!)
        (is (= 1 (count (finding-lines ticket))))
        (is (= :blocking (:kind (get (ticket-state) url))))
        (is (empty? @review-findings-memory-pending)))
      (testing "after a restart lost the memory record, a pass does not report a resolution"
        (reset! review-findings-memory-pending {})
        (with-env
          (fn [{:keys [ticket]}]
            (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))
                          write-edn-atomically! (fn [& _] (throw (ex-info "root down (synthetic)" {})))]
              (record-review-findings! "BOXP-1" "r1" (blocking-gate)))
            (reset! review-findings-memory-pending {})
            (record-review-findings! "BOXP-1" "r2" {:ok? true :checked-pr-urls [url] :checked-pr-heads {url head2}})
            (is (empty? (finding-lines ticket)) "no resolution of an unrecorded finding")))))))

;; --- PR gate retry 2 (codex review P1 x2) ------------------------------------
(defn- state-file-throws [real]
  (fn [path & args]
    (if (str/ends-with? (str path) "review-findings-state.edn")
      (throw (ex-info "state write failed (synthetic)" {}))
      (apply real path args))))

(def pass-gate {:ok? true :checked-pr-urls [url] :checked-pr-heads {url head2}})
(defn resolution-lines [ticket] (filterv #(str/includes? % "レビュー所見解消") (finding-lines ticket)))

(deftest memory-record-moved-to-file-still-advances-state
  (testing "memory record: Notes re-send fails but the pending file write succeeds; written later, the state advances and a pass reports the resolution"
    (with-env
      (fn [{:keys [ticket]}]
        (reset! review-findings-memory-pending {})
        (restart!)
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))
                      write-edn-atomically! (fn [& _] (throw (ex-info "root down (synthetic)" {})))]
          (record-review-findings! "BOXP-1" "r1" (blocking-gate)))
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))]
          (flush-all-pending-review-findings!))
        (is (empty? @review-findings-memory-pending) "moved to the pending file")
        (flush-all-pending-review-findings!)
        (is (= 1 (count (finding-lines ticket))))
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (is (= 1 (count (resolution-lines ticket))) (pr-str (finding-lines ticket)))))))

(deftest state-write-failure-is-retried
  (testing "Notes written but the state file write fails: the state is kept and a later pass reports the resolution"
    (with-env
      (fn [{:keys [ticket root]}]
        (reset! review-findings-memory-pending {})
        (restart!)
        (let [real write-edn-atomically!]
          (with-redefs [write-edn-atomically! (state-file-throws real)]
            (record-review-findings! "BOXP-1" "r1" (blocking-gate))))
        (is (= 1 (count (finding-lines ticket))))
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (is (= 1 (count (resolution-lines ticket))) (pr-str (finding-lines ticket)))
        (is (not-any? #{:blocking :unavailable} (map :kind (vals (ticket-state)))) "no unresolved record left")))
    (testing "the pass itself while the state file still fails also reports the resolution once"
      (with-env
        (fn [{:keys [ticket]}]
          (restart!)
          (let [real write-edn-atomically!]
            (with-redefs [write-edn-atomically! (state-file-throws real)]
              (record-review-findings! "BOXP-1" "r1" (blocking-gate))
              (record-review-findings! "BOXP-1" "r2" pass-gate)
              (record-review-findings! "BOXP-1" "r3" pass-gate)))
          (is (= 1 (count (resolution-lines ticket))) (pr-str (finding-lines ticket))))))))


;; --- PR gate retry 3 (codex review P1: marker collision / order) -------------
(deftest pending-blocking-is-not-lost-behind-a-resolution
  (testing "a queued blocking record that a later resolution mentions is still written, and before the resolution"
    (with-env
      (fn [{:keys [ticket]}]
        (reset! review-findings-memory-pending {})
        (restart!)
        (let [real append-note-once!
              fail-blocking (fn [t m note] (if (str/includes? note "レビュー未解決所見")
                                             (throw (ex-info "vault busy (synthetic)" {}))
                                             (real t m note)))]
          (with-redefs [append-note-once! fail-blocking]
            (record-review-findings! "BOXP-1" "r1" (blocking-gate))
            (record-review-findings! "BOXP-1" "r2" pass-gate))
          (is (empty? (finding-lines ticket)) "the resolution waits behind the unwritten blocking record")
          (flush-all-pending-review-findings!)
          (let [lines (finding-lines ticket)]
            (is (= 2 (count lines)) (pr-str lines))
            (is (str/includes? (first lines) "レビュー未解決所見") (pr-str lines))
            (is (str/includes? (second lines) "レビュー所見解消") (pr-str lines)))
          (is (empty? (get (read-edn-file (fs/path (root) "review-findings-pending.edn") {}) "BOXP-1"))))))))

(deftest marker-matches-only-the-record-head
  (testing "a line that merely mentions the id is not the record itself"
    (with-env
      (fn [{:keys [ticket]}]
        (append-note! "BOXP-1" "メモ: 前回の所見 review-findings:abcdefabcdef を参照")
        (is (= :recorded (append-note-once! "BOXP-1" "review-findings:abcdefabcdef" "review-findings:abcdefabcdef 本体")))
        (is (= :duplicate (append-note-once! "BOXP-1" "review-findings:abcdefabcdef" "review-findings:abcdefabcdef 本体")))
        (is (= 1 (count (filter #(str/includes? % "本体") (str/split-lines (slurp (str ticket))))))))))
  (testing "the resolution line does not carry the prior record's marker"
    (let [[e] (review-findings-entries "BOXP-1" "r9" pass-gate {url {:id "abcdefabcdef" :kind :blocking}})]
      (is (str/includes? (:note e) "abcdefabcdef"))
      (is (not (str/includes? (:note e) "review-findings:abcdefabcdef"))))))

(deftest all-blocking-findings-are-recorded
  (testing "every P0/P1 item is in the record even with more than 10 findings (no truncation)"
    (let [items (vec (for [i (range 13)] {:severity "P1" :location (format "src/f%02d.bb:1" i) :description (str "impact " i)}))
          e (first (review-findings-entries "BOXP-1" "r1" (blocking-gate :blocking-items items :blocking-findings {:count 13 :path "/p/b.md"}) {}))]
      (doseq [i (range 13)]
        (is (str/includes? (:note e) (format "[P1] src/f%02d.bb:1 — impact %d" i i)) (str "item " i)))
      (is (not (str/includes? (:note e) "ほか")))
      (is (not (str/includes? (:note e) "\n"))))))

(deftest low-only-of-passed-prs-kept-when-later-pr-fails
  (testing "a later PR failing does not drop the earlier passed PR's P2/P3/nit record"
    (with-redefs [wait-for-pr-state! (fn [_] {:ok? true :gate-results []})
                  pr-head-oid (fn [u] (if (= u url) head head2))
                  run-codex-review! (fn [_ u] (if (= u url)
                                                {:ok? true :gate-results [] :low-priority-findings {:count 2 :paths ["/p/7.md"]}}
                                                (blocking-gate :url url2)))]
      (let [g (review-gate! "/nonexistent" (str url " " url2))
            entries (review-findings-entries "BOXP-1" "r5" g {})
            low (filter #(= :low-only (:kind %)) entries)
            blk (filter #(= :blocking (:kind %)) entries)]
        (is (= 1 (count blk)))
        (is (= url2 (:pr-url (first blk))))
        (is (= 1 (count low)))
        (is (= url (:pr-url (first low))))
        (is (str/includes? (:note (first low)) "2件"))
        (is (str/includes? (:note (first low)) "/p/7.md"))
        (is (str/includes? (:note (first low)) "0e01838"))
        (is (not (str/includes? (:note (first low)) "codex-review-boxp__example-7.md")) "the failing PR's own low evidence is not attributed to the passed PR"))))
  (testing "a later non-review gate failure (CI) also keeps the passed PR's record"
    (with-redefs [wait-for-pr-state! (fn [u] (if (= u url) {:ok? true :gate-results []}
                                               {:ok? false :gate :ci :url u :retryable? true :gate-results [["ci" "fail"]]}))
                  pr-head-oid (fn [_] head)
                  run-codex-review! (fn [_ _] {:ok? true :gate-results [] :low-priority-findings {:count 1 :paths ["/p/7.md"]}})]
      (let [entries (review-findings-entries "BOXP-1" "r6" (review-gate! "/nonexistent" (str url " " url2)) {})]
        (is (= [[:low-only url]] (mapv (juxt :kind :pr-url) entries)))))))

;; --- PR gate retry 5 (codex review P1: recurrence overtakes resolution) -------
(deftest recurrence-after-resolution-is-written-after-it
  (testing "queued: A, resolution R, then the same A again -> Notes A, R, A' in that order"
    (with-env
      (fn [{:keys [ticket]}]
        (reset! review-findings-memory-pending {})
        (restart!)
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault busy (synthetic)" {})))]
          (record-review-findings! "BOXP-1" "r1" (blocking-gate))
          (record-review-findings! "BOXP-1" "r2" pass-gate)
          (record-review-findings! "BOXP-1" "r3" (blocking-gate)))
        (is (empty? (finding-lines ticket)))
        (flush-all-pending-review-findings!)
        (let [lines (finding-lines ticket)]
          (is (= 3 (count lines)) (pr-str lines))
          (is (str/includes? (nth lines 0 "") "レビュー未解決所見") (pr-str lines))
          (is (str/includes? (nth lines 1 "") "レビュー所見解消") (pr-str lines))
          (is (str/includes? (nth lines 2 "") "レビュー未解決所見") (pr-str lines))
          (is (str/includes? (nth lines 2 "") "run r3") (pr-str lines)))
        (testing "reprocessing the recurrence run adds nothing; a later pass resolves it once"
          (record-review-findings! "BOXP-1" "r3" (blocking-gate))
          (is (= 3 (count (finding-lines ticket))))
          (record-review-findings! "BOXP-1" "r4" pass-gate)
          (record-review-findings! "BOXP-1" "r4" pass-gate)
          (is (= 4 (count (finding-lines ticket))))
          (is (str/includes? (last (finding-lines ticket)) "レビュー所見解消"))))))
  (testing "written directly: the recurrence after a resolution is a new line after it"
    (with-env
      (fn [{:keys [ticket]}]
        (reset! review-findings-memory-pending {})
        (restart!)
        (record-review-findings! "BOXP-1" "r1" (blocking-gate))
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (record-review-findings! "BOXP-1" "r3" (blocking-gate))
        (let [lines (finding-lines ticket)]
          (is (= 3 (count lines)) (pr-str lines))
          (is (str/includes? (nth lines 2 "") "run r3") (pr-str lines)))))))

(deftest requeued-record-keeps-its-position
  (testing "re-queuing an id that is already pending keeps its original order"
    (with-env
      (fn [{:keys [ticket]}]
        (reset! review-findings-memory-pending {})
        (restart!)
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault busy (synthetic)" {})))]
          (record-review-findings! "BOXP-1" "r1" (blocking-gate))
          (record-review-findings! "BOXP-1" "r2" (blocking-gate :url url2))
          ;; the first run is processed again while both still wait
          (record-review-findings! "BOXP-1" "r1" (blocking-gate)))
        (flush-all-pending-review-findings!)
        (let [lines (finding-lines ticket)]
          (is (= 2 (count lines)) (pr-str lines))
          (is (str/includes? (nth lines 0 "") (str "PR " url " ")) (pr-str lines))
          (is (str/includes? (nth lines 1 "") (str "PR " url2 " ")) (pr-str lines)))))))

;; --- PR gate retry 7 (codex review P1: state lost on restart) ----------------
;; spec: 未解決状態は Notes の印付き行と保留ファイルから毎回組み立てる。
(defn- fs-throws-for [suffix real]
  (fn [path & args]
    (if (str/ends-with? (str path) suffix)
      (throw (ex-info "write failed (synthetic)" {}))
      (apply real path args))))

(deftest state-survives-restart
  (testing "Notes written, any other runner file write fails, then restart: a pass still reports the resolution once"
    (with-env
      (fn [{:keys [ticket]}]
        (restart!)
        (let [real write-edn-atomically!]
          (with-redefs [write-edn-atomically! (fs-throws-for "-state.edn" real)]
            (record-review-findings! "BOXP-1" "r1" (blocking-gate))))
        (is (= 1 (count (finding-lines ticket))))
        (restart!)
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (is (= 1 (count (resolution-lines ticket))) (pr-str (finding-lines ticket))))))
  (testing "queued in the pending file, restart, pass: the finding and then its resolution are written in order"
    (with-env
      (fn [{:keys [ticket]}]
        (restart!)
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault busy (synthetic)" {})))]
          (record-review-findings! "BOXP-1" "r1" (blocking-gate)))
        (restart!)
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (let [lines (finding-lines ticket)]
          (is (= 2 (count lines)) (pr-str lines))
          (is (str/includes? (nth lines 0 "") "レビュー未解決所見") (pr-str lines))
          (is (str/includes? (nth lines 1 "") "レビュー所見解消") (pr-str lines))))))
  (testing "recurrence after a resolution survives a restart as a new record"
    (with-env
      (fn [{:keys [ticket]}]
        (restart!)
        (record-review-findings! "BOXP-1" "r1" (blocking-gate))
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (restart!)
        (record-review-findings! "BOXP-1" "r3" (blocking-gate))
        (restart!)
        (record-review-findings! "BOXP-1" "r4" pass-gate)
        (let [lines (finding-lines ticket)]
          (is (= 4 (count lines)) (pr-str lines))
          (is (= ["レビュー未解決所見" "レビュー所見解消" "レビュー未解決所見" "レビュー所見解消"]
                 (mapv #(re-find #"レビュー(?:未解決所見|所見解消)" %) lines)) (pr-str lines))))))
  (testing "a line that only quotes a record is not that record"
    (with-env
      (fn [{:keys [ticket]}]
        (restart!)
        (append-note! "BOXP-1" (str "メモ: review-findings:abcdefabcdef レビュー未解決所見 PR " url " head 0e01838 を参照"))
        (record-review-findings! "BOXP-1" "r2" pass-gate)
        (is (empty? (resolution-lines ticket)) (pr-str (finding-lines ticket)))))))


;; --- PR gate retry (codex review P1: memory record + pass) -------------------
(deftest memory-record-resolution-is-queued-behind-it
  (testing "spec: blocking only in memory → pass before the re-send → resolved queued behind it → re-send writes blocking, resolved"
    (with-env
      (fn [{:keys [ticket]}]
        (restart!)
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))
                      write-edn-atomically! (fn [& _] (throw (ex-info "root down (synthetic)" {})))]
          (record-review-findings! "BOXP-1" "r1" (blocking-gate))
          (record-review-findings! "BOXP-1" "r2" pass-gate))
        (is (empty? (finding-lines ticket)))
        (flush-all-pending-review-findings!)
        (let [ls (finding-lines ticket)]
          (is (= 2 (count ls)) (pr-str ls))
          (is (str/includes? (first ls) "レビュー未解決所見"))
          (is (str/includes? (second ls) "レビュー所見解消")))
        (is (= :resolved (:kind (get (ticket-state) url)))))))
  (testing "spec: blocking in memory → pass with the pending file writable → both kept in the file in order → survive a restart"
    (with-env
      (fn [{:keys [ticket]}]
        (restart!)
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))
                      write-edn-atomically! (fn [& _] (throw (ex-info "root down (synthetic)" {})))]
          (record-review-findings! "BOXP-1" "r1" (blocking-gate)))
        (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))]
          (record-review-findings! "BOXP-1" "r2" pass-gate))
        (restart!)
        (flush-all-pending-review-findings!)
        (let [ls (finding-lines ticket)]
          (is (= 2 (count ls)) (pr-str ls))
          (is (str/includes? (first ls) "レビュー未解決所見"))
          (is (str/includes? (second ls) "レビュー所見解消")))))))

(let [result (run-tests 'user)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
