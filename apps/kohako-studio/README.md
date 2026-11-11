# Kohako Web Studio

Hermes の人格と既存 memory を使う Web 会話画面です。Telegram/G2 とは別の会話。共有されるのは Hermes の人格と既存 memory。独自の脳や memory は持ちません。移行元は even-g2-lab@4122e3e です。Web UI、PSD2Live runtime、公開承認済みの Kohako モデルを含みます。G2 固有機能、内部ログ、設定値は含みません。ライセンスは [LICENSES.md](LICENSES.md) を参照してください。

Node 22 で `cd web && npm ci && npm run typecheck && npm test && npm run build`、`cd bff && npm ci && npm run typecheck && npm test` を実行します。

`docker build -t kohako-studio .` で共通イメージを作り、同一 Pod の二つの非 root コンテナとして実行します。既定コマンドは BFF (:8787)、Web (:8080) は `nginx -g 'daemon off;'` を指定します。Web は `/kohako/studio.html` と `/kohako/live2d.html` で公開し、API と `/healthz` は BFF にプロキシします。

BFF は Owner 認証用に `KOHAKO_ACCESS_TEAM_DOMAIN`、`KOHAKO_ACCESS_AUD`、`KOHAKO_OWNER_EMAILS`、Hermes 接続用に `KOHAKO_HERMES_URL`、`KOHAKO_HERMES_KEY`、`KOHAKO_HERMES_TOOLSETS` を環境から読みます。音声認識には `KOHAKO_STT_URL` を任意で設定します。Verifier は `KOHAKO_VERIFIER_ENABLED=true` で有効になり、`KOHAKO_VERIFIER_USERNAME` で対象 ServiceAccount を指定できます。TokenReview の権限と専用 audience の投影 token が必要です。

試作は Studio と Web リグ画面の選択欄で比較できます。クエリなしでは最新の試作 v12（担当不採用・本人確認用）を表示し、v0〜v3、v5、v6、v11 に戻せます。v4、v7〜v10 は p2lrt が消失したため比較画像と不採用理由を表示します。

表情と動作の比較版は `/kohako/live2d.html?acting=1`（手動）と `/kohako/studio.html?acting=1`（会話連動）で開けます。クエリなしの表示は変わりません。文単位の感情はルールベースで判定し（`web/src/live2d/acting.ts`）、腕・表情は全身 v11r の頂点出力を描画直前に変形して足します（`web/src/live2d/gesture.ts`）。別 LLM による判定や新規素材は使っていません。

## 試作候補（固定版）

試作は通常版や `?acting=1` を上書きせず、`candidates/candidates.json` に候補として追加します（既存 ID の commit は差し替えない）。各候補の commit はタグ `kohako-studio-candidate/<id>` で保持し、CI の `candidates/fetch.sh` がその版の `web/` を取り出し、Docker の candidates ステージが `/kohako/candidates/<id>/` 用に個別ビルドします。候補ごとの JS と acting 素材は別パスで、モデル v11r・runtime・静止表情は通常版と同じ blob であることを fetch 時に検証して共用します。API は nginx で `/kohako/api/` へ書き換え、認証は通常と同じです。一覧は `/kohako/candidates.html`（Studio のフッターからリンク）。

追加手順: commit をタグ `kohako-studio-candidate/<id>` で push → `candidates.json` に id・commit・状態・試した動作・問題点を追記 → 通常の PR。

コハコの家 `/kohako/home.html` は日常利用のメイン画面で、Studio は開発用プロトタイプです。同じ BFF・認証を使い、ふれあいの反応はローカルのみ、会話は Web 専用セッションです。
