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
- 実データ: `apps/lolice-lineage/public/` は git 管理外。deploy 時に vault から hash 照合して入れる。

### 順序

1. この PR で配信コード、テスト、CI を入れる（実データなし、deploy なし）。
2. Owner が upload の経路を決める。workspace には Cloudflare の資格情報がない。
3. placeholder を deploy し、`verify-live.sh` で陰性確認する。
4. 実 HTML を hash 照合して deploy し、Owner の SSO 後の表示と配信 hash を確認する。
5. 検証後に旧構成を撤去する: boxp/lolice の sidecar、Service、NetworkPolicy、Chainsaw、boxp/arch の tunnel route。DNS は Worker route 用に見直す。
