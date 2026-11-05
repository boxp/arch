# BOXP-430: lolice 構成図 HTML を Cloudflare Access 経由で本人限定に閲覧する

## 目的

BOXP-429 の HTML を、Owner だけが開ける実 HTTPS URL で閲覧できるようにする。
HTML には内部構成が含まれるので、public repo、公開 image、未認証 blob には置かない。

## 方式

- 配信元: 実データは既存の私的 PVC に置いたままにする。`codex-workspace` Pod に読み取り専用の配信 sidecar を足す（boxp/lolice 側）。
- 経路: 既存の `k8s` トンネルに `lolice-lineage.b0xp.io` を足す（この PR）。既に `codex-workspace` へ届くトンネルなので、connector と SSM パラメータを増やさない。
- 認証: BOXP-428 と同じく、既存の Owner 限定 reusable policy（`policy for hitohako-stage.b0xp.io (owner only)`）を再利用する。見つからないときは plan を失敗させる。`codex-task-board.b0xp.io` の policy は GitHub ログイン全員を許可するので使わない。

## 順序

1. この PR を merge して apply する。Access application を先に作り、その後に DNS を作る（`depends_on`）。この時点ではオリジンが無く、Access の裏は 502 を返す。
2. boxp/lolice の PR を merge して Argo CD で配備する。

本文が Access 無しで見える時間を作らないための順序です。

## 検証

- 未認証: 実 URL がログインへ転送され、本文を返さないこと。
- 別経路: 別 hostname や LAN から配信ポートへ届かないこと（lolice 側の NetworkPolicy と Chainsaw）。
- 認証後: Owner のログインで HTML が開くこと。担当が本人認証できない部分は Owner に最小の確認を依頼する。

## 範囲外

既存の Access policy の変更、新しい課金や資格情報、データの取り直し。

## 方式変更: Cloudflare ネイティブ配信（TD-01）

Owner の指示で、配信元を sidecar から Workers Static Assets に移します。lolice や workspace が止まっても閲覧でき、二重運用を残しません。

- URL と Access は再利用する: `lolice-lineage.b0xp.io` と既存の Owner 限定 Access application。
- Workers を選ぶ理由: `workers_dev` と `preview_urls` を無効にでき、Pages の `pages.dev` や preview URL より別経路が少ない。無料枠で足りるので新課金はない。
- 二重防御: Worker でも Access の JWT を検証し、`run_worker_first` で assets の直接配信を止める。
- 実データ: `apps/lolice-lineage/public/` は git 管理外。deploy 時に hash 照合して入れる。

### 配備経路（TD-02）

Owner の指示で、boxp/arch の既存 GitHub Actions から deploy します。Cloudflare の資格情報は既存の repo secret を CI 内でだけ使い、workspace には持ち出しません。moltworker と同じ token を使い、新しい token は発行しません。

- 実データの受け渡し: 環境 `lolice-lineage-deploy` の secret。環境の deploy 可能 branch を main に限定するので、PR や未 merge のコードからは読めません。fork PR にも渡りません。
- 登録は deploy の直前、削除は配信確認の直後に行います。`workflow_dispatch` だけで起動し、push や PR では動きません。
- artifact と cache は使いません。本文と受け渡し値を print しません。終了時に runner 上の一時ファイルを消します。

### 順序

1. この PR で配信コード、テスト、deploy workflow を入れる（実データなし）。
2. merge 後、環境を作って main 限定を確認し、`mode=placeholder` で deploy する。`readback.sh` で route、workers.dev、preview URL、未認証経路を陰性確認する。既存 token の権限が足りなければ、ここで不足差分を報告する。
3. 環境 secret を登録し、`mode=html` で hash 照合して deploy する。確認後に secret を削除する。
4. Owner が SSO 後に `/` と `/sha256` を PC とスマホで確認する。
5. 確認後に旧構成を撤去する: boxp/lolice の sidecar、Service、NetworkPolicy、Chainsaw、boxp/arch の tunnel route。DNS は Worker route 用に見直す。

## 方針変更: 一般公開（TD-03）

Owner が lineage の内容を確認し、公開を承認した。これまでの「本人限定」は取り下げ、当該ページだけを匿名で開けるようにする。HTML は内容を変えない。

- `lolice-lineage.b0xp.io` の Access application を削除する。共有の Owner 限定 policy、他サービス、Langfuse の認証は変更しない。
- Worker の JWT 検証をやめる。`/` と `/sha256` 以外は引き続き 404 を返し、`workers_dev` と `preview_urls` は無効のままにする。
- 公開するのは HTML 1 ファイルと hash だけ。vault の調査用ファイルと secret は公開しない。
- 検索エンジン向けの `noindex` は HTML と応答ヘッダーの両方に残す。URL を知っている人が開ける状態で、ポートフォリオからのリンクは妨げない。

### 順序

1. この PR を merge して apply する。Access が消えると、旧 Worker が JWT なしの要求を 403 で拒否する。公開前は閉じた状態のまま進む。
2. `mode=html` で Worker を再配備する。hash は `2e643047fa931f96b750597436d45c23738c50f8d80e232bef7dbe9d032a9739`。ここで公開になる。secret は配備後に削除する。
3. 未認証の HTTP 200、hash、アイコン、PC とスマホの実ブラウザを担当が確認する。
4. 確認後に旧構成を撤去する: arch#14480（tunnel route と DNS）、lolice#1069（sidecar 等）。

## 旧構成の撤去

公開後の動作を担当が確認してから、この順で行う。

1. この PR: tunnel の ingress を外し、DNS をオリジンのない `AAAA 100::`（proxied）に替える。CNAME と AAAA は同じ名前で共存できないので、置き換えの間は短時間名前解決できない。
2. boxp/lolice#1069: sidecar、Service、NetworkPolicy、専用 Chainsaw を revert する。Pod の再作成を伴う。
