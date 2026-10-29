# BOXP-360 既存観測基盤と Hermes 配備版の live 棚卸し

調査時点: 2026-10-29 UTC。コンテキスト `in-cluster`、実行主体 `system:serviceaccount:codex-workspace:codex-workspace`。読み取りのみ。秘密値、ヘッダー値、会話・プロンプト本文は掲載しない。unknown は未確認であり、存在しないことを意味しない。HTTP のポートフォワードは権限不足で確立せず、試行したプロセスは終了済み。

## 1. monitoring と cluster

| 項目 | 確認コマンド | 結果 |
|---|---|---|
| Prometheus | `kubectl -n monitoring get prometheus k8s -o json` | CR名 `k8s`、StatefulSet `prometheus-k8s`。retention 31d、retentionSize 未指定、Longhorn PVC 60Gi。requests CPU 500m / memory 2Gi、limits memory 4Gi、CPU 未指定。OTLP write receiver feature 有効。 |
| PVC 使用量 | `kubectl -n monitoring get pvc -o wide`; `kubectl -n monitoring exec prometheus-k8s-0 -c prometheus -- df -h /prometheus` | 使用量 unknown。monitoring の pods/exec が Forbidden。 |
| scrape 対象数 | `kubectl -n monitoring port-forward svc/prometheus-k8s 19090:9090`、`GET /api/v1/targets` | unknown。pods/portforward が Forbidden、HTTP API 未到達。 |
| PrometheusRule | `kubectl -n monitoring get prometheusrule --no-headers` | 11 リソース。ルール項目数ではない。 |
| Alertmanager | `kubectl -n monitoring get secret -o json`; `rg 'receiver\|_configs:' lolice/argoproj/prometheus-operator` | 通知先種別は unknown。Secret 一覧が Forbidden、設定本体は ExternalSecret 管理。宣言コメントにメール通知の記載はあるが live の通知先は確認できない。Secret 名 `alertmanager-main-config`、キー名 unknown。 |
| Loki | `kubectl -n monitoring get cm loki -o json`; `kubectl -n monitoring get pvc -o wide` | 3.4.2、TSDB + filesystem、Longhorn 100Gi。retention 168h、旧サンプル拒否 168h、最大 query 長 721h、query timeout 300s、split 15m、cache freshness 10m、volume 有効。設定外の limits は既定値未確認。PVC 使用量・実際に残っている期間は unknown（pods/exec Forbidden）。 |
| Alloy | `kubectl -n monitoring get cm alloy-config -o json`; `kubectl -n monitoring get daemonset grafana-alloy` | 7/7。Kubernetes pod discovery、各ノードの pod/container ファイルログを relabel・file_match・loki.source.file 経由で Loki に送信。設定中 `otelcol.receiver` なし。Prometheus 自身の OTLP 受信有効とは別。 |
| Grafana | `kubectl -n monitoring get deploy grafana -o json`; `rg -n 'anonymous\|auth\|cloudflare'` 関連宣言 | 13.2.2、ClusterIP と LoadBalancer。cloudflared Deployment が存在し、arch に Grafana API の Cloudflare tunnel と Access service-token 認証宣言あり。Grafana の実効認証方式・匿名可否・一般 UI の経路は unknown（実効 Secret と HTTP 未確認）。 |
| 関連製品 | `kubectl get deploy,statefulset,daemonset,svc -A -o wide` を名前・イメージで検索 | Tempo、Jaeger、独立 OTel collector、Langfuse、ClickHouse、Postgres に一致する workload/service は見当たらない。名前・イメージ検索の範囲であり、他の種類や別名での存在は unknown。Alloy は存在。 |
| ノード資源 | `kubectl top nodes` | unknown。nodes.metrics.k8s.io の list が Forbidden。 |

## 2. 宣言の所在

確認コマンド: `rg --files <arch> <lolice> | rg -i '(prometheus|grafana|loki|alloy|hermes-agent|codex-workspace)'` および `rg -l`。

- lolice: `/home/boxp/ghq/github.com/boxp/lolice/argoproj/prometheus-operator/`（`application.yaml`、`overlays/prometheus.yaml`、`overlays/grafana*.yaml`、`overlays/alertmanager.yaml`、`cloudflared-deployment.yaml`、rules）、`argoproj/loki/application.yaml` と `helm/values.yaml`、`argoproj/grafana-alloy/application.yaml` と `configmap.yaml`。
- lolice: `argoproj/hermes-agent/argocd-application.yaml`・`deployment.yaml`・`configmap.yaml`、`argoproj/codex-workspace/`、`argoproj/argocd-image-updater/imageupdaters/{hermes-agent,codex-workspace}.yaml`。
- arch: `docker/hermes-agent/Dockerfile`、`docker/codex-workspace/Dockerfile` と `task-board/task_board_runner.bb`、`terraform/cloudflare/b0xp.io/{grafana,prometheus-operator,hermes-agent,codex-workspace}/`。これらは調査対象 checkout 内の相対パス。宣言と live の一致は個別に保証しない。

## 3. Hermes 配備版

確認コマンド: `kubectl -n hermes-agent get deploy,pods -o wide`; `kubectl -n hermes-agent exec deploy/hermes-agent -c hermes-agent -- sh -c 'grep ... /opt/hermes/...; grep ... /opt/data/config.yaml'`。grep はファイル名・該当コードのみを選び、node_modules を除外。

- image `ghcr.io/boxp/arch/hermes-agent:sha-88638ef`、pod 3/3。配備ソース `/opt/hermes` の `hermes_agent-0.0.0.dist-info/METADATA` は Name `hermes-agent`、Version `0.0.0`。この値は上流の詳細リリース番号を特定しない。
- observer 実装: `/opt/hermes/agent/plugin_stream_hooks.py` に callback ごとのキュー、登録 hook の dispatch がある。`/opt/hermes/hermes_cli/lifecycle.py` に first-party observer および plugin への lifecycle dispatch がある。`/opt/hermes/agent/chat_completion_helpers.py` 等に `on_tool_start` の参照あり。文字列存在だけで全経路の有効性を保証しない。
- Langfuse: `/opt/hermes/hermes_cli/plugins_discovery.py` に `observability/langfuse` が core から移動し catalog plugin を選択する旨の参照、他に設定・移行等の参照がある。`/opt/hermes/plugins` の一覧と `/opt/data/plugins/*langfuse*` 検索では該当 plugin を確認できず、実装本体の存在・有効性は unknown。限定した探索である。
- `/opt/data/config.yaml` に `plugins:`、その子 `enabled:` のキーあり。トップレベル `hooks:` は確認できず。値は表示していないため、どの plugin が有効かは unknown。

### pod 内の公式資料調査

確認コマンド: `kubectl -n hermes-agent exec deploy/hermes-agent -c hermes-agent -- grep '^## ' /opt/data/reports/ai-practices-research/AI運用見直し_公式資料調査.md` と第6節の read-only 閲覧。

見出し: 結論、1. 調査範囲と出典の扱い、2. 公式資料が実際に勧めること、3. 現在の運用に対する診断（わたしの判断）、4. 具体的な新しい使い分け案、5. 依頼の書き方は短くする、6. 最初に評価する実失敗ケース、7. 試行案と判断指標、8. 今、決めるとよいこと、Sources。

失敗例の要約: 同期や run 交差による担当・所有権の不整合、指定モデルや訂正済み制約の取り違え、承認の重複、複数入口での二重処理、画像と正本の不一致や意図しない削除、未確認の実機成功・外部情報の捏造、生成の重複、依頼範囲外の設定変更が回帰評価候補。機械判定と人による意味・目視評価を分け、記録は必要な metadata を中心とする提案。

## 4. Task Board runner / dashboard

確認コマンド: `rg -n 'events|outbox|state\.edn|runs/|metadata|metrics' /opt/codex-workspace/task-board/task_board_events.bb /opt/codex-workspace/task-board/task_board_runner.bb`、関連関数の `sed`、`bb` で `state.edn` のトップレベルキーのみ抽出。

- 既定 root `/home/boxp/.codex-task-board`。runs は `runs/<ticket-id>/<run-id>/`、workspaces は `workspaces/<ticket-id>/<run-id>/`。run の `summary.edn` は `ticket`, `run-id`, `status`, `updated-at`、条件に応じ `agent`, `shutdown` 等。`events.jsonl`, `stderr.log`, `pr-gate-diagnostic.edn`, `localllm-audit.edn`, `localllm-committed.edn` 等がコードに登場。内容は読んでいない。
- outbox は `outbox/{pending,done,failed,unhandled}/<event-id>.edn` と `outbox/board-lanes.edn`。イベント種別 `task-board.run-finished`, `task-board.lane-changed`。基本フィールド `schema-version`, `event-id`, `event-type`, `ticket-id`, `run-id`, `from-status`, `to-status`, `result`, `source`, `revision`, `created-at`, `status`, `attempts`, `redeliveries`。配信の進行に伴う追加フィールドはここでは網羅しない。
- live `state.edn` のトップレベルキーは `pr-gate-retries`。内容・値は未掲載。
- dashboard: `curl -fsS --max-time 8 http://<dashboard-svc>:8080/metrics` は timeout、`kubectl -n codex-workspace port-forward svc/codex-task-board-dashboard 18080:8080` も確立できず。実測メトリクス名は unknown。`rg -n -i 'metrics|prometheus' /home/boxp/ghq/github.com/boxp/lolice/argoproj/codex-workspace/dashboard-configmap.yaml` に一致なし。宣言側の検索だけでは endpoint 不在の証明にならない。

## 5. 既存系列とログストリーム

確認コマンド: `kubectl -n monitoring port-forward svc/prometheus-k8s 19090:9090` 後 `GET /api/v1/label/__name__/values`、`kubectl -n monitoring port-forward svc/loki 13100:3100` 後 `GET /loki/api/v1/labels`。両 port-forward は pods/portforward Forbidden、接続未成立。

- Prometheus の AI / agent / task_board / hermes / llm 系の系列名: **unknown**。列挙できず、ゼロとは判断できない。
- Loki の hermes-agent / codex-workspace のログストリーム有無と label 名: **unknown**。Alloy の pod ログ収集設定があることだけでは実ストリーム存在は証明できない。

Task Board の summary / outbox は effect と safety の網羅的な source ではないため、対応 coverage がない baseline の二重実行・重大安全 event は unknown とする。
