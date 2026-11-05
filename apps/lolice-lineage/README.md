# lolice-lineage

BOXP-429 の構成図 HTML を、Cloudflare Workers Static Assets で本人限定に配信します。

- URL: `https://lolice-lineage.b0xp.io/`。`/` だけが本文を返します。
- 認証: hostname を既存の Access application（Owner 限定 policy）で保護し、Worker でも Access の JWT を検証します。
- 別経路: `workers_dev` と `preview_urls` を無効にしています。

## 実データを repo に置かない理由

HTML には内部構成が含まれます。この repo は public なので、コードとテストだけを置きます。`public/` は git 管理外で、deploy 時に `scripts/deploy.sh` が作ります。

## 配備

`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` が必要です。

```sh
npm ci
scripts/deploy.sh --placeholder
scripts/verify-live.sh lolice-lineage.b0xp.io <workers.dev のサブドメイン>
scripts/deploy.sh --html <vault の lolice-lineage.html> --expect-sha256 <hash>
```

先に placeholder で陰性確認を通し、そのあとで実データを載せます。

## 撤去

`npx wrangler delete --name lolice-lineage` で Worker と route を消します。
