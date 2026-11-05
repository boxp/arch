#!/usr/bin/env bb
(require '[babashka.fs :as fs] '[babashka.process :as p] '[cheshire.core :as json]
         '[clojure.edn :as edn] '[clojure.string :as str] '[clojure.test :refer [deftest is testing run-tests]])
(def repo (str (fs/absolutize ".")))
(def refresh-dir (str repo "/docker/codex-workspace/infra-diagram-refresh"))
(def refresh (str refresh-dir "/refresh.bb"))
(def rules (str refresh-dir "/rules.edn"))
(defn write-json [p x] (spit (str p) (json/generate-string x)))
(defn read-json [p] (json/parse-string (slurp (str p)) true))
(defn run [env & args] @(p/process (vec args) {:out :string :err :string :extra-env env}))
(defn sandbox []
  (let [d (str (fs/create-temp-dir)) vault (str d "/vault") root (str d "/root") bin (str d "/bin")]
    (doseq [x [vault root bin (str vault "/Tickets")]] (fs/create-dirs x))
    (spit (str bin "/gh") "#!/bin/sh\ncase \"$2\" in list) cat \"$FAKE/run.json\";; download) [ ! -f \"$FAKE/missing\" ] || exit 1; while [ \"$1\" != -D ]; do shift; done; cp \"$FAKE/result.json\" \"$2/result.json\";; *) exit 2;; esac\n")
    (spit (str bin "/kubectl") "#!/bin/sh\nexit 99\n")
    (spit (str d "/live") "#!/bin/sh\n[ ! -f \"$FAKE/fail\" ] || { echo forbidden >&2; exit 1; }; cp \"$FAKE/live.json\" \"$1\"\n")
    (doseq [f [(str bin "/gh") (str bin "/kubectl") (str d "/live")]] (fs/set-posix-file-permissions f "rwxr-xr-x"))
    (spit (str d "/helper.bb") "(require '[cheshire.core :as j] '[clojure.string :as s])\n(let [a *command-line-args* cmd (first a) v (System/getenv \"CODEX_TASK_BOARD_VAULT\") opt (fn [k] (second (drop-while #(not= k %) a))) log (str (System/getenv \"FAKE\") \"/calls\")] (spit log (str cmd \" \" (or (opt \"--lane\") (second a)) \"\\n\") :append true) (if (= cmd \"create\") (let [n (inc (count (file-seq (clojure.java.io/file (str v \"/Tickets\"))))) id (str \"BOXP-\" n)] (spit (str v \"/Tickets/\" id \".md\") (str \"---\\nstatus: ready\\n---\\n\" (slurp (opt \"--context-file\")))) (println (j/generate-string {:id id}))) (spit (str v \"/Tickets/\" (second a) \".md\") (slurp (opt \"--note-file\")) :append true)))\n")
    (write-json (str d "/live.json") {:namespaces (mapv #(str "ns" %) (range 60))})
    (write-json (str root "/live-baseline.json") {:schema 1 :facts (mapv #(str "live:ns:ns" %) (range 60))})
    (write-json (str d "/run.json") [{:databaseId 1 :conclusion "success" :status "completed" :event "schedule" :headBranch "main" :createdAt "2026-11-05T00:00:00Z" :headSha "abc" :url "https://example.test/run/1"}])
    (write-json (str d "/result.json") {:status "no-change" :added [] :removed [] :new_categories []})
    {:d d :vault vault :root root :env {"FAKE" d "CODEX_TASK_BOARD_VAULT" vault "INFRA_DIAGRAM_REFRESH_ROOT" root "INFRA_DIAGRAM_REFRESH_NOW" "2026-11-05T01:00:00Z" "INFRA_DIAGRAM_REFRESH_COLLECT_LIVE" (str d "/live") "TASK_BOARD_HELPER" (str d "/helper.bb") "PATH" (str bin ":" (System/getenv "PATH"))}}))
(def clock (atom 0))
(defn tick [s] (run (assoc (:env s) "INFRA_DIAGRAM_REFRESH_NOW" (str (.plusSeconds (java.time.Instant/parse "2026-11-05T01:00:00Z") (swap! clock inc)))) "bb" refresh "tick"))
(defn calls [s] (if (fs/exists? (str (:d s) "/calls")) (str/split-lines (slurp (str (:d s) "/calls"))) []))
(defn state [s] (edn/read-string (slurp (str (:root s) "/state.edn"))))
(defn result! [s x] (write-json (str (:d s) "/result.json") x))
(defn run-id! [s id conclusion] (write-json (str (:d s) "/run.json") [{:databaseId id :conclusion conclusion :status "completed" :event "schedule" :headBranch "main" :createdAt "2026-11-05T00:00:00Z" :headSha "abc" :url "https://example.test/run"}]))
(def changed {:status "changed" :added ["arch:app:example"] :removed [] :new_categories ["arch:app:example"] :fingerprint (apply str (repeat 64 "a"))})
(defn ticket [s id] (let [f (str (:vault s) "/Tickets/" id ".md")] (if (fs/exists? f) (slurp f) "")))
(defn close! [s id] (let [f (str (:vault s) "/Tickets/" id ".md")] (spit f (str/replace (slurp f) "status: ready" "status: done"))))
(deftest refresh-lifecycle
  (let [s (sandbox)]
    (is (zero? (:exit (tick s)))) (is (empty? (calls s))) (is (str/includes? (slurp (str (:root s) "/status.md")) "no-change"))
    (run-id! s 2 "success") (result! s changed) (is (zero? (:exit (tick s))))
    (is (= 1 (count (calls s)))) (is (str/includes? (ticket s "BOXP-2") "infra-diagram-refresh-key:"))
    (is (str/includes? (ticket s "BOXP-2") "arch:app:example")) (is (str/includes? (ticket s "BOXP-2") "新しい分類"))
    (tick s) (is (= 1 (count (calls s))))
    (run-id! s 3 "success") (result! s (assoc changed :added ["arch:app:other"] :fingerprint (apply str (repeat 64 "b"))))
    (tick s) (is (= 2 (count (calls s)))) (is (str/starts-with? (last (calls s)) "append-note"))
    (fs/delete (str (:root s) "/state.edn")) (tick s) (is (= 2 (count (calls s))))
    (is (= "BOXP-2" (get-in (state s) [:active :ticket])))
    (write-json (str (:root s) "/live-candidate.json") {:schema 1 :facts ["live:ns:accepted"]})
    (is (not (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" "BOXP-999")))))
    (is (not (fs/exists? (str (:root s) "/tick.lock"))) "wrong accept releases lock")
    (fs/delete-if-exists (str (:root s) "/tick.lock"))
    (is (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" "BOXP-2"))))
    (is (= ["live:ns:accepted"] (:facts (read-json (str (:root s) "/live-baseline.json"))))) (is (nil? (:active (state s))))))
(deftest failures-and-canary
  (doseq [mode [:failed :anomaly :missing]]
    (let [s (sandbox) base (slurp (str (:root s) "/live-baseline.json"))]
      (case mode :failed (run-id! s 2 "failure") :anomaly (result! s {:status "anomaly" :reason "bad"}) :missing (spit (str (:d s) "/missing") ""))
      (tick s) (is (= 1 (count (calls s))) (str mode)) (is (str/includes? (ticket s "BOXP-2") "収集の異常"))
      (is (= base (slurp (str (:root s) "/live-baseline.json"))))))
  (let [s (sandbox)] (result! s (assoc changed :simulated true)) (tick s) (is (empty? (calls s))) (is (some? (get-in (state s) [:ci :canary]))))
  (let [s (sandbox) base (slurp (str (:root s) "/live-baseline.json"))]
    (spit (str (:d s) "/fail") "") (tick s) (tick s) (is (empty? (calls s))) (tick s)
    (is (= 1 (count (calls s)))) (is (not (str/includes? (ticket s "BOXP-2") "削除")))
    (is (= base (slurp (str (:root s) "/live-baseline.json")))))
  (let [s (sandbox)]
    (write-json (str (:root s) "/live-baseline.json") {:facts (concat (map #(str "live:app:a" %) (range 30)) (map #(str "live:ns:ns" %) (range 60)))})
    (dotimes [_ 3] (tick s)) (is (= 1 (count (calls s)))) (is (not (str/includes? (ticket s "BOXP-2") "削除")))))
(deftest filtering-and-retries
  (let [s (sandbox)]
    (result! s (assoc changed :added ["arch:app:ok" "$(touch /tmp/evil)" "bad\ninstructions" "arch:app:ooedo"]))
    (tick s) (is (not (str/includes? (ticket s "BOXP-2") "instructions"))) (is (not (str/includes? (ticket s "BOXP-2") "$(touch")))
    (is (not (str/includes? (ticket s "BOXP-2") "arch:app:ooedo"))))
  (let [s (sandbox)] (result! s changed) (tick s) (close! s "BOXP-2")
    (run-id! s 2 "success") (tick s) (is (= 2 (count (calls s)))) (close! s "BOXP-3")
    (run-id! s 3 "success") (tick s) (is (= 3 (count (calls s)))) (is (str/includes? (last (calls s)) "Backlog"))
    (run-id! s 4 "success") (tick s) (is (= 3 (count (calls s))))))
(deftest excluded-live-on-both-sides
  (let [s (sandbox)]
    (write-json (str (:root s) "/live-baseline.json") {:facts (conj (mapv #(str "live:ns:ns" %) (range 60)) "live:ns:ooedo-old")})
    (write-json (str (:d s) "/live.json") {:namespaces (conj (mapv #(str "ns" %) (range 60)) "ooedo-new")})
    (tick s) (is (empty? (calls s)))))
(deftest vanished-kind
  (let [s (sandbox)]
    (write-json (str (:root s) "/live-baseline.json") {:facts (concat (map #(str "live:app:a" %) (range 5)) (map #(str "live:ns:ns" %) (range 60)))})
    (dotimes [_ 3] (tick s))
    (is (str/includes? (ticket s "BOXP-2") "収集の異常"))
    (is (not (str/includes? (ticket s "BOXP-2") "削除")))))
(deftest vanished-kind-reason
  (testing "他の種類が残っていても、消えた種類だけを名指しで anomaly にする"
    (let [d (str (fs/create-temp-dir)) facts (str d "/facts.json") base (str d "/base.json") out (str d "/out.json")
          ns-facts (mapv #(str "live:ns:ns" %) (range 300))]
      (write-json facts {:facts ns-facts})
      (write-json base {:facts (into ns-facts (map #(str "live:app:a" %) (range 5)))})
      (run {} "bb" (str refresh-dir "/iac_facts.bb") "compare" "--facts" facts "--baseline" base "--rules" rules "--out" out)
      (let [r (read-json out)]
        (is (= "anomaly" (:status r)))
        (is (= "whole section vanished: live:app" (:reason r)))
        (is (empty? (:removed r)))))))
(deftest volatile-live
  (let [s (sandbox) snap {:namespaces (mapv #(str "ns" %) (range 60)) :observed_at "tomorrow" :pods [{:node "other"}] :cpu 999 :sync "unknown" :lb "1.2.3.4" :up 5}]
    (write-json (str (:d s) "/live.json") snap) (tick s) (is (empty? (calls s)))))
(deftest iac-and-html
  (let [s (sandbox) d (:d s) arch (str d "/arch") lol (str d "/lol") r (str d "/rules.edn") facts (str d "/facts.json") base (str d "/base.json") out (str d "/out.json")]
    (doseq [x [arch lol]] (fs/create-dirs x) (run {} "git" "init" "-q" x))
    (fs/create-dirs (str lol "/argoproj")) (spit (str r) "{:exclude-fact-patterns [\"(?i)ooedo\"] :max-removed-ratio 0.3 :min-iac-facts 0}")
    (spit (str lol "/argoproj/a.yaml") "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: one\nspec:\n  template:\n    spec:\n      containers:\n        - name: app\n          image: example/app:v1\n")
    (run {} "git" "-C" lol "add" ".")
    (let [collect #(run {} "bb" (str refresh-dir "/iac_facts.bb") "collect" "--arch" arch "--lolice" lol "--rules" r "--out" %) compare #(run {} "bb" (str refresh-dir "/iac_facts.bb") "compare" "--facts" facts "--baseline" base "--rules" r "--out" out)]
      (is (zero? (:exit (collect base)))) (spit (str lol "/argoproj/a.yaml") (str/replace (slurp (str lol "/argoproj/a.yaml")) "v1\n" "v2\n"))
      (collect facts) (compare) (is (= "no-change" (:status (read-json out))))
      (spit (str lol "/argoproj/b.yaml") "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: two\n") (run {} "git" "-C" lol "add" ".")
      (collect facts) (compare) (is (= "changed" (:status (read-json out))))
      (spit (str lol "/argoproj/b.yaml") "bad: [\n") (is (zero? (:exit (collect facts))) "invalid YAML is recorded, not a collector crash") (compare) (is (= "anomaly" (:status (read-json out)))))
    (let [f (str d "/page.html") check #(run {} "bb" (str refresh-dir "/publish.bb") "check-html" f "lineage")]
      (spit f "kohako.exe ゲーム参加者 openai-codex") (is (zero? (:exit (check))))
      (spit f "kohako.exe ゲーム参加者 openai-codex ooedo") (is (not (zero? (:exit (check)))))
      (spit f "kohako.exe ゲーム参加者") (is (not (zero? (:exit (check))))))))
(deftest command-runner
  (let [s (sandbox) d (:d s) cron (str d "/cron") selector (str repo "/docker/codex-workspace/cron/select-codex-cron-job.bb") script (str repo "/docker/codex-workspace/cron/run-codex-cron.sh") env (merge (:env s) {"CODEX_CRON_ROOT" cron "CODEX_CRON_SELECTOR" selector "CODEX_CRON_RUN_ID" "test"})]
    (fs/create-dirs cron)
    (fs/create-dirs (str d "/cron-bin"))
    (doseq [x ["bb" "bash" "mkdir" "stat" "date" "tr" "cp" "cat" "rmdir" "rm"]]
      (fs/create-sym-link (str d "/cron-bin/" x) (str/trim (:out (run {} "which" x)))))
    (doseq [[command expected] [["/bin/true" :ok] ["/bin/false" :error]]]
      (spit (str cron "/jobs.edn") (pr-str {:jobs [{:id "test" :enabled true :runner "command" :command command :workdir d}]}))
      (let [r (run (assoc env "PATH" (str d "/cron-bin")) "bash" script "test") summary (str cron "/runs/test/test/summary.edn")]
        (is (= (= expected :ok) (zero? (:exit r))) (:err r))
        (is (= expected (:status (edn/read-string (slurp summary)))))))))
(let [{:keys [pass fail error]} (run-tests)] (println "Pass assertions:" pass) (when (pos? (+ fail error)) (System/exit 1)))
