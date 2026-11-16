#!/usr/bin/env bb
;; BOXP-395: render migration-ledger.md from the decisions and the applied results.
;; usage: render-ledger.bb DECISIONS RESULTS > migration-ledger.md
(require '[babashka.fs :as fs] '[clojure.edn :as edn] '[clojure.string :as str])
(let [[decisions-path results-path] *command-line-args*
      decisions (edn/read-string (slurp decisions-path))
      results (if (fs/exists? results-path) (edn/read-string (slurp results-path)) {})
      cell #(str/replace (str (or % "")) #"[|\n]" " ")]
  (println "# Task Board Review レーン移行 ledger\n")
  (println (str "- 対象: " (count decisions) " 票（重複なし " (count (distinct (map :id decisions))) "）"))
  (println (str "- 移行先の内訳: " (pr-str (frequencies (map :lane decisions)))))
  (println (str "- 判定の内訳: " (pr-str (frequencies (map :class decisions)))))
  (println (str "- 適用結果: " (pr-str (frequencies (map #(get-in results [(:id %) :outcome] :pending) decisions))) "\n"))
  (println "元のレーンはすべて Review。元の担当は票とカードの順に記載します。\n")
  (println "| 票 | 元担当（票/カード） | 新レーン | 新担当 | 判定 | 根拠 | 次action | 判断点 / 必要入力 / 解消責任者 / 必要な確認 | 終了種別 | 結果 | 読戻し |")
  (println "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |")
  (doseq [{:keys [id from-assignee card-assignee lane assignee class confidence evidence next-action decision needed-input resolver missing-check done-kind successor]} decisions
          :let [r (get results id)]]
    (println (str "| [[Tickets/" id "|" id "]] | " (cell from-assignee) "/" (cell card-assignee) " | " lane " | " assignee " | " class "/" confidence
                  " | " (cell evidence) " | " (cell next-action)
                  " | " (cell (str/join " / " (remove nil? [decision needed-input resolver missing-check])))
                  " | " (cell done-kind) (when successor (str "→" (cell successor)))
                  " | " (cell (some-> (:outcome r) name)) (when (:reason r) (str ":" (cell (:reason r))))
                  " | " (cell (when r (str (first (:read-back-lanes r)) " " (:read-back-status r) " " (:read-back-assignee r)))) " |"))))
