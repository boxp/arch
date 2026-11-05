#!/usr/bin/env bb
;; インフラ図の定期更新の受け口。agent を起動せず、差分か異常があるときだけ Task Board のチケットを 1 枚に集約する。
;; 公開 IaC の比較は boxp/arch の scheduled workflow、live metadata の比較はここで行う。live の値は vault の外へ出さない。
;; usage: refresh.bb tick | status | accept --ticket BOXP-N | live-candidate SNAPSHOT.json
(require '[babashka.fs :as fs]
         '[babashka.process :refer [shell process]]
         '[cheshire.core :as json]
         '[clojure.edn :as edn]
         '[clojure.string :as str])

(def here (str (fs/parent (fs/absolutize *file*))))
(load-file (str here "/iac_facts.bb"))

(def repo "boxp/arch")
(def workflow "schedule-infra-diagram-refresh.yml")
(def artifact "infra-diagram-refresh-result")
(defn env [k d] (or (System/getenv k) d))
(defn vault [] (env "CODEX_TASK_BOARD_VAULT" "/home/boxp/Documents/obsidian-headless/BOXP"))
(defn root [] (env "INFRA_DIAGRAM_REFRESH_ROOT" (str (fs/path (vault) "Infrastructure" "Infra Diagram Refresh"))))
(defn state-path [] (str (fs/path (root) "state.edn")))
(defn live-baseline-path [] (str (fs/path (root) "live-baseline.json")))
(defn live-candidate-path [] (str (fs/path (root) "live-candidate.json")))
(defn rules [] (edn/read-string (slurp (env "INFRA_DIAGRAM_REFRESH_RULES" (str here "/rules.edn")))))
(defn helper [] (env "TASK_BOARD_HELPER" (str (fs/path (System/getProperty "user.home") ".claude/skills/obsidian-task-board/bin/task-board.bb"))))
(defn assignee [] (env "INFRA_DIAGRAM_REFRESH_ASSIGNEE" "codex"))
(defn now [] (java.time.Instant/parse (env "INFRA_DIAGRAM_REFRESH_NOW" (str (java.time.Instant/now)))))
(defn hours-since [iso] (when iso (/ (.getSeconds (java.time.Duration/between (java.time.Instant/parse iso) (now))) 3600.0)))

(def live-interval-hours 20)
(def ci-stale-hours 36)
(def live-failures-before-report 3)
(def max-tickets-per-key 2)

(defn read-state []
  (if (fs/exists? (state-path)) (edn/read-string (slurp (state-path))) {:schema 1}))

(defn write-state!
  "途中で止まっても読みかけの state を残さないよう、別名で書いてから置き換える。"
  [s]
  (fs/create-dirs (root))
  (let [tmp (str (state-path) ".tmp")]
    (spit tmp (with-out-str (clojure.pprint/pprint s)))
    (fs/move tmp (state-path) {:replace-existing true :atomic-move true}))
  s)

(defn sh [& args]
  (let [r (apply shell {:out :string :err :string :continue true} args)]
    (when-not (zero? (:exit r))
      (throw (ex-info (str (first args) " failed") {:exit (:exit r) :stderr (:err r)})))
    (:out r)))

;; ── 差分の材料: CI の結果
(defn valid-run? [r]
  (and (= "main" (:headBranch r)) (#{"schedule" "workflow_dispatch"} (:event r)) (= "completed" (:status r))))

(defn latest-run []
  (->> (json/parse-string
        (sh "gh" "run" "list" "-R" repo "--workflow" workflow "--branch" "main" "--limit" "10"
            "--json" "databaseId,conclusion,status,event,headBranch,createdAt,headSha,url")
        true)
       (filter valid-run?)
       (sort-by :createdAt)
       last))

(def safe-fact-re #"[A-Za-z0-9._:/@+=\-]{1,300}")

(defn sanitize-ci-result
  "public repo の artifact は機械の出力でも入力として疑い、形の合う事実だけを渡す。"
  [r]
  (let [facts (fn [xs] (vec (filter #(and (string? %) (re-matches safe-fact-re %)) xs)))]
    {:status (when (#{"no-change" "changed" "anomaly"} (:status r)) (:status r))
     :simulated (true? (:simulated r))
     :reason (some-> (:reason r) str (subs 0 (min 200 (count (str (:reason r))))))
     :added (facts (:added r))
     :removed (facts (:removed r))
     :new_categories (facts (:new_categories r))
     :fingerprint (when (and (string? (:fingerprint r)) (re-matches #"[0-9a-f]{64}" (:fingerprint r))) (:fingerprint r))}))

(defn download-result [run-id]
  (let [dir (str (fs/create-temp-dir))]
    (try
      (sh "gh" "run" "download" (str run-id) "-R" repo "-n" artifact "-D" dir)
      (sanitize-ci-result (json/parse-string (slurp (str (fs/path dir "result.json"))) true))
      (catch Exception _ nil)
      (finally (fs/delete-tree dir)))))

(defn observe-ci
  "新しい run を一度だけ読み、state の :ci を進める。新しい run が無ければ何も変えない。"
  [s]
  (try
    (let [run (latest-run)]
      (cond
        (nil? run) (assoc-in s [:ci :api-error] nil)
        (= (:databaseId run) (get-in s [:ci :run-id])) (assoc-in s [:ci :api-error] nil)
        :else
        (let [res (download-result (:databaseId run))
              simulated (:simulated res)
              ok (and (= "success" (:conclusion run)) (#{"no-change" "changed"} (:status res)))
              base {:run-id (:databaseId run) :run-url (:url run) :run-at (:createdAt run) :head (:headSha run)
                    :conclusion (:conclusion run) :api-error nil}]
          (cond
            simulated
            (-> s
                (assoc-in [:ci :canary] (assoc base :status (:status res) :seen-at (str (now))))
                (assoc-in [:ci :run-id] (:databaseId run)))
            ok
            (update s :ci merge base {:new? true :result res :last-success-at (:createdAt run) :failure nil})
            :else
            (update s :ci merge base
                    {:new? true :result nil
                     :failure {:kind "ci" :detail (str "conclusion=" (:conclusion run) " status=" (:status res) " " (:reason res))
                               :key (str "ci:" (:conclusion run) ":" (:status res))}})))))
    (catch Exception e
      (assoc-in s [:ci :api-error] (str (ex-message e) " " (:stderr (ex-data e)))))))

(defn ci-stale-failure [s]
  (let [at (or (get-in s [:ci :last-success-at]) (get s :started-at))
        h (hours-since at)]
    (when (and h (> h ci-stale-hours))
      {:kind "ci-stale" :detail (str "最後に成功した run から " (long h) " 時間") :key "ci-stale"})))

;; ── 差分の材料: live metadata
(defn normalize-live
  "時刻、Pod の置き場、同期状態、IP、容量は図の構造ではないので落とす。replicas は動いているかどうかだけ残す。"
  [snap]
  (let [nsn #(str (:ns %) "/" (:name %))
        p (fn [prefix xs] (map #(str "live:" prefix ":" %) xs))]
    (->> (concat
          (p "app" (map :name (:applications snap)))
          (p "appset" (:applicationsets snap))
          (p "ns" (:namespaces snap))
          (p "wl" (map (fn [w] (str (:kind w) ":" (nsn w) ":" (if (= 0 (:replicas w)) "stopped" "running"))) (:workloads snap)))
          (p "svc" (map (fn [x] (str (nsn x) ":" (:type x))) (:services snap)))
          (p "node" (map (fn [n] (str (:name n) ":" (:arch n) ":" (if (:cp n) "cp" "worker") ":" (or (:gpuWorker n) "-"))) (:nodes snap)))
          (p "pvc" (map (fn [x] (str (nsn x) ":" (:sc x))) (:pvcs snap)))
          (p "es" (map (fn [x] (str (nsn x) ":" (:store x))) (:externalsecrets snap)))
          (p "mon" (map (fn [x] (str (:kind x) ":" (nsn x))) (:monitors snap)))
          (p "rj" (map (fn [x] (str (:name x) ":" (:task x))) (:recurringjobs snap)))
          (p "bt" (map (fn [x] (str (:name x) ":" (if (:available x) "available" "unavailable"))) (:backuptargets snap)))
          (p "backup" (map :pvc (filter #(some (fn [j] (re-find #"^c-" j)) (:jobs %)) (:longhorn_volumes snap))))
          (p "up" (map :k (get-in snap [:prometheus :up])))
          (p "tunnel" (map :k (get-in snap [:prometheus :tunnels]))))
         distinct sort vec)))

(defn collect-live! [out]
  (sh (env "INFRA_DIAGRAM_REFRESH_COLLECT_LIVE" (str here "/collect-live.sh")) out))

(defn observe-live
  "1 日 1 回だけ集める。比較に使った候補は candidate へ残し、基準は accept まで動かさない。"
  [s]
  (if (let [h (hours-since (get-in s [:live :attempted-at]))]
        (and h (< h live-interval-hours) (zero? (get-in s [:live :failures] 0))))
    s
    (let [tmp (str (fs/create-temp-file))]
      (try
        (collect-live! tmp)
        (let [r (rules)
              facts (normalize-live (json/parse-string (slurp tmp) true))
              baseline (when (fs/exists? (live-baseline-path)) (:facts (read-json (live-baseline-path))))]
          (if (nil? baseline)
            ;; 基準が無い最初の 1 回は差分と言えないので、基準を作るだけ。
            (do (write-json! (live-baseline-path) {:schema 1 :facts facts})
                (update s :live merge {:attempted-at (str (now)) :last-success-at (str (now)) :failures 0 :failure nil :new? false :result nil}))
            (let [res (compare-facts r (:min-live-facts r) facts baseline)]
              (if (= "anomaly" (:status res))
                (throw (ex-info "live anomaly" {:stderr (:reason res)}))
                (do
                  (when (= "changed" (:status res))
                    (write-json! (live-candidate-path) {:schema 1 :facts (vec (remove #(excluded? r %) facts))}))
                  (update s :live merge {:attempted-at (str (now)) :last-success-at (str (now)) :failures 0 :failure nil
                                         :new? true :result res}))))))
        (catch Exception e
          (let [n (inc (get-in s [:live :failures] 0))
                ;; 1 行目だけ残す。kubectl の全文は vault の state に要らない。
                detail (first (str/split-lines (str (ex-message e) " " (:stderr (ex-data e)))))]
            (update s :live merge
                    {:attempted-at (str (now)) :failures n :new? (>= n live-failures-before-report) :result nil
                     :failure (when (>= n live-failures-before-report)
                                {:kind "live" :detail (subs detail 0 (min 200 (count detail))) :key "live"})})))
        (finally (fs/delete-if-exists tmp))))))

;; ── 依頼の集約
(defn signals [s]
  (let [accepted (set (:accepted s))
        ci (get-in s [:ci :result])
        lv (get-in s [:live :result])
        ci-changed (when (and (= "changed" (:status ci)) (not (accepted (:fingerprint ci)))) ci)
        lv-changed (when (and (= "changed" (:status lv)) (not (accepted (:fingerprint lv)))) lv)
        failures (vec (keep identity [(get-in s [:ci :failure]) (get-in s [:live :failure]) (ci-stale-failure s)]))]
    {:iac ci-changed :live lv-changed :failures failures}))

(defn signal-key [{:keys [iac live failures]}]
  (sha256 (pr-str [(:fingerprint iac) (:fingerprint live) (vec (sort (map :key failures)))])))

(defn empty-signal? [{:keys [iac live failures]}]
  (and (nil? iac) (nil? live) (empty? failures)))

(defn fact-lines [{:keys [added removed new_categories]} limit]
  (let [lines (concat (map #(str "- 追加 `" % "`") added) (map #(str "- 削除 `" % "`") removed))]
    (str/join "\n"
              (concat (when (seq new_categories)
                        [(str "- **新しい分類**: " (str/join ", " (map #(str "`" % "`") new_categories)))])
                      (take limit lines)
                      (when (> (count lines) limit) [(str "- ほか " (- (count lines) limit) " 件(全件は state.edn と live-candidate.json)")])))))

(defn signal-body [s key {:keys [iac live failures]}]
  (str/join
   "\n\n"
   (remove
    nil?
    [(str "infra-diagram-refresh-key: " key)
     (when iac (str "### 公開 IaC の差分\n\n[workflow run](" (get-in s [:ci :run-url]) ")、head `" (get-in s [:ci :head]) "`\n\n" (fact-lines iac 60)))
     (when live (str "### live metadata の差分\n\n" (fact-lines live 60)))
     (when (seq failures)
       (str "### 収集の異常(前回の図を保持)\n\n"
            (str/join "\n" (map #(str "- " (:kind %) ": " (:detail %)) failures))))])))

(defn write-file-tmp [content]
  (let [f (str (fs/create-temp-file))] (spit f content) f))

(defn create-ticket! [s key sig]
  (let [plan (str "- [ ] `Infrastructure/Infra Diagram Refresh/README.md` の手順と規則を読み、下の差分の変更元を実読して意味を判断する\n"
                  "- [ ] 図へ反映する差分は staging で edn を直し、検査、実ブラウザ確認、配備、実 URL 確認まで行う\n"
                  "- [ ] 図に関係ないと判断した差分は、その理由を Notes に残して基準だけ進める\n"
                  "- [ ] `iac-baseline.json` の更新を通常 PR、CI、merge で反映し、`refresh.bb accept` で live の基準を進める")
        out (sh "bb" (helper) "create" "--vault" (vault)
                "--title" (str "インフラ図の定期更新: " (subs (str (now)) 0 10) " の差分を監査して反映する")
                "--lane" "Ready" "--assignee" (assignee) "--priority" "medium" "--repo" repo "--json"
                "--summary" "定期チェックが図の入力の差分または収集の異常を検出した。意味を監査し、根拠のある更新だけを両図とサムネイルへ反映する。"
                "--acceptance" (str "- [ ] 差分ごとに、図へ反映したか対象外かと、その根拠が Notes にある\n"
                                    "- [ ] 反映があれば両図とサムネイルが実 URL で新版になり、前回の図を失っていない\n"
                                    "- [ ] 基準が配備の確認後に進み、次の定期チェックが無差分で終わる\n"
                                    "- [ ] ooedo 除外と公開境界を維持している。全体図の匿名公開と portfolio 本番切替はしていない")
                "--context-file" (write-file-tmp (signal-body s key sig))
                "--plan" plan)]
    (:id (json/parse-string out true))))

(defn ticket-status [id]
  (let [f (fs/path (vault) "Tickets" (str id ".md"))]
    (when (fs/exists? f)
      (some-> (re-find #"(?m)^status:\s*(\S+)" (slurp (str f))) second))))

(defn find-ticket-by-key [key]
  (let [dir (fs/path (vault) "Tickets")]
    (when (fs/exists? dir)
      (some (fn [f] (when (str/includes? (slurp (str f)) (str "infra-diagram-refresh-key: " key))
                      (second (re-find #"(BOXP-\d+)\.md$" (str f)))))
            (fs/glob dir "BOXP-*.md")))))

(defn append-note! [id body]
  (sh "bb" (helper) "append-note" id "--vault" (vault) "--source" "infra-diagram-refresh" "--note-file" (write-file-tmp body)))

(defn dispatch-signal
  "稼働中のチケットがあれば差分をそこへ集約し、新しい run は作らない。止まって再開しても同じ key で二重に起票しない。"
  [s]
  (let [sig (signals s)
        key (signal-key sig)
        active (:active s)
        active-open? (and active (not (#{"done" nil} (ticket-status (:ticket active)))))]
    (cond
      (empty-signal? sig)
      (assoc s :last-result "no-change")

      (and active-open? (= key (:key active)))
      (assoc s :last-result "already-queued")

      active-open?
      (do (append-note! (:ticket active) (str "定期チェックの新しい差分を集約しました。\n\n" (signal-body s key sig)))
          (-> s (assoc-in [:active :key] key) (assoc :last-result "aggregated")))

      :else
      (if-let [existing (find-ticket-by-key key)]
        (if (#{"done"} (ticket-status existing))
          ;; 同じ差分のチケットが閉じたのに基準が進んでいない。上限まで再起票し、そこで止めて status で知らせる。
          (if (>= (get-in s [:filed key] 1) max-tickets-per-key)
            (assoc s :last-result "suppressed" :suppressed {:key key :ticket existing} :active nil)
            (let [s (update-in s [:filed key] (fnil inc 1))
                  _ (write-state! s)
                  id (create-ticket! s key sig)]
              (assoc s :active {:ticket id :key key} :last-result "filed")))
          (assoc s :active {:ticket existing :key key} :last-result "adopted"))
        (let [s (update-in s [:filed key] (fnil identity 1))
              id (create-ticket! s key sig)]
          (assoc s :active {:ticket id :key key} :last-result "filed"))))))

(defn with-lock [f]
  (fs/create-dirs (root))
  (let [lock (fs/path (root) "tick.lock")]
    (when (and (fs/exists? lock)
               (> (- (System/currentTimeMillis) (.toMillis (fs/last-modified-time lock))) (* 2 3600 1000)))
      (fs/delete-if-exists lock))
    (if (try (fs/create-file lock) true (catch java.nio.file.FileAlreadyExistsException _ false))
      (try (f) (finally (fs/delete-if-exists lock)))
      (println "another tick is running"))))

(defn tick! []
  (with-lock
    (fn []
      (let [s0 (read-state)
            s0 (cond-> s0 (nil? (:started-at s0)) (assoc :started-at (str (now))))
            before-run (get-in s0 [:ci :run-id])
            before-live (get-in s0 [:live :attempted-at])
            s1 (observe-live (observe-ci s0))
            fresh? (or (not= before-run (get-in s1 [:ci :run-id]))
                       (and (not= before-live (get-in s1 [:live :attempted-at])) (get-in s1 [:live :new?]))
                       (ci-stale-failure s1))
            s2 (if fresh?
                 (dispatch-signal s1)
                 (assoc s1 :last-result "no-new-input"))
            s3 (assoc s2 :last-tick-at (str (now)))]
        (write-state! s3)
        (println "tick:" (:last-result s3) (or (some-> (:active s3) :ticket) ""))))))

(defn accept!
  "配備を確認した agent だけが呼ぶ。稼働チケットの差分を受入済みにして live の基準を進める。IaC の基準は PR の merge で進む。"
  [ticket]
  (with-lock
    (fn []
      (let [s (read-state)]
        (when-not (= ticket (get-in s [:active :ticket]))
          (println "not the active ticket:" ticket (get-in s [:active :ticket]))
          (System/exit 1))
        (when (fs/exists? (live-candidate-path))
          (fs/move (live-candidate-path) (live-baseline-path) {:replace-existing true}))
        (let [fps (keep identity [(get-in s [:ci :result :fingerprint]) (get-in s [:live :result :fingerprint])])]
          (write-state! (-> s
                            (update :accepted #(vec (take-last 20 (concat % fps))))
                            (assoc-in [:live :result] nil)
                            (assoc-in [:ci :failure] nil)
                            (assoc-in [:live :failure] nil)
                            (assoc :active nil :last-accepted {:ticket ticket :at (str (now))})))
          (println "accepted" ticket))))))

(defn set-live-candidate!
  "図の生成に使った snapshot を候補にする。監査中に変わった分は次の比較で差分になる。"
  [snapshot]
  (let [r (rules)]
    (write-json! (live-candidate-path)
                 {:schema 1 :facts (vec (remove #(excluded? r %) (normalize-live (json/parse-string (slurp snapshot) true))))})))

(defn status! []
  (let [s (read-state)]
    (println (json/generate-string
              {:last_tick_at (:last-tick-at s)
               :last_result (:last-result s)
               :active (:active s)
               :suppressed (:suppressed s)
               :last_accepted (:last-accepted s)
               :ci (select-keys (:ci s) [:run-id :run-url :run-at :conclusion :last-success-at :api-error :failure :canary])
               :live (select-keys (:live s) [:attempted-at :last-success-at :failures :failure])}
              {:pretty true}))))

(when (= *file* (System/getProperty "babashka.file"))
  (let [[cmd a b] *command-line-args*]
    (case cmd
      "tick" (tick!)
      "status" (status!)
      "accept" (accept! (if (= a "--ticket") b (do (println "usage: accept --ticket BOXP-N") (System/exit 2))))
      "live-candidate" (set-live-candidate! a)
      (do (println "usage: refresh.bb tick|status|accept --ticket BOXP-N|live-candidate SNAPSHOT.json") (System/exit 2)))))
