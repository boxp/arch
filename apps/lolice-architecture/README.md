# lolice-architecture

BOXP-435 の全体アーキテクチャ図 HTML を、Cloudflare Workers Static Assets で本人限定に配信します。

- URL: `https://lolice-architecture.b0xp.io/`。`/` だけが本文を返します。`/sha256` は本文の hash を返します。
- 認証: hostname を Access application（`terraform/cloudflare/b0xp.io/portfolio/access.tf` の本人限定 policy）で保護し、Worker でも Access の JWT を検証します。
- 別経路: `workers_dev` と `preview_urls` を無効にしています。

図の匿名公開は承認されていません。`lolice-lineage` の公開承認はこの図に及びません。

## 実データを repo に置かない理由

図の内容は Owner の確認前です。この repo は public なので、コードとテストだけを置きます。`public/` は git 管理外で、deploy 時に `scripts/deploy.sh` が作ります。

## 配備

`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が必要です。`scripts/deploy.sh` は hostname が Access のログインへ転送することを確かめ、その転送先から AUD を読んで Worker に渡します。Access が無効なら deploy しません。

```sh
npm ci
scripts/deploy.sh --placeholder
scripts/verify-live.sh lolice-architecture.b0xp.io <workers.dev のサブドメイン>
scripts/deploy.sh --html <vault の lolice-architecture.html> --expect-sha256 <hash>
```

CI からは `Deploy lolice-architecture` を `mode=html` で実行します。ページは環境 `lolice-architecture-deploy` の secret で渡し、配備後に削除します。1 個の secret は 48 KB までなので、xz と base64 をかけた値を 40,000 文字ごとに分け、`LOLICE_ARCHITECTURE_HTML_XZ_B64`、`_2`、`_3`、`_4` の順に登録します。

## 撤去

`npx wrangler delete --name lolice-architecture` で Worker と route を消します。
