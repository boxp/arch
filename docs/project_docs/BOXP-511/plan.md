# BOXP-511: Kohako Studio の更新時停止を解消し安全に複数レプリカ化する

## 現状（2026-11-12 実測）
- lolice `argoproj/kohako-studio`: Deployment `kohako-studio` 1 replica / `strategy: Recreate`。同一 Pod に `bff`（Node, 127.0.0.1:8787）と `web`（nginx :8080, 静的配信 + `/kohako/api/`・`/healthz` を BFF へ proxy）。
- BFF は RWO PVC `/data`（通知受信箱・Web Push 購読・VAPID 鍵）を単一 writer として扱い、会話の受付状態（requestId→Hermes run の追跡・承認）はメモリのみ。
- 直近の更新イベント: 旧 Pod 停止開始→新 Pod 作成 31 秒（Node PID1 が SIGTERM を処理せず grace 30s で SIGKILL）、826MB イメージ pull 66 秒 → **約 100 秒、静的画面も API も全停止**。BFF 再起動で進行中の会話追跡が消え、画面は「前回の依頼は見つかりませんでした」になる。

## 複製可否の判断
- web(nginx): stateless。**2 replicas + RollingUpdate(maxUnavailable 0) + readiness + preStop drain** にする。
- BFF: 単一 writer の JSON ファイル（RWO）・承認状態・Hermes run 追跡を持つため **無確認の複製は不可**。1 replica / Recreate を維持し、停止時間と状態欠落を縮める。
- Hermes 本体: 対象外（変更しない）。

## 変更
### boxp/arch `apps/kohako-studio`
1. nginx: upstream を `include /etc/nginx/kohako-upstream.conf`（既定 127.0.0.1:8787 = 旧構成互換）に分離。BFF 非依存の `/readyz` を追加。BFF 不達(502/504)時は `/kohako/api/` に JSON 503 + `Retry-After` を返す（画面は 5xx を再試行扱い済み）。
2. BFF graceful shutdown: SIGTERM/SIGINT で新規接続を止め、処理中リクエストと永続化キューを待って終了（上限あり）。
3. 会話追跡の永続化: `KOHAKO_DATA_DIR` があれば受付記録（requestId, payloadHash, 状態, runId, 返信, session）を原子的に保存し、起動時に復元。runId 判明済みの pending は `hermes.watch` で追跡だけ再開（再送しない＝二重実行なし）。runId 未判明の pending は `unknown` とし再送しない。

### boxp/lolice `argoproj/kohako-studio`
1. Deployment を `kohako-studio-web`（2 replicas, RollingUpdate, PDB minAvailable 1, preStop sleep, topologySpread）と `kohako-studio-bff`（1 replica, Recreate, PVC, readiness, `KOHAKO_BFF_HOST=0.0.0.0`, sync-wave 1 で web 完了後に更新・web Pod と同ノード優先でイメージ pull を短縮）に分割。旧 Deployment は prune。
2. Service `kohako-studio` は web Pod、`kohako-studio-bff` を新設。両 Pod とも `app: kohako-studio` を維持し、他 namespace の NetworkPolicy は変更しない。
3. NetworkPolicy を web/bff 別にし、BFF の受信は web Pod からの 8787 のみに限定。

## 検証
- arch CI（typecheck/test/build, image build）、lolice CI、codex review P0/P1 なし。
- 配備後、更新を跨いで実 URL（Access 経由は codex-workspace verifier 経路）を 1 秒間隔で計測し、静的 HTTP 停止・API 503・接続切断・会話追跡の継続/欠落・通知重複を区別して記録。
- rollback: lolice PR revert（旧単一 Pod 構成）。arch 側変更は旧構成互換。
- 移行時の一回限りの API 停止（PVC 付け替え）は事前に記録する。
