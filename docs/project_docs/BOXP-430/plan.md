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
