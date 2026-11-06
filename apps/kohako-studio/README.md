# Kohako Web Studio

Hermes の人格と既存 memory を使う Web 会話画面です。Telegram/G2 とは別の会話。共有されるのは Hermes の人格と既存 memory。独自の脳や memory は持ちません。移行元は even-g2-lab@4122e3e です。Web UI、PSD2Live runtime、公開承認済みの Kohako モデルを含みます。G2 固有機能、内部ログ、設定値は含みません。ライセンスは [LICENSES.md](LICENSES.md) を参照してください。

Node 22 で `cd web && npm ci && npm run typecheck && npm test && npm run build`、`cd bff && npm ci && npm run typecheck && npm test` を実行します。

`docker build -t kohako-studio .` で共通イメージを作り、同一 Pod の二つの非 root コンテナとして実行します。既定コマンドは BFF (:8787)、Web (:8080) は `nginx -g 'daemon off;'` を指定します。Web は `/kohako/studio.html` と `/kohako/live2d.html` で公開し、API と `/healthz` は BFF にプロキシします。

BFF は Owner 認証用に `KOHAKO_ACCESS_TEAM_DOMAIN`、`KOHAKO_ACCESS_AUD`、`KOHAKO_OWNER_EMAILS`、Hermes 接続用に `KOHAKO_HERMES_URL`、`KOHAKO_HERMES_KEY`、`KOHAKO_HERMES_TOOLSETS` を環境から読みます。音声認識には `KOHAKO_STT_URL` を任意で設定します。Verifier は `KOHAKO_VERIFIER_ENABLED=true` で有効になり、`KOHAKO_VERIFIER_USERNAME` で対象 ServiceAccount を指定できます。TokenReview の権限と専用 audience の投影 token が必要です。
