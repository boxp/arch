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
        (is (empty? (get (read-edn-file (fs/path root "review-findings-state.edn") {}) "BOXP-1")) "state not advanced"))
      (testing "the record is still re-sent, and only then is it unresolved"
        (flush-all-pending-review-findings!)
        (is (= 1 (count (finding-lines ticket))))
        (is (seq (get (read-edn-file (fs/path root "review-findings-state.edn") {}) "BOXP-1")))
        (is (empty? @review-findings-memory-pending)))
      (testing "a pass before the re-send would not report a resolution"
        (reset! review-findings-memory-pending {})
        (with-env
          (fn [{:keys [ticket]}]
            (with-redefs [append-note-once! (fn [& _] (throw (ex-info "vault down (synthetic)" {})))
                          write-edn-atomically! (fn [& _] (throw (ex-info "root down (synthetic)" {})))]
              (record-review-findings! "BOXP-1" "r1" (blocking-gate)))
            (reset! review-findings-memory-pending {})
            (record-review-findings! "BOXP-1" "r2" {:ok? true :checked-pr-urls [url] :checked-pr-heads {url head2}})
            (is (empty? (finding-lines ticket)) "no resolution of an unrecorded finding")))))))

(let [result (run-tests 'user)] (when (pos? (+ (:fail result) (:error result))) (System/exit 1)))
