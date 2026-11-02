#!/usr/bin/env bb

;; Multi-document corpus fixture for the BOXP-277 "many notes -> update another
;; note" evaluation (the owner's main use case). Builds on fixture.bb and adds:
;;
;;   pilot/overview.md                      the note to update (write target)
;;   refs/corpus/index.md                   hub note linking the current sources
;;   refs/corpus/design/*.md                superseded v1 and current v2 design
;;   refs/corpus/decisions/ADR-*.md         accepted / rejected / pending decisions
;;   refs/corpus/progress/*.md              weekly progress (older and newer facts)
;;   refs/corpus/meetings/*.md              meeting notes (future plans, not facts)
;;   refs/corpus/unrelated/sample-streamer  a similarly named, unrelated project
;;   refs/corpus/unrelated/proj-NN/*.md     padding notes (scale M / L) with
;;                                          overlapping vocabulary
;;
;; Usage: bb corpus_fixture.bb <dir> [--scale S|M|L] [--variant base|contradiction|missing]
;;
;; Ground truth for "## 現状" of overview.md (variant base):
;;   version v1.4 (progress/2026-10-17), port 8081 (design-v2, progress/2026-10-03),
;;   3 replicas (ADR-001 accepted), log retention 30 days (ADR-003 accepted),
;;   Envoy stays (ADR-002 rejected -> Nginx must not be adopted),
;;   TLS renewal 60 days (ADR-004 is only under discussion -> 30 days must not be adopted).
;;   Must not be taken from: design-v1 (superseded), sample-streamer (other project),
;;   meetings (v1.5 is a plan, not the running version), progress/2026-09-26 (v1.3 is old).

(require '[babashka.fs :as fs] '[babashka.process :as p] '[clojure.string :as str])

(def args (vec *command-line-args*))
(def target (or (first args) (do (println "usage: corpus_fixture.bb <dir> [--scale S|M|L] [--variant base|contradiction|missing]") (System/exit 2))))
(defn arg [flag default] (let [i (.indexOf args flag)] (if (>= i 0) (nth args (inc i)) default)))
(def scale (arg "--scale" "S"))
(def variant (arg "--variant" "base"))

(def here (str (fs/parent (fs/canonicalize *file*))))
(let [r @(p/process ["bb" (str (fs/path here "fixture.bb")) target] {:out :string :err :string})]
  (when-not (zero? (:exit r)) (throw (ex-info (str "fixture.bb failed: " (:err r)) {}))))

(defn write! [rel content]
  (let [p (fs/path target rel)]
    (fs/create-dirs (fs/parent p))
    (spit (str p) content)))

(def pilot "Projects/task-board-localllm-docs/pilot")
(def corpus "Projects/task-board-localllm-docs/refs/corpus")

(write! (str pilot "/overview.md")
        (str "---\ntitle: sample-stream 概要\nstatus: active\nupdated: 2026-09-01\n---\n\n"
             "# sample-stream 概要\n\n"
             "## 概要\n\n"
             "`sample-stream` は検証用の配信サーバです。設計・決定・進捗の資料は [[Projects/task-board-localllm-docs/refs/corpus/index|資料 index]] からたどれます。\n\n"
             "## 現状\n\n"
             "- 稼働バージョンは v1.2 で、待受ポートは 8080 です。\n"
             "- replica 数は 2 です。\n"
             "- ログは Loki に 14 日保持し、TLS 証明書は cert-manager が 60 日ごとに更新します。\n"
             "- Ingress は Envoy 経由です。\n\n"
             "## 決定事項\n\n"
             "- （未整理）\n\n"
             "## 次の予定\n\n"
             "- 未定。\n\n"
             "## 関連\n\n"
             "- [[Projects/task-board-localllm-docs/pilot/runbook|runbook]]\n"
             "- [[Projects/task-board-localllm-docs/refs/corpus/index|資料 index]]\n"))

(write! (str corpus "/index.md")
        (str "---\ntitle: sample-stream 資料 index\n---\n\n# sample-stream 資料 index\n\n"
             "## 設計\n\n- [[Projects/task-board-localllm-docs/refs/corpus/design/design-v2|設計メモ v2（現行）]]\n- [[Projects/task-board-localllm-docs/refs/corpus/design/design-v1|設計メモ v1（旧版）]]\n\n"
             "## 決定記録\n\n- [[Projects/task-board-localllm-docs/refs/corpus/decisions/ADR-001-replica-3|ADR-001]]\n- [[Projects/task-board-localllm-docs/refs/corpus/decisions/ADR-002-nginx|ADR-002]]\n- [[Projects/task-board-localllm-docs/refs/corpus/decisions/ADR-003-log-retention-30d|ADR-003]]\n- [[Projects/task-board-localllm-docs/refs/corpus/decisions/ADR-004-tls-30d|ADR-004]]\n\n"
             "## 進捗\n\n- 週次の進捗は `progress/` 配下。最新は [[Projects/task-board-localllm-docs/refs/corpus/progress/2026-10-17|2026-10-17]]。\n\n"
             "## 会議\n\n- [[Projects/task-board-localllm-docs/refs/corpus/meetings/2026-10-20|2026-10-20 定例]]\n"))

(write! (str corpus "/design/design-v1.md")
        (str "---\ntitle: sample-stream 設計メモ v1（旧版）\nstatus: superseded\nsuperseded-by: design-v2\ndate: 2026-06-01\n---\n\n"
             "# sample-stream 設計メモ v1（旧版）\n\n> この版は [[Projects/task-board-localllm-docs/refs/corpus/design/design-v2|設計メモ v2]] に置き換えられました。現状の記述には使わないこと。\n\n"
             "## 構成\n\n- `sample-stream` は 2 replica で動かす。\n- 待受ポートは 8080。\n- ヘルスチェックは `GET /health` を 30 秒間隔。\n- 初期リリースは v1.0。\n\n"
             "## ログ\n\n- ログは Loki に 14 日保持する。\n"))

(write! (str corpus "/design/design-v2.md")
        (str "---\ntitle: sample-stream 設計メモ v2（現行）\nstatus: current\ndate: 2026-09-10\n---\n\n"
             "# sample-stream 設計メモ v2（現行）\n\n"
             "## 構成\n\n- 待受ポートは 8081（v1 の 8080 から変更。移行は 2026-10-03 完了、[[Projects/task-board-localllm-docs/refs/corpus/progress/2026-10-03|進捗 2026-10-03]]）。\n- ヘルスチェックは `GET /health` を 30 秒間隔。\n- 保存先は PVC `sample-stream-data`（20 GiB）。\n- Ingress は Envoy 経由。idle timeout は 300 秒。\n\n"
             "## replica\n\n- replica 数は [[Projects/task-board-localllm-docs/refs/corpus/decisions/ADR-001-replica-3|ADR-001]] に従う。\n\n"
             "## 証明書\n\n- TLS 証明書は cert-manager が 60 日ごとに更新する。短縮の提案は [[Projects/task-board-localllm-docs/refs/corpus/decisions/ADR-004-tls-30d|ADR-004]] で検討中。\n"))

(write! (str corpus "/decisions/ADR-000-template.md")
        "---\ntitle: ADR テンプレート\nstatus: template\n---\n\n# ADR-000: テンプレート\n\n## 状況\n\n（記入）\n\n## 決定\n\n（記入）\n\n## 結果\n\n（記入）\n")

(write! (str corpus "/decisions/ADR-001-replica-3.md")
        (str "---\ntitle: ADR-001 replica を 3 にする\nstatus: 採用\ndate: 2026-09-05\n---\n\n# ADR-001: replica を 3 にする\n\n"
             "## 状況\n\n配信のピーク時に 2 replica では CPU が飽和した。\n\n## 決定\n\n`sample-stream` の replica 数を 2 から 3 に変更する（採用）。\n\n## 結果\n\n2026-10-10 に反映済み（[[Projects/task-board-localllm-docs/refs/corpus/progress/2026-10-10|進捗 2026-10-10]]）。\n"))

(write! (str corpus "/decisions/ADR-002-nginx.md")
        (str "---\ntitle: ADR-002 Ingress を Nginx に移行する\nstatus: 却下\ndate: 2026-10-01\n---\n\n# ADR-002: Ingress を Nginx に移行する\n\n"
             "## 状況\n\nEnvoy の設定が複雑という意見があった。\n\n## 決定\n\n**却下**。Nginx への移行は行わず、Ingress は Envoy のまま運用する。日付が新しいが採用されていない決定なので、現状には反映しないこと。\n\n## 結果\n\n変更なし。\n"))

(write! (str corpus "/decisions/ADR-003-log-retention-30d.md")
        (str "---\ntitle: ADR-003 ログ保持を 30 日にする\nstatus: 採用\ndate: 2026-09-20\n---\n\n# ADR-003: ログ保持を 30 日にする\n\n"
             "## 状況\n\n障害分析に 14 日では足りないことがあった。\n\n## 決定\n\nLoki のログ保持を 14 日から 30 日に延長する（採用）。\n\n## 結果\n\n2026-10-17 の週に反映済み（[[Projects/task-board-localllm-docs/refs/corpus/progress/2026-10-17|進捗 2026-10-17]]）。\n"))

(write! (str corpus "/decisions/ADR-004-tls-30d.md")
        (str "---\ntitle: ADR-004 TLS 証明書の更新間隔を 30 日にする\nstatus: 検討中\ndate: 2026-10-15\n---\n\n# ADR-004: TLS 証明書の更新間隔を 30 日にする\n\n"
             "## 状況\n\n証明書の更新間隔を 60 日から 30 日に短縮する案。\n\n## 決定\n\n**検討中**（未決定）。決まるまで現状は 60 日のまま。\n\n## 結果\n\nなし。\n"))

(write! (str corpus "/progress/2026-09-26.md")
        (str "---\ntitle: 進捗 2026-09-26\n---\n\n# 進捗 2026-09-26\n\n## 今週\n\n- 2026-09-25 に `sample-stream` を v1.3 へ更新した。\n- ポート移行（8080 → 8081）の準備を始めた。\n\n## 来週\n\n- ポート移行の切替。\n"))

(write! (str corpus "/progress/2026-10-03.md")
        (str "---\ntitle: 進捗 2026-10-03\n---\n\n# 進捗 2026-10-03\n\n## 今週\n\n- `sample-stream` の待受ポートを 8080 から 8081 へ切り替えた（完了）。\n- 監視ダッシュボードのポート表記を更新した。\n\n## 来週\n\n- replica 3 への変更（ADR-001）。\n"))

(write! (str corpus "/progress/2026-10-10.md")
        (str "---\ntitle: 進捗 2026-10-10\n---\n\n# 進捗 2026-10-10\n\n## 今週\n\n- ADR-001 に従い `sample-stream` の replica 数を 3 にした（反映済み）。\n- ピーク時の CPU 使用率は 60% 前後に収まった。\n\n## 来週\n\n- v1.4 のリリース準備。\n"))

(write! (str corpus "/progress/2026-10-17.md")
        (str "---\ntitle: 進捗 2026-10-17\n---\n\n# 進捗 2026-10-17\n\n## 今週\n\n- 2026-10-14 に `sample-stream` を v1.4 へ更新した（現在の稼働バージョン）。\n- ADR-003 に従い Loki のログ保持を 30 日に変更した（反映済み）。\n\n## 来週\n\n- 定例で ADR-004 を議論する。\n"))

(write! (str corpus "/meetings/2026-10-20.md")
        (str "---\ntitle: 2026-10-20 定例\n---\n\n# 2026-10-20 定例\n\n## 議題\n\n- ADR-004（TLS 30 日）は引き続き検討中。結論は次回。\n- v1.5 を来週リリースする予定（まだ稼働していない）。\n- 無関係だが、隣のプロジェクト `sample-streamer` は v2.1 になった。\n\n## 決定\n\n- なし。\n"))

(write! (str corpus "/unrelated/sample-streamer/overview.md")
        (str "---\ntitle: sample-streamer 概要（別プロジェクト）\n---\n\n# sample-streamer 概要\n\n`sample-streamer` は `sample-stream` とは別の、画面収録ツールのプロジェクトです。\n\n## 現状\n\n- 稼働バージョンは v2.0、待受ポートは 9090。\n- replica 数は 5。\n- Ingress は Nginx 経由。\n"))

(write! (str corpus "/unrelated/sample-streamer/progress-2026-10-18.md")
        (str "---\ntitle: sample-streamer 進捗 2026-10-18\n---\n\n# sample-streamer 進捗 2026-10-18\n\n- `sample-streamer` を v2.1 へ更新した。\n- ログ保持は 7 日。\n"))

(when (= variant "contradiction")
  (write! (str corpus "/decisions/ADR-005-port-8082.md")
          (str "---\ntitle: ADR-005 待受ポートを 8082 にする\nstatus: 採用\ndate: 2026-10-18\n---\n\n# ADR-005: 待受ポートを 8082 にする\n\n## 決定\n\n`sample-stream` の待受ポートを 8081 から 8082 に変更する（採用）。\n\n## 結果\n\n反映日は未記載。\n"))
  (write! (str corpus "/progress/2026-10-19.md")
          (str "---\ntitle: 進捗 2026-10-19\n---\n\n# 進捗 2026-10-19\n\n## 今週\n\n- `sample-stream` の待受ポートは 8081 のまま運用している。ポート変更の予定は現時点で無い。\n")))

(def scales {"S" 0 "M" 40 "L" 160})
(def topics ["画像処理バッチ" "社内 Wiki" "在庫 API" "通知基盤" "ログ収集" "認証ゲートウェイ" "データ同期" "検証環境"])
(doseq [n (range (get scales scale 0))]
  (let [proj (format "proj-%02d" n)
        topic (nth topics (mod n (count topics)))]
    (write! (str corpus "/unrelated/" proj "/note-" (mod n 7) ".md")
            (str "---\ntitle: " proj " " topic " メモ\n---\n\n# " proj " " topic " メモ\n\n"
                 "## 現状\n\n- `" proj "` の稼働バージョンは v3." (mod n 9) " で、待受ポートは 7" (format "%03d" n) " です。\n- replica 数は " (inc (mod n 4)) "。ログ保持は " (* 7 (inc (mod n 5))) " 日。\n\n"
                 "## 手順\n\n" (apply str (for [k (range 1 5)] (str "手順 " k ": " topic " の " proj " に関する作業を記録します。この文章は fixture の padding で、sample-stream には関係ありません。設定値は `" proj "-value-" k "` です。\n")))
                 "\n## メモ\n\n- Envoy や Nginx の語が混ざることがありますが別プロジェクトの話です。\n"))))

(println (str "corpus fixture written to " target " (scale " scale ", variant " variant ", padding " (get scales scale 0) ")"))
