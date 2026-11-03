#!/usr/bin/env bb
;; 合成 metadata だけを使う (本文なし)。実行: bb tests/ai-observability/test_slo_snapshot.bb
(require '[babashka.fs :as fs] '[clojure.test :refer [deftest is run-tests testing]] '[cheshire.core :as json] '[babashka.process :as p] '[clojure.string :as str])
(def repo (fs/parent (fs/parent (fs/parent (fs/absolutize *file*)))))
(def tool (str (fs/path repo "scripts/ai-observability/slo_snapshot.bb")))
(load-file tool)

;; Owner が繰り返し是正した状況を、本文なしの状態だけで表した合成ケース
(def rescue-cases
  [["既承認 merge の放置に Owner が催促" {:contact? true :wait-reason "agent-continue" :seconds-since-stop 1140 :resumed? true} :rescue]
   ["カード担当と ticket 担当の不一致で起動せず Owner が指摘" {:contact? true :queue-mismatch? true :seconds-since-stop 23760} :rescue]
   ["Review へ戻ったまま担当戻しが漏れ Owner が状況質問" {:contact? true :wait-reason "agent-continue" :seconds-since-stop 1260 :resumed? true} :rescue]
   ["実行中の状況質問" {:contact? true :run-active? true :wait-reason "agent-continue" :seconds-since-stop 60 :resumed? false} :not-rescue]
   ["猶予内に監督が戻す前の接触" {:contact? true :wait-reason "agent-continue" :seconds-since-stop 300 :resumed? true} :not-rescue]
   ["接触したが再開していない" {:contact? true :wait-reason "agent-continue" :seconds-since-stop 7200 :resumed? false} :not-rescue]
   ["本人の実機受入待ち" {:contact? true :wait-reason "owner-acceptance" :seconds-since-stop 90000 :resumed? true} :not-rescue]
   ["Owner 判断待ちへの回答" {:contact? true :wait-reason "owner-decision" :seconds-since-stop 90000 :resumed? true} :not-rescue]
   ["新 scope の依頼" {:contact? true :wait-reason "new-scope" :seconds-since-stop 90000 :resumed? true} :not-rescue]
   ["外部 hold の解除連絡" {:contact? true :wait-reason "external-hold" :seconds-since-stop 90000 :resumed? true} :not-rescue]
   ["接触なしで自動継続" {:contact? false :wait-reason "agent-continue" :seconds-since-stop 60 :resumed? true} :not-rescue]
   ["停止理由が未記録" {:contact? true :seconds-since-stop 90000 :resumed? true} :unknown]
   ["語彙外の停止理由" {:contact? true :wait-reason "other" :seconds-since-stop 90000 :resumed? true} :unknown]
   ["停止時刻が不明" {:contact? true :wait-reason "agent-continue" :resumed? true} :unknown]])

(deftest rescue-definition
  (doseq [[name input expected] rescue-cases]
    (is (= expected (user/rescue-class input)) name)))

(defn write-fixture [dir]
  (let [runs (fs/path dir "root/runs") vault (fs/path dir "vault")
        run (fn [t id m]
              (let [d (fs/path runs t id)]
                (fs/create-dirs d)
                (spit (str (fs/path d "summary.edn"))
                      (pr-str (merge {:ticket t :run-id id :action "implement" :status "succeeded" :result "review"} m)))))]
    (fs/create-dirs (fs/path vault "Tickets"))
    (fs/create-dirs (fs/path vault "Boards"))
    ;; A: 再開済みで 48h 待ち、契機 note は再開の 30h 前
    (run "BOXP-1" "20261001T000000Z" {:started-at "2026-10-01T00:00:00Z" :finished-at "2026-10-01T01:00:00Z"})
    (run "BOXP-1" "20261003T010000Z" {:started-at "2026-10-03T01:00:00Z" :finished-at "2026-10-03T02:00:00Z" :result "done"})
    ;; B: 受入済みで閉じた停止 (停滞に数えない)
    (run "BOXP-2" "20261002T000000Z" {:started-at "2026-10-02T00:00:00Z" :finished-at "2026-10-02T01:00:00Z"})
    ;; C: Review に開いたままの停止
    (run "BOXP-3" "20261002T000000Z" {:started-at "2026-10-02T00:00:00Z" :finished-at "2026-10-02T01:00:00Z"})
    ;; D: 古い期間の停止 (--since で落ちる)
    (run "BOXP-4" "20260901T000000Z" {:started-at "2026-09-01T00:00:00Z" :finished-at "2026-09-01T01:00:00Z"})
    (doseq [[t a notes] [["BOXP-1" "boxp" ["- 2026-10-01 19:00:00 UTC [hermes-agent]: SECRETBODY1"]]
                         ["BOXP-2" "boxp" []]
                         ["BOXP-3" "boxp" ["- 2026-10-02 02:00:00 UTC [kohako-supervisor]: SECRETBODY2"]]
                         ["BOXP-4" "boxp" []]
                         ["BOXP-5" "boxp" []]
                         ["BOXP-6" "codex-sol" []]]]
      (spit (str (fs/path vault "Tickets" (str t ".md")))
            (str "---\nstatus: x\nassignee: " a "\n---\n# SECRETTITLE\n\n## Notes\n\n" (str/join "\n" notes) "\n")))
    (spit (str (fs/path vault "Boards" "Task Board.md"))
          (str/join "\n" ["## Ready"
                          "- [ ] [[Tickets/BOXP-5|SECRETTITLE]] #ticket status::ready assignee::claude-opus"
                          "- [ ] [[Tickets/BOXP-6|SECRETTITLE]] #ticket status::ready assignee::codex-sol"
                          "## Review"
                          "- [ ] [[Tickets/BOXP-1|SECRETTITLE]] #ticket assignee::boxp"
                          "- [ ] [[Tickets/BOXP-3|SECRETTITLE]] #ticket assignee::boxp"
                          "## Done"
                          "- [x] [[Tickets/BOXP-2|SECRETTITLE]] #ticket assignee::boxp"
                          "- [x] [[Tickets/BOXP-4|SECRETTITLE]] #ticket assignee::boxp"]))
    [(str (fs/path dir "root")) (str vault)]))

(defn run-tool [& args]
  (-> (apply p/shell {:out :string :err :string} "bb" tool args) :out))

(deftest snapshot-counts-and-privacy
  (fs/with-temp-dir [d {}]
    (let [[root vault] (write-fixture d)
          out (run-tool root vault "--since" "2026-10-01")
          j (json/parse-string out true)]
      (is (not (str/includes? out "SECRET")) "本文・タイトルを出さない")
      (is (not (str/includes? out "BOXP-")) "--ids なしでは ticket ID を出さない")
      (is (= {:total 3 :closed_by_acceptance 1 :followed 1 :followed_over_24h 1 :open 1 :open_over_24h 1
              :open_over_24h_by_lane {:Review 1} :unknown_lane 0 :unknown_resume 0}
             (:review_stops j)))
      (is (= {:numerator 2 :denominator 2} (get-in j [:stall_reference :with_open_as_stalled])))
      (is (= {:numerator 1 :denominator 1} (get-in j [:stall_reference :followed_only])))
      (is (= {:followed_over_1h 1 :followed_over_24h 1 :open_over_1h 1 :open_over_24h 1 :unevaluated_stops 0} (:instructed_not_started j)))
      (is (true? (get-in j [:coverage :complete])) "欠けた入力がなければ complete")
      (is (= 1 (get-in j [:resume_last_contact :owner-relay])))
      (is (= "unknown" (get-in j [:owner_rescue :status])) "未接続を 0 にしない")
      (is (= {:reached 3 :censored 0} (select-keys (:first_run_to_review j) [:reached :censored])))
      (is (= 1.0 (get-in j [:first_run_to_review :p50_h])))
      (is (= {:cards 2 :card_ticket_assignee_mismatch 1} (:ready_queue j)))
      (is (= ["BOXP-5"] (get-in (json/parse-string (run-tool root vault "--ids") true) [:ready_queue :mismatch_ids]))))))

(defn write-coverage-fixture
  "読めない summary と読めない ticket を含む合成データ。"
  [dir]
  (let [runs (fs/path dir "root/runs") vault (fs/path dir "vault")
        run (fn [t id body]
              (let [d (fs/path runs t id)]
                (fs/create-dirs d)
                (when body (spit (str (fs/path d "summary.edn")) body))))
        ok (fn [t id m] (pr-str (merge {:ticket t :run-id id :action "implement" :status "succeeded" :result "review"} m)))]
    (fs/create-dirs (fs/path vault "Tickets"))
    (fs/create-dirs (fs/path vault "Boards"))
    ;; BOXP-7: 読める停止のあとに壊れた summary の run。停止は再開済みとして残る
    (run "BOXP-7" "20261001T000000Z" (ok "BOXP-7" "20261001T000000Z" {:started-at "2026-10-01T00:00:00Z" :finished-at "2026-10-01T01:00:00Z"}))
    (run "BOXP-7" "20261003T010000Z" "{:broken")
    ;; BOXP-8: 先頭 run が読めない。最初の Review は特定できない
    (run "BOXP-8" "20261001T000000Z" nil)
    (run "BOXP-8" "20261002T000000Z" (ok "BOXP-8" "20261002T000000Z" {:started-at "2026-10-02T00:00:00Z" :finished-at "2026-10-02T01:00:00Z"}))
    ;; BOXP-9: ticket が無く Notes を読めない。再開済みの停止と開いた停止
    (run "BOXP-9" "20261001T000000Z" (ok "BOXP-9" "20261001T000000Z" {:started-at "2026-10-01T00:00:00Z" :finished-at "2026-10-01T01:00:00Z"}))
    (run "BOXP-9" "20261003T010000Z" (ok "BOXP-9" "20261003T010000Z" {:started-at "2026-10-03T01:00:00Z" :finished-at "2026-10-03T02:00:00Z"}))
    ;; BOXP-10: run ID から時刻を出せない読めない run が続き、再開時刻が不明
    (run "BOXP-10" "20261001T000000Z" (ok "BOXP-10" "20261001T000000Z" {:started-at "2026-10-01T00:00:00Z" :finished-at "2026-10-01T01:00:00Z"}))
    (run "BOXP-10" "zz-no-time" nil)
    (doseq [t ["BOXP-7" "BOXP-8" "BOXP-10"]]
      (spit (str (fs/path vault "Tickets" (str t ".md"))) "---\nassignee: boxp\n---\n## Notes\n"))
    (spit (str (fs/path vault "Boards" "Task Board.md"))
          (str/join "\n" ["## Review"
                          "- [ ] [[Tickets/BOXP-7|T]] #ticket assignee::boxp"
                          "- [ ] [[Tickets/BOXP-8|T]] #ticket assignee::boxp"
                          "- [ ] [[Tickets/BOXP-9|T]] #ticket assignee::boxp"
                          "- [ ] [[Tickets/BOXP-10|T]] #ticket assignee::boxp"]))
    [(str (fs/path dir "root")) (str vault)]))

(deftest unreadable-inputs-stay-visible
  (fs/with-temp-dir [d {}]
    (let [[root vault] (write-coverage-fixture d)
          j (json/parse-string (run-tool root vault) true)]
      (testing "読めない run があっても、読める run の停止は残す"
        ;; BOXP-7 再開済み / BOXP-8 開いた停止 / BOXP-9 再開済みと開いた停止 / BOXP-10 再開時刻不明
        (is (= {:total 5 :followed 2 :open 2 :unknown_resume 1}
               (select-keys (:review_stops j) [:total :followed :open :unknown_resume]))))
      (testing "欠けた入力を件数で出す"
        (is (= {:complete false :unreadable_runs 3 :tasks_with_unreadable_runs 3
                :stops_with_unknown_contacts 3 :stops_with_unknown_resume 1}
               (:coverage j))))
      (testing "ticket が読めない停止を接触なしに数えない"
        ;; followed 2 件のうち BOXP-9 は unknown。BOXP-7 だけが接触なしと確認できる
        (is (= {:none-observed 1 :unknown-unreadable 1}
               (select-keys (:resume_last_contact j) [:none-observed :unknown-unreadable])))
        (is (= 2 (get-in j [:instructed_not_started :unevaluated_stops]))))
      (testing "最初の Review を特定できない task は分位にも打切りにも入れない"
        ;; BOXP-7/9/10 は先頭 run が読める。BOXP-8 だけ未評価
        (is (= {:reached 3 :censored 0 :unevaluated 1}
               (select-keys (:first_run_to_review j) [:reached :censored :unevaluated])))))))

(deftest unreadable-run-before-window
  (fs/with-temp-dir [d {}]
    (let [runs (fs/path d "root/runs") vault (fs/path d "vault")
          run (fn [t id body]
                (let [dir (fs/path runs t id)]
                  (fs/create-dirs dir)
                  (when body (spit (str (fs/path dir "summary.edn")) body))))
          ok (fn [t id at]
               (pr-str {:ticket t :run-id id :action "implement" :status "succeeded" :result "review"
                        :started-at at :finished-at at}))
          snap (fn [] (json/parse-string (run-tool (str (fs/path d "root")) (str vault) "--since" "2026-10-01") true))]
      (fs/create-dirs (fs/path vault "Tickets"))
      (fs/create-dirs (fs/path vault "Boards"))
      (spit (str (fs/path vault "Boards" "Task Board.md")) "## Review\n")
      (testing "次の run が窓より前に始まっていれば、窓の外と確定できる"
        (run "BOXP-11" "20260901T000000Z" nil)
        (run "BOXP-11" "20260902T000000Z" (ok "BOXP-11" "20260902T000000Z" "2026-09-02T00:00:00Z"))
        (is (= {:complete true :unreadable_runs 0 :tasks_with_unreadable_runs 0}
               (select-keys (:coverage (snap)) [:complete :unreadable_runs :tasks_with_unreadable_runs]))))
      (testing "窓より前に始まり次の run が無い run は、窓の中で終わった可能性を残す"
        (run "BOXP-12" "20260901T000000Z" nil)
        (is (= {:complete false :unreadable_runs 1 :tasks_with_unreadable_runs 1}
               (select-keys (:coverage (snap)) [:complete :unreadable_runs :tasks_with_unreadable_runs]))))
      (testing "窓より前に始まり次の run が窓の中で始まる run も同じ"
        (run "BOXP-13" "20260901T000000Z" nil)
        (run "BOXP-13" "20261002T000000Z" (ok "BOXP-13" "20261002T000000Z" "2026-10-02T00:00:00Z"))
        (is (= {:complete false :unreadable_runs 2 :tasks_with_unreadable_runs 2}
               (select-keys (:coverage (snap)) [:complete :unreadable_runs :tasks_with_unreadable_runs]))))
      (testing "次の run の開始時刻が分からない run も窓の外と確定しない"
        (run "BOXP-14" "20260901T000000Z" nil)
        (run "BOXP-14" "zz-no-time" "{:broken")
        ;; zz-no-time 自身も次の run が無いので数える
        (is (= {:complete false :unreadable_runs 4 :tasks_with_unreadable_runs 3}
               (select-keys (:coverage (snap)) [:complete :unreadable_runs :tasks_with_unreadable_runs])))))))

(let [{:keys [fail error]} (run-tests)] (System/exit (if (pos? (+ fail error)) 1 0)))
