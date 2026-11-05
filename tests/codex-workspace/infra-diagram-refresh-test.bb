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
    (spit (str bin "/gh") "#!/bin/sh\ncase \"$2\" in list) cat \"$FAKE/run.json\";; download) [ ! -f \"$FAKE/missing\" ] || exit 1; id=\"$3\"; src=\"$FAKE/result.json\"; [ ! -f \"$FAKE/result-$id.json\" ] || src=\"$FAKE/result-$id.json\"; while [ \"$1\" != -D ]; do shift; done; cp \"$src\" \"$2/result.json\";; *) exit 2;; esac\n")
    (spit (str bin "/kubectl") "#!/bin/sh\nexit 99\n")
    (spit (str d "/live") "#!/bin/sh\n[ ! -f \"$FAKE/fail\" ] || { echo forbidden >&2; exit 1; }; cp \"$FAKE/live.json\" \"$1\"\n")
    (doseq [f [(str bin "/gh") (str bin "/kubectl") (str d "/live")]] (fs/set-posix-file-permissions f "rwxr-xr-x"))
    (spit (str d "/helper.bb") "(require '[cheshire.core :as j] '[clojure.string :as s])\n(let [a *command-line-args* cmd (first a) v (System/getenv \"CODEX_TASK_BOARD_VAULT\") opt (fn [k] (second (drop-while #(not= k %) a))) log (str (System/getenv \"FAKE\") \"/calls\")] (spit (str (System/getenv \"FAKE\") \"/body-paths\") (str (or (opt \"--context-file\") (opt \"--note-file\")) \"\\n\") :append true) (when (.exists (clojure.java.io/file (str (System/getenv \"FAKE\") \"/helper-fail\"))) (System/exit 1)) (spit log (str cmd \" \" (or (opt \"--lane\") (second a)) \"\\n\") :append true) (if (= cmd \"create\") (let [n (inc (count (file-seq (clojure.java.io/file (str v \"/Tickets\"))))) id (str \"BOXP-\" n)] (spit (str v \"/Tickets/\" id \".md\") (str \"---\\nstatus: ready\\n---\\n\" (slurp (opt \"--context-file\")))) (println (j/generate-string {:id id}))) (spit (str v \"/Tickets/\" (second a) \".md\") (slurp (opt \"--note-file\")) :append true)))\n")
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
    (write-json (str (:root s) "/live-candidate.json") {:schema 1 :ticket "BOXP-2" :facts ["live:ns:accepted"]})
    (is (not (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" "BOXP-999")))))
    (is (not (fs/exists? (str (:root s) "/tick.lock"))) "wrong accept releases lock")
    (fs/delete-if-exists (str (:root s) "/tick.lock"))
    (is (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" "BOXP-2"))))
    (is (= ["live:ns:accepted"] (:facts (read-json (str (:root s) "/live-baseline.json"))))) (is (nil? (:active (state s))))))
(deftest stale-live-candidate-does-not-move-baseline
  (testing "別の票の候補と、票の無い候補は基準へ入らない"
    (doseq [cand [{:schema 1 :ticket "BOXP-1" :facts ["live:ns:stale"]} {:schema 1 :facts ["live:ns:stale"]}]]
      (let [s (sandbox)
            base (read-json (str (:root s) "/live-baseline.json"))]
        (tick s)
        (run-id! s 2 "success") (result! s changed) (tick s)
        (is (= "BOXP-2" (get-in (state s) [:active :ticket])))
        (write-json (str (:root s) "/live-candidate.json") cand)
        (is (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" "BOXP-2"))))
        (is (= (:facts base) (:facts (read-json (str (:root s) "/live-baseline.json")))))
        (is (not (fs/exists? (str (:root s) "/live-candidate.json")))))))
  (testing "live に差分があるとき、別の票の候補では accept しない"
    (let [s (sandbox)
          base (read-json (str (:root s) "/live-baseline.json"))]
      (write-json (str (:d s) "/live.json") {:namespaces (conj (mapv #(str "ns" %) (range 60)) "added")})
      (tick s)
      (is (= "changed" (get-in (state s) [:live :result :status])))
      (let [id (get-in (state s) [:active :ticket])
            cand (str (:root s) "/live-candidate.json")]
        (write-json cand {:schema 1 :ticket "BOXP-1" :facts ["live:ns:stale"]})
        (is (not (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" id)))))
        (is (= (:facts base) (:facts (read-json (str (:root s) "/live-baseline.json")))))
        (is (= id (get-in (state s) [:active :ticket])))
        (testing "この票の候補なら受け入れ、基準にどの票かを残す"
          (is (zero? (:exit (run (:env s) "bb" refresh "live-candidate" "--ticket" id (str (:d s) "/live.json")))))
          (is (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" id))))
          (let [b (read-json (str (:root s) "/live-baseline.json"))]
            (is (some #{"live:ns:added"} (:facts b)))
            (is (= id (:ticket b))))
          (is (not (fs/exists? cand))))))))
(deftest ingress-diff-reaches-ticket
  (let [s (sandbox)
        fact "lolice:ingress-backend:n/web:*:/->other:80"
        gone "lolice:ingress-backend:n/web:a.b0xp.io:/->web:80"]
    (tick s)
    (run-id! s 2 "success")
    (result! s (assoc changed :added [fact "bad`fact"] :removed [gone]))
    (tick s)
    (let [t (ticket s "BOXP-2")]
      (is (str/includes? t (str "追加 `" fact "`")))
      (is (str/includes? t (str "削除 `" gone "`")))
      (is (str/includes? t "形式が合わず省いた差分**: 1 件"))
      (is (not (str/includes? t "bad`fact"))))))
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
(defn body-paths [s] (str/split-lines (slurp (str (:d s) "/body-paths"))))
(defn left-tmp [s] (filter #(str/starts-with? (str (fs/file-name %)) ".tmp-") (fs/list-dir (:root s))))
(deftest ticket-body-files-do-not-remain
  (testing "起票と集約の本文は vault の中に置き、終われば消す"
    (let [s (sandbox)]
      (result! s changed) (tick s)
      (run-id! s 2 "success") (result! s (assoc changed :added ["arch:app:other"] :fingerprint (apply str (repeat 64 "b")))) (tick s)
      (is (= 2 (count (body-paths s))))
      (doseq [p (body-paths s)]
        (is (str/starts-with? p (:root s)))
        (is (not (fs/exists? p))))
      (is (empty? (left-tmp s)))))
  (testing "helper が失敗しても残さない"
    (let [s (sandbox)]
      (result! s changed) (spit (str (:d s) "/helper-fail") "")
      (is (not (zero? (:exit (tick s)))))
      (is (= 1 (count (body-paths s))))
      (is (not (fs/exists? (first (body-paths s)))))
      (is (empty? (left-tmp s)))))
  (testing "live の収集の作業ファイルも残さない"
    (let [s (sandbox)] (spit (str (:d s) "/fail") "") (tick s) (is (empty? (left-tmp s))))))
(def publish (str refresh-dir "/publish.bb"))
(def diagram-dirs {"lineage" ["lolice-infrastructure-lineage" "lolice-lineage.html"]
                   "architecture" ["lolice-infrastructure-architecture" "lolice-architecture.html"]})
(defn project-digest [dir html]
  (str/trim (:out (run {} "bb" "-e" (str "(load-file " (pr-str publish) ") (println (project-digest " (pr-str dir) " " (pr-str html) "))")))))
(defn publish-sandbox
  "build までを偽の道具で通す。正本は old、staging の build が new を作る。"
  []
  (let [s (sandbox) d (:d s) cache (str d "/cache") st (str cache "/staging/BOXP-9") r (str d "/publish-rules.edn")
        env (merge (:env s) {"INFRA_DIAGRAM_REFRESH_CACHE" cache "INFRA_DIAGRAM_REFRESH_RULES" r})]
    (spit r "{:exclude-fact-patterns [\"(?i)ooedo\"]}")
    (let [bases (into {} (for [[id [project html]] diagram-dirs
                               :let [v (str (:vault s) "/Projects/" project) p (str st "/Projects/" project)]]
                           (do (doseq [x [(str v "/data") (str p "/data") (str p "/src") (str p "/tools")]] (fs/create-dirs x))
                               (spit (str v "/" html) "old") (spit (str v "/data/a.edn") "old")
                               (spit (str p "/data/a.edn") "{:new true}") (spit (str p "/src/s.txt") "src")
                               (write-json (str p "/data/live-snapshot.json") {:namespaces ["ns1"]})
                               (spit (str p "/tools/build.bb") (str "(spit \"data/generated.json\" \"{}\") (spit \"" html "\" \"new\")"))
                               (spit (str p "/tools/run-browser.sh") "#!/bin/sh\ncase \"$1\" in *make-thumbnail*) mkdir -p \"$3\"; head -c 6000 /dev/zero > \"$3/lolice-lineage.webp\"; head -c 6000 /dev/zero > \"$3/lolice-architecture.webp\";; esac\n")
                               (fs/set-posix-file-permissions (str p "/tools/run-browser.sh") "rwxr-xr-x")
                               [id (project-digest v html)])))]
      (spit (str st "/manifest.edn") (pr-str {:ticket "BOXP-9" :bases bases :built nil :deployed {}}))
      (assoc s :st st :penv env))))
(defn mark-deployed!
  "実配備は gh が要るので、配備の確認が済んだ状態を manifest へ書く。"
  [{:keys [st]}]
  (let [f (str st "/manifest.edn") m (edn/read-string (slurp f))]
    (spit f (pr-str (assoc m :deployed (:built m) :verified true)))))
(deftest promote-only-what-was-built
  (let [lineage "Projects/lolice-infrastructure-lineage/"
        cases {"data" (str lineage "data/a.edn") "src" (str lineage "src/s.txt") "tools" (str lineage "tools/build.bb")
               "html" (str lineage "lolice-lineage.html") "thumbnail" "thumbnails/lolice-lineage.webp"}]
    (doseq [[label rel] cases]
      (testing (str "build 後に " label " を変えたら止まり、正本は変わらない")
        (let [s (publish-sandbox) penv (:penv s)]
          (is (zero? (:exit (run penv "bb" publish "build" "BOXP-9"))))
          (mark-deployed! s)
          (spit (str (:st s) "/" rel) "tampered")
          (let [promote (run penv "bb" publish "promote" "BOXP-9") deploy (run penv "bb" publish "deploy" "BOXP-9")]
            (is (not (zero? (:exit promote))))
            (is (str/includes? (:err promote) "changed after build"))
            (is (not (zero? (:exit deploy))))
            (is (str/includes? (:err deploy) "changed after build")))
          (is (= "old" (slurp (str (:vault s) "/" lineage "lolice-lineage.html"))))
          (is (= "old" (slurp (str (:vault s) "/" lineage "data/a.edn")))))))
    (testing "build 後にファイルを足しても止まる"
      (let [s (publish-sandbox) penv (:penv s)]
        (run penv "bb" publish "build" "BOXP-9") (mark-deployed! s)
        (spit (str (:st s) "/" lineage "src/extra.txt") "x")
        (is (not (zero? (:exit (run penv "bb" publish "promote" "BOXP-9")))))))
    (testing "build 後に変更が無ければ正本を新版にし、やり直しも通る"
      (let [s (publish-sandbox) penv (:penv s)]
        (is (zero? (:exit (run penv "bb" publish "build" "BOXP-9"))))
        (mark-deployed! s)
        (let [r (run penv "bb" publish "promote" "BOXP-9")] (is (zero? (:exit r)) (:err r)))
        (is (= "new" (slurp (str (:vault s) "/" lineage "lolice-lineage.html"))))
        (is (= "{:new true}" (slurp (str (:vault s) "/" lineage "data/a.edn"))))
        (is (fs/exists? (str (:root s) "/live-candidate.json")))
        (is (zero? (:exit (run penv "bb" publish "promote" "BOXP-9"))))))
    (testing "記録の無い古い staging は確かめられないので止める"
      (let [s (publish-sandbox) penv (:penv s) f (str (:st s) "/manifest.edn")]
        (run penv "bb" publish "build" "BOXP-9") (mark-deployed! s)
        (spit f (pr-str (dissoc (edn/read-string (slurp f)) :built-digests)))
        (is (not (zero? (:exit (run penv "bb" publish "promote" "BOXP-9")))))))))
(defn rebase!
  "正本を変えたうえで stage し直した状態にする。"
  [{:keys [st vault]}]
  (let [f (str st "/manifest.edn") m (edn/read-string (slurp f))]
    (spit f (pr-str (assoc m :bases (into {} (for [[id [project html]] diagram-dirs]
                                               [id (project-digest (str vault "/Projects/" project) html)])))))))
(deftest promote-compares-the-whole-project
  (let [lineage "/Projects/lolice-infrastructure-lineage/"
        same-html! (fn [s] (doseq [[_ [project html]] diagram-dirs] (spit (str (:vault s) "/Projects/" project "/" html) "new")) (rebase! s))
        built (fn [s] (run (:penv s) "bb" publish "build" "BOXP-9") (mark-deployed! s))
        promote (fn [s] (run (:penv s) "bb" publish "promote" "BOXP-9"))]
    (testing "HTML が同じでも data、src、tools の更新は正本へ入り、前の版を残す"
      (let [s (publish-sandbox) v (str (:vault s) lineage)]
        (same-html! s) (built s)
        (let [r (promote s)] (is (zero? (:exit r)) (:err r)))
        (is (= "{:new true}" (slurp (str v "data/a.edn"))))
        (is (= "src" (slurp (str v "src/s.txt"))))
        (is (fs/exists? (str v "tools/build.bb")))
        (is (seq (fs/glob (str v "previous") "*/data/a.edn")))
        (is (zero? (:exit (promote s))))
        (is (= 1 (count (fs/list-dir (str v "previous")))) "やり直しで版を増やさない")))
    (testing "HTML が同じでも、stage の後に正本の data を変えた作業は上書きしない"
      (let [s (publish-sandbox) v (str (:vault s) lineage)]
        (same-html! s) (built s)
        (spit (str v "data/a.edn") "other work")
        (let [r (promote s)] (is (not (zero? (:exit r)))) (is (str/includes? (:err r) "changed since stage")))
        (is (= "other work" (slurp (str v "data/a.edn"))))))
    (testing "全体図の正本だけが変わっていても、lineage を先に更新しない"
      (let [s (publish-sandbox) v (str (:vault s) lineage)
            arch (str (:vault s) "/Projects/lolice-infrastructure-architecture/")]
        (built s)
        (spit (str arch "data/a.edn") "other work")
        (let [r (promote s)] (is (not (zero? (:exit r)))) (is (str/includes? (:err r) "stage again: architecture")))
        (is (= "old" (slurp (str v "lolice-lineage.html"))))
        (is (= "old" (slurp (str v "data/a.edn"))))
        (is (not (fs/exists? (str v "previous"))))
        (is (= "other work" (slurp (str arch "data/a.edn"))))))
    (testing "staging で消したファイルは正本からも消え、やり直しも通る"
      (let [s (publish-sandbox) v (str (:vault s) lineage)]
        (spit (str v "data/removed.edn") "old") (rebase! s) (built s)
        (is (zero? (:exit (promote s))))
        (is (not (fs/exists? (str v "data/removed.edn"))))
        (is (zero? (:exit (promote s))))))
    (testing "途中で止まった promote は再開でき、版を増やさない"
      (let [s (publish-sandbox) v (str (:vault s) lineage) f (str (:st s) "/manifest.edn")]
        (built s)
        (spit (str v "data/a.edn") "half copied")
        (spit f (pr-str (assoc-in (edn/read-string (slurp f)) [:promoting "lineage"] true)))
        (let [r (promote s)] (is (zero? (:exit r)) (:err r)))
        (is (= "{:new true}" (slurp (str v "data/a.edn"))))
        (is (= "new" (slurp (str v "lolice-lineage.html"))))
        (is (not (fs/exists? (str v "previous"))))
        (is (empty? (:promoting (edn/read-string (slurp f)))) "再開の完了で印を消す")))
    (testing "promote の完了後に正本を変えた作業は、再実行で上書きしない"
      (doseq [[label prepare!] {"通常の完了" (fn [_ _] nil)
                                "再開での完了" (fn [s f] (spit f (pr-str (assoc-in (edn/read-string (slurp f)) [:promoting "lineage"] true))))}]
        (testing label
          (let [s (publish-sandbox) v (str (:vault s) lineage) f (str (:st s) "/manifest.edn")]
            (built s)
            (prepare! s f)
            (let [r (promote s)] (is (zero? (:exit r)) (:err r)))
            (is (empty? (:promoting (edn/read-string (slurp f)))))
            (spit (str v "data/a.edn") "other work")
            (let [r (promote s)]
              (is (not (zero? (:exit r))))
              (is (str/includes? (:err r) "changed since stage")))
            (is (= "other work" (slurp (str v "data/a.edn"))))))))))
(deftest collect-live-stays-next-to-output
  (let [d (str (fs/create-temp-dir)) bin (str d "/bin") tmpdir (str d "/tmp") out-dir (str d "/out") out (str out-dir "/live.json") seen (str d "/seen")
        env {"PATH" (str bin ":" (System/getenv "PATH")) "TMPDIR" tmpdir "OUT_DIR" out-dir "SEEN" seen
             "GRAFANA_URL" "https://grafana.test" "GRAFANA_SERVICE_ACCOUNT_TOKEN" "x"}
        collect #(run env "bash" (str refresh-dir "/collect-live.sh") out)]
    (doseq [x [bin tmpdir out-dir]] (fs/create-dirs x))
    (spit (str bin "/kubectl") "#!/bin/sh\n[ ! -f \"$SEEN.fail\" ] || exit 1\nls -A \"$OUT_DIR\" >> \"$SEEN\"\necho '{\"items\":[]}'\n")
    (spit (str bin "/curl") "#!/bin/sh\necho '{\"data\":{\"result\":[]}}'\n")
    (doseq [f ["/kubectl" "/curl"]] (fs/set-posix-file-permissions (str bin f) "rwxr-xr-x"))
    (let [r (collect)] (is (zero? (:exit r)) (:err r)))
    (is (str/includes? (slurp seen) ".collect-live.") "収集中の作業場所は出力先の隣")
    (is (empty? (fs/list-dir tmpdir)) "既定の一時領域に何も置かない")
    (is (= ["live.json"] (map #(str (fs/file-name %)) (fs/list-dir out-dir))) "作業場所を残さない")
    (spit (str seen ".fail") "") (fs/delete out)
    (is (not (zero? (:exit (collect)))))
    (is (empty? (fs/list-dir out-dir)) "失敗時は何も出さず、作業場所も残さない")
    (is (empty? (fs/list-dir tmpdir)))))
(deftest canary-does-not-replay-unresolved-diff
  (testing "前の未解決の差分があっても、simulate の run は起票しない"
    (let [s (sandbox) sim (assoc changed :simulated true)]
      (result! s changed) (tick s) (is (= 1 (count (calls s))))
      (close! s "BOXP-2")
      (run-id! s 2 "success") (result! s sim) (tick s)
      (is (= 1 (count (calls s))) "閉じた票の再起票をしない")
      (is (= "no-new-input" (:last-result (state s))))
      (is (= 2 (get-in (state s) [:ci :canary :run-id])))
      (testing "実 run の差分は次の tick で従来どおり起票する"
        (run-id! s 3 "success") (result! s changed) (tick s)
        (is (= 2 (count (calls s)))))))
  (testing "処理中の票がある間も、simulate の run は集約しない"
    (let [s (sandbox)]
      (result! s changed) (tick s)
      (run-id! s 2 "success") (result! s (assoc changed :simulated true :fingerprint (apply str (repeat 64 "c")))) (tick s)
      (is (= 1 (count (calls s))))
      (is (= "BOXP-2" (get-in (state s) [:active :ticket]))))))
(defn runs! [s & rs]
  (write-json (str (:d s) "/run.json")
              (for [[id conclusion] rs]
                {:databaseId id :conclusion conclusion :status "completed" :event "workflow_dispatch" :headBranch "main"
                 :createdAt (format "2026-11-05T00:%02d:00Z" id) :headSha "abc" :url (str "https://example.test/run/" id)})))
(defn run-result! [s id x] (write-json (str (:d s) "/result-" id ".json") x))
(deftest canary-after-normal-run
  (testing "確認の前に canary が後から完了しても、通常 run の差分を起票する"
    (let [s (sandbox)]
      (tick s)
      (run-result! s 2 changed) (run-result! s 3 (assoc changed :simulated true :added ["arch:app:fake"]))
      ;; gh の返す順に依存しない
      (runs! s [3 "success"] [2 "success"])
      (tick s)
      (is (= 1 (count (calls s))))
      (is (str/includes? (ticket s "BOXP-2") "arch:app:example"))
      (is (not (str/includes? (ticket s "BOXP-2") "arch:app:fake")))
      (is (str/includes? (ticket s "BOXP-2") "https://example.test/run/2") "票の run は通常 run を指す")
      (is (= 3 (get-in (state s) [:ci :canary :run-id])))
      (is (= 3 (get-in (state s) [:ci :run-id])))
      (tick s)
      (is (= 1 (count (calls s))) "読んだ run を読み直さない")))
  (testing "通常 run の失敗の後に canary が完了しても、失敗を報告する"
    (let [s (sandbox)]
      (tick s)
      (run-result! s 2 {:status "anomaly" :reason "bad"}) (run-result! s 3 {:status "no-change" :simulated true :added [] :removed [] :new_categories []})
      (runs! s [2 "failure"] [3 "success"])
      (tick s)
      (is (= 1 (count (calls s))))
      (is (str/includes? (ticket s "BOXP-2") "収集の異常"))))
  (testing "差分の run の後に失敗の run が続いても、差分を失わない"
    (let [s (sandbox)]
      (tick s)
      (run-result! s 2 changed) (run-result! s 3 {:status "anomaly" :reason "bad"})
      (runs! s [2 "success"] [3 "failure"])
      (tick s)
      (is (str/includes? (ticket s "BOXP-2") "arch:app:example"))
      (is (str/includes? (ticket s "BOXP-2") "収集の異常")))))
(deftest late-completed-older-run
  (testing "ID の大きい run が先に完了しても、後から完了した小さい ID の run を読む"
    (let [s (sandbox)]
      (tick s)
      (run-result! s 3 {:status "no-change" :added [] :removed [] :new_categories []})
      (runs! s [3 "success"])
      (tick s)
      (is (empty? (calls s)))
      (run-result! s 2 {:status "anomaly" :reason "bad"})
      (runs! s [3 "success"] [2 "failure"])
      (tick s)
      (is (= 1 (count (calls s))) "後から完了した失敗を報告する")
      (is (str/includes? (ticket s "BOXP-2") "収集の異常"))
      (tick s)
      (is (= 1 (count (calls s))) "読んだ run を読み直さない")))
  (testing "後から完了した古い run の成功は、新しい run の差分を巻き戻さない"
    (let [s (sandbox)]
      (tick s)
      (run-result! s 3 changed) (runs! s [3 "success"]) (tick s)
      (is (= 1 (count (calls s))))
      (run-result! s 2 {:status "no-change" :added [] :removed [] :new_categories []})
      (runs! s [3 "success"] [2 "success"]) (tick s)
      (is (= "changed" (get-in (state s) [:ci :result :status])))
      (is (= 3 (get-in (state s) [:ci :input-run-id]))))))
(deftest failure-then-success-in-one-tick
  (testing "同じ tick で失敗の後に成功が読まれても、間の失敗を報告する"
    (let [s (sandbox)]
      (tick s)
      (run-result! s 2 {:status "anomaly" :reason "bad"})
      (run-result! s 3 {:status "no-change" :added [] :removed [] :new_categories []})
      (runs! s [2 "failure"] [3 "success"])
      (tick s)
      (is (= 1 (count (calls s))))
      (is (str/includes? (ticket s "BOXP-2") "収集の異常"))
      (is (str/includes? (ticket s "BOXP-2") "run 2"))
      (testing "次の tick の成功で異常は解消する"
        (run-result! s 4 {:status "no-change" :added [] :removed [] :new_categories []})
        (runs! s [2 "failure"] [3 "success"] [4 "success"])
        (tick s)
        (is (nil? (get-in (state s) [:ci :failure])))))))
(deftest live-failure-keeps-unresolved-diff
  (let [s (sandbox)
        base (read-json (str (:root s) "/live-baseline.json"))
        at (fn [h] (assoc (:env s) "INFRA_DIAGRAM_REFRESH_NOW" (str (.plusSeconds (java.time.Instant/parse "2026-11-05T01:00:00Z") (* h 3600)))))
        tick-at (fn [h] (run (at h) "bb" refresh "tick"))
        snap (str (:d s) "/audited.json")]
    (write-json (str (:d s) "/live.json") {:namespaces (conj (mapv #(str "ns" %) (range 60)) "added")})
    (fs/copy (str (:d s) "/live.json") snap)
    (tick-at 0)
    (let [id (get-in (state s) [:active :ticket])]
      (is (= "changed" (get-in (state s) [:live :result :status])))
      (spit (str (:d s) "/fail") "")
      (tick-at 21)
      (is (= 1 (get-in (state s) [:live :failures])))
      (testing "収集に失敗した後も、候補なしの accept は通らない"
        (is (not (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" id)))))
        (is (= id (get-in (state s) [:active :ticket])))
        (is (= "changed" (get-in (state s) [:live :result :status])))
        (is (= (:facts base) (:facts (read-json (str (:root s) "/live-baseline.json"))))))
      (testing "失敗の報告に検出済みの差分が残る"
        (tick-at 22) (tick-at 23)
        (is (str/includes? (ticket s id) "live:ns:added"))
        (is (str/includes? (ticket s id) "収集の異常")))
      (testing "監査した候補があれば受け入れられる"
        (is (zero? (:exit (run (:env s) "bb" refresh "live-candidate" "--ticket" id snap))))
        (is (zero? (:exit (run (:env s) "bb" refresh "accept" "--ticket" id))))
        (is (some #{"live:ns:added"} (:facts (read-json (str (:root s) "/live-baseline.json")))))))))
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
(deftest connection-only-changes
  (let [d (str (fs/create-temp-dir)) arch (str d "/arch") lol (str d "/lol") r (str d "/rules.edn")
        facts (str d "/facts.json") base (str d "/base.json") out (str d "/out.json") tool (str refresh-dir "/iac_facts.bb")
        manifest (str lol "/argoproj/a.yaml")
        svc (fn [selector] (str "apiVersion: v1\nkind: Service\nmetadata:\n  name: web\n  namespace: n\nspec:\n  selector:\n    app.kubernetes.io/name: " selector "\n  ports:\n    - port: 80\n"))
        ingress (fn [host svc-name port] (str "apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: web\n  namespace: n\nspec:\n  rules:\n    - host: " host "\n      http:\n        paths:\n          - path: /\n            backend:\n              service:\n                name: " svc-name "\n                port:\n                  " port "\n"))
        collect! (fn [path] (is (zero? (:exit (run {} "bb" tool "collect" "--arch" arch "--lolice" lol "--rules" r "--out" path)))))
        compared (fn [] (collect! facts)
                   (run {} "bb" tool "compare" "--facts" facts "--baseline" base "--rules" r "--out" out)
                   (read-json out))]
    (doseq [x [arch lol]] (fs/create-dirs x) (run {} "git" "init" "-q" x))
    (fs/create-dirs (str lol "/argoproj"))
    (spit r "{:exclude-fact-patterns [] :max-removed-ratio 1 :min-iac-facts 0}")
    (spit manifest (str (svc "one") "---\n" (ingress "a.b0xp.io" "web" "number: 80")))
    (run {} "git" "-C" lol "add" ".")
    (collect! base)
    (is (some #{"lolice:svc-selector:n/web:app.kubernetes.io/name=one"} (:facts (read-json base))) "key の接頭辞を落とさない")
    (is (some #{"lolice:ingress-backend:n/web:a.b0xp.io:/->web:80"} (:facts (read-json base))))
    (testing "同じ入力は無差分" (is (= "no-change" (:status (compared)))))
    (testing "Service の selector だけの変更を検出する"
      (spit manifest (str (svc "two") "---\n" (ingress "a.b0xp.io" "web" "number: 80")))
      (let [c (compared)]
        (is (= "changed" (:status c)))
        (is (= ["lolice:svc-selector:n/web:app.kubernetes.io/name=two"] (:added c)))))
    (testing "Ingress の backend の service だけの変更を検出する"
      (spit manifest (str (svc "one") "---\n" (ingress "a.b0xp.io" "other" "number: 80")))
      (let [c (compared)]
        (is (= "changed" (:status c)))
        (is (= ["lolice:ingress-backend:n/web:a.b0xp.io:/->other:80"] (:added c)))))
    (testing "Ingress の backend の port だけの変更を検出する"
      (spit manifest (str (svc "one") "---\n" (ingress "a.b0xp.io" "web" "name: http")))
      (let [c (compared)]
        (is (= "changed" (:status c)))
        (is (= ["lolice:ingress-backend:n/web:a.b0xp.io:/->web:http"] (:added c)))))))
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
