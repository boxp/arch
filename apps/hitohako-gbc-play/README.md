# hitohako-gbc-play

ひとはこGBC（制作途中のゲームボーイカラー用ゲーム）を、ROM を手で読み込まずにブラウザーで試遊するページの配備（BOXP-629）。**本人限定で、一般には公開しない。**

- URL: `https://hitohako-gbc.b0xp.io/`。Cloudflare Access で、本人の GitHub アカウントでログインした時だけ開く。ページも ROM も同じ Pages project（`boxp-hitohako-gbc-play`）の中にあり、どちらもログインが要る。`pages.dev` 直 URL と配備ごとの URL にも同じ policy を付けてある（`terraform/cloudflare/b0xp.io/hitohako/gbc_play.tf`）。
- このディレクトリにあるのは配備のスクリプトだけ。ページ・エミュレーター・ROM はこのリポジトリに置かない。

## 流れ

1. 非公開リポジトリ `boxp/hitohako-gbc`（ソース・原画・台本）の CI が、main で確認の通った配布物（ページ + エミュレーター + ROM + 権利表記 + `version.json`）を、配布物だけを置く非公開リポジトリ `boxp/hitohako-gbc-play` へ送る。
2. `.github/workflows/deploy-hitohako-gbc-play.yml` が 30 分ごと（または `workflow_dispatch`）に、読取り専用の deploy key（Secrets `HITOHAKO_GBC_PLAY_DEPLOY_KEY`）で `boxp/hitohako-gbc-play` を取り出す。この鍵で読めるのは配布物のリポジトリだけ。
3. `scripts/fetch-bundle.sh` が、決めた一覧にないファイルがあれば止め、`version.json` と ROM の sha256 が合うことを確かめる。
4. `scripts/deploy.sh` が、配備の前に全部の入口が Access の内側にあること（未ログインでは 302 でログインへ転送）を確かめ、配信中の物と違う時だけ `wrangler pages deploy` し、配備のあとにも同じ確認と、Cloudflare API での版の読み戻しをする。 初回だけは入口がまだ無い（Access の転送ではなく 404 などが返る）ので、中身の無い仮のページを先に置いて入口を作り、Access の内側にあることを確かめてから本物を配備する。

すぐ配備したい時:

```sh
gh workflow run deploy-hitohako-gbc-play.yml -R boxp/arch            # 新しい配布物があれば配備
gh workflow run deploy-hitohako-gbc-play.yml -R boxp/arch -f force=true   # 同じ配布物でも配備し直す
```

## 守ること

- このリポジトリは公開で、Actions のログも公開。配布物の中身・commit message・ROM をログや artifact に出さない（出すのは配布物のコミットと ROM の sha256 まで）。
- Access を外さない。`scripts/access-check.sh` が失敗する状態では配備しない。
- 配布物に入ってよいファイルの一覧（`scripts/fetch-bundle.sh` の `allowed`）を広げる時は、`boxp/hitohako-gbc` の README「ブラウザーで試遊」と合わせて直す。

## 撤去

Pages project・DNS・Access は `terraform/cloudflare/b0xp.io/hitohako/gbc_play.tf` を消して apply。workflow とこのディレクトリを消し、`boxp/hitohako-gbc-play` の deploy key と Secrets `HITOHAKO_GBC_PLAY_DEPLOY_KEY` を消す。
