# lolice-architecture

BOXP-435 の全体アーキテクチャ図 HTML を、Cloudflare Workers Static Assets で一般公開します。Owner が公開を承認しました（BOXP-435）。

- URL: `https://lolice-architecture.b0xp.io/`。認証はありません。`/` が本文を、`/sha256` が本文の hash を返し、他のパスは 404 です。
- 別経路: `workers_dev` と `preview_urls` は無効のままです。
- 公開するのはこの HTML 1 ファイルだけです。vault の調査用ファイルは配信しません。
- 検索エンジンには載せません（`noindex`）。

## HTML を repo に置かない理由

正本は vault にあり、この repo にはコードとテストだけを置きます。`public/` は git 管理外で、deploy 時に `scripts/deploy.sh` が作ります。

## 配備

`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が必要です。

```sh
npm ci
scripts/deploy.sh --html <vault の lolice-architecture.html> --expect-sha256 <hash>
EXPECTED_SHA256=<hash> scripts/verify-live.sh lolice-architecture.b0xp.io <workers.dev のサブドメイン>
```

CI からは `Deploy lolice-architecture` を `mode=html` で実行します。ページは環境 `lolice-architecture-deploy` の secret で渡し、配備後に削除します。1 個の secret は 48 KB までなので、xz と base64 をかけた値を 40,000 文字ごとに分け、`LOLICE_ARCHITECTURE_HTML_XZ_B64`、`_2`、`_3`、`_4` の順に登録します。

## 撤去

`npx wrangler delete --name lolice-architecture` で Worker と route を消します。
