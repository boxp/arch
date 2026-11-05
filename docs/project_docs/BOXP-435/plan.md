# BOXP-435: 全体アーキテクチャ図とポートフォリオの 2 ページ導線

## 目的

lineage と同じ見た目で、インフラ全体の役割、階層、通信、認証、CI と GitOps、データの流れを一望できる図を作る。ポートフォリオに lineage と全体図の独立ページを用意し、stage で辿れるようにする。

## 公開範囲の区別

| 対象 | 状態 | この PR の扱い |
| --- | --- | --- |
| lineage の図 | Owner が匿名公開を承認済み（BOXP-430 で公開） | `/lineage` から公開 URL へリンクする |
| 全体図 | 匿名公開は未承認 | 本人限定の hostname で配信し、`/architecture` は stage だけに生成する |
| ポートフォリオ本番 b0xp.io | 切替は未承認 | 変更しない。`boxp-portfolio` にも deploy しない |

## 構成

- `apps/lolice-architecture`: 本人限定配信の Worker。`lolice-lineage` の公開前の実装をもとにしている。JWT を検証し、workers.dev と preview URL を閉じる。
- `.github/workflows/deploy-lolice-architecture.yml`: main 限定の手動 deploy。図の本体は環境 `lolice-architecture-deploy` の secret で受け取り、配備後に secret を消す。
- `terraform/cloudflare/b0xp.io/portfolio`: Access application と DNS を追加する。policy は stage の本人限定 policy を再利用し、共有 policy と他サービスは変更しない。
- `apps/portfolio`: `/lineage`、`/architecture`、トップの Infrastructure 節を追加する。本番設定のビルドに全体図の URL が残らないことを CI で検査する。

図の本体とそのデータはこの repo に入れない。

## 判断

- **別 Worker にした理由**: ポートフォリオの Pages は public repo からビルドするので、未承認の図を同じ deploy に載せられない。main への push ごとの再 deploy でも私的な secret を保持し続けることになる。
- **iframe にしない理由**: lineage は `frame-ancestors 'none'` で配信している。リンクで開く。
- **ACCESS_AUD を deploy 時に読む理由**: application の AUD は apply 後に決まる。`scripts/access-aud.sh` が匿名アクセスの転送先から読むので、Access が効いていなければ deploy が止まる。

## 手順

1. この PR を gate 確認後に merge する。tfaction が Access と DNS を apply し、ポートフォリオの stage が自動で deploy される。
2. 環境 `lolice-architecture-deploy` を main 限定で作る。
3. `mode=placeholder` で deploy し、`readback.sh` で route、workers.dev、preview、未認証の拒否を確認する。
4. 図の本体を環境 secret に登録して `mode=html` で deploy し、hash を照合する。secret を削除し、削除と run log を確認する。
5. 未認証の `/architecture`、`/lineage`、pages.dev の拒否を確認する。

本番切替と全体図の匿名公開は Owner の判断を待つ。

## 検証

- Worker: `npm test`（JWT、経路、AUD なしで閉じること、workflow の制約）
- ポートフォリオ: 本番と stage の両設定でビルド。CI の検査と Lighthouse
- 実 URL: 未認証の拒否は担当が確認する。ログイン後の表示は Owner にしか確認できない
