# T-20260219-013: Moltworker upstream clone ベースのビルド方式へ変更

**作成日**: 2026-02-19
**ステータス**: 実装完了

## 目的

`cloudflare/moltworker` を npm 依存ではなく、`prepare.sh` で upstream を SHA pin で clone し、
overlay ファイルで boxp 固有設定を上書きする方式へ移行する。

## 方式

### 概要

1. `prepare.sh` が `cloudflare/moltworker` を固定 SHA で `.upstream/` に clone
2. boxp 固有の overlay ファイル（Dockerfile, wrangler.jsonc 等）で上書き
3. `.upstream/` ディレクトリから `wrangler deploy` を実行
4. Worker コードは clone から直接参照（npm の `moltworker` 依存は削除）

### ファイル構成

```
docker/moltworker/
├── .gitignore              # .upstream/ を除外
├── UPSTREAM_REF             # upstream commit SHA を記録
├── prepare.sh               # upstream clone + overlay 適用スクリプト
├── overlay/
│   ├── Dockerfile           # boxp 固有の Dockerfile（gh CLI, git, jq 追加）
│   └── wrangler.jsonc       # boxp 固有の wrangler 設定（routes, r2 等）
├── package.json             # npm 依存（moltworker 削除、ローカル用）
└── wrangler.jsonc           # 削除（overlay/ に移動）
```

### prepare.sh の動作

1. `UPSTREAM_REF` ファイルから SHA を読み取り
2. `.upstream/` が存在しなければ clone、存在すれば fetch + checkout
3. `.upstream/` 内で `npm install`
4. `overlay/` の内容を `.upstream/` にコピー（上書き）

### CI 変更

- `npm install` の前に `bash prepare.sh` ステップを追加
- working-directory を `.upstream/` に変更して deploy

## upstream ref 更新手順

1. 最新の upstream SHA を確認:
   ```bash
   git ls-remote https://github.com/cloudflare/moltworker.git HEAD
   ```
2. `docker/moltworker/UPSTREAM_REF` ファイルの SHA を新しいコミットに更新
3. ローカルで動作確認:
   ```bash
   cd docker/moltworker
   bash prepare.sh
   cd .upstream && npx wrangler deploy --dry-run
   ```
4. commit & push → CI で自動デプロイ

## overlay ファイル更新時の注意

- `overlay/Dockerfile`: upstream の Dockerfile に対して差分を適用する形。upstream が Dockerfile を変更した場合、overlay も追従が必要
- `overlay/wrangler.jsonc`: upstream の wrangler.jsonc を完全に置き換える形。新しい binding が upstream に追加された場合は overlay にも反映が必要

## リスク

- upstream の破壊的変更時に overlay が壊れる可能性
  - 対策: SHA pin で固定し、手動で更新タイミングを制御
- `.upstream/` の clone に時間がかかる可能性
  - 対策: shallow clone (`--depth 1`) + CI キャッシュ
