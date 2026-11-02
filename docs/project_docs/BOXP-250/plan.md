# BOXP-250: Novel Board localllm の 504 stream timeout を切り分け、待機設定を適正化する

## 切り分け結果

- 失敗 run `20261019T090234Z-b0814a8f…`（NOVEL-6 groom, agent=localllm）の `llm-evidence.edn`: 3 試行すべて `:http-status 504`、elapsed 300,016 / 300,013 / 300,018 ms。runner の HTTP client 上限は 1800 秒（`CODEX_NOVEL_BOARD_LOCALLLM_TIMEOUT_SECONDS`）で、client timeout なら例外（`:connection-error`）になるため client 側ではない。
- 504 本文 `stream timeout` は Envoy の HTTP connection manager が `stream_idle_timeout`（既定 5 分）で応答を打ち切ったときの定型文。lolice `argoproj/local-llm/envoy-config.yaml` は route の `timeout` / `max_stream_duration` を `0s` にしているが `stream_idle_timeout` は未設定だった。runner は `stream: false` で要求していたため、本文が完成するまで 1 byte も流れず、300 秒で切断された。
- 進行していた長時間推論であり停止ではない: Service 経由の実測で gemma4-26b の prefill は 86.6 token/s（8,281 token で 95.6 秒）。NOVEL-6 の groom prompt は 22,497 字 = 約 15,800 token で prefill だけで 180〜220 秒、出力（約 11 token/s）を加えると 300 秒を超える。NOVEL-4 の write（6,392 token, 241.9 秒）は偶然 300 秒未満だった。
- 二重生成: runner は 5xx を一律に再試行していたため、同じ prompt を 5 分間隔で 3 回投げていた。
- 未確認: local-llm namespace の Pod ログ / Loki / Envoy admin はこの Pod から到達できず、Envoy 側の access log での直接確認は未実施。切断後に llama-server 側で生成が止まったかも直接は確認できていない。

## 変更（arch）

`docker/codex-workspace/novel-board/novel_board_runner.bb`

- localllm 要求を SSE streaming（`stream: true`, `stream_options.include_usage`）にし、token が流れている間は中継の idle 判定にかからないようにする。応答が `application/json`（非 streaming server）でも従来どおり読める。
- 上限を層ごとに分ける。
  - headers 到着（待ち行列）: HTTP client の `:timeout` = idle 上限。
  - 無通信（最初の byte まで・chunk 間）: `CODEX_NOVEL_BOARD_LOCALLLM_IDLE_TIMEOUT_SECONDS`（既定 600）。
  - 1 要求の total: action 別。write / revise = `..._TIMEOUT_SECONDS`（既定 1800）、groom = `..._GROOM_TIMEOUT_SECONDS`（既定 1200）、illustration-plan = `..._PLAN_TIMEOUT_SECONDS`（既定 600）。継続要求は同じ上限を 1 ラウンドずつ適用。
- 上限到達時は body を close して上流の要求を切り、受信済み本文を `manuscript.partial.md` / `groom.partial.md` に保存して失敗として記録する。再試行しない。
- HTTP 504 は再試行しない（上流で同じ生成が続いている可能性があるため）。再試行は接続失敗と 429 / 500 / 502 / 503（出力開始前）に限定。途中切断（finish_reason / `[DONE]` なしの EOF、読み取り例外）も再試行しない。
- 証拠（`llm-evidence.edn`）に `:limits` / `:streamed?` / `:first-byte-ms` / `:chunks` / `:status`（`:ok` `:idle-timeout` `:total-timeout` `:stream-error` `:http-error` `:first-response-timeout`）を残す。
- 5 秒ごとに部分出力をディスクへ書き、途中経過を保全する。

`tests/codex-workspace/novel-board-runner-test.sh`

- fake server に SSE 応答（完了 / 停止 / 低速 / 途中切断）と 503 / 504 を追加し、504 無再試行、503 再試行、streaming 完了、idle 上限、total 上限（write と groom で別）、途中切断、部分出力保全、要求回数 1 回を検証。

`vault-seed/Novels/README.md`: localllm の上限と再試行方針を記載（live vault も同内容へ）。

## 変更（lolice, 別 PR）

- `argoproj/local-llm/envoy-config.yaml` に `stream_idle_timeout: 1800s`。ConfigMap のみで Pod 再起動はなく、live には次回 llama-server 再起動時に反映。

## 検証

- `bb novel_board_runner.bb test` と black-box テスト全件 PASS（41 件）。
- 配備後、実 llama-server への短い streaming 要求で SSE 解析・usage・first-byte を確認。NOVEL-6 の再生成・再割当・レーン移動は行わない。
