# BOXP-431 lolice 全体図の識別性改善

## 目的

BOXP-430 で Cloudflare に配備した本人限定の構成図へ、コハコの既存イラストとサービスのアイコンを加えます。ページ本体と画像は非公開のままで、この repo には置きません。

## この repo の変更

ページが大きくなり、圧縮後の値が secret 1 個の上限 48 KB を超えます。配備 workflow が順番付きの secret を最大 4 個受け取れるようにします。

- 変更するもの: `.github/workflows/deploy-lolice-lineage.yml`、`apps/lolice-lineage/README.md`
- 変更しないもの: Worker、Access、DNS、route、権限、CI の資格情報
- 復元は従来と同じ手順で、`deploy.sh` が hash の全桁を照合します

## 配備の手順

1. この PR を merge する
2. 環境 secret をページの値で登録する
3. main から `mode=html` と `expected_sha256` を指定して workflow を実行する
4. 未認証の拒否と別経路の無効を確認する
5. 環境 secret を削除し、削除を読み返す

## 境界

- ページ、イラスト、内部データを repo、artifact、ログへ出しません
- BOXP-430 の旧構成の撤去（#14480、boxp/lolice#1069）には触れません
