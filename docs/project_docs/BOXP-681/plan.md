# BOXP-681: Hermes Agent 更新 PR (arch#14496) の image CI 失敗修正

## 直接原因 (詳細ログで確定)
- run 45100370731 / build-and-push の `[4/9]` Babashka 導入 RUN で
  `sha256sum -c` が `FAILED` (curl は成功、tar/install/bb 実行には未到達)。
- main の arch#15540 (Renovate, automerge) が `BABASHKA_VERSION` を 1.13.229→1.13.230 に
  上げたが、regex manager は `BABASHKA_SHA256` を更新できず 1.13.229 の値
  (`64fb98…14da`) のまま残った。#15540 自身の build-and-push も同じ理由で失敗していたが、
  build-and-push は required check ではないため automerge された。
- よって main の hermes-agent image build も壊れており、#14496 (v0.23.1→v0.23.3) 固有の問題ではない。

## 修正
1. `docker/hermes-agent/Dockerfile` の `BABASHKA_SHA256` を公式 release asset
   `babashka-1.13.230-linux-amd64-static.tar.gz.sha256` の値
   `ffa98e905c75b6b13eb0b644b778219205180569bfe6004a3e35c3a9798a145d` に更新
   (ダウンロードした実ファイルの sha256 とも一致を確認)。checksum 検証は維持。
2. 再発防止: renovate.json5 に hermes-agent Dockerfile の babashka 更新を automerge しない
   rule を追加し、Dockerfile に「SHA256 も同じ PR で更新」コメントを追加。

## 手順
1. 本 PR を main に merge (image build 成功を確認)。
2. #14496 を Renovate に rebase させ、build-and-push 成功を確認。
3. BOXP-313 / BOXP-582 の手順 (notify-lab stage2 等) で回帰確認後に #14496 を手動 merge。
4. lolice 側の反映と Hermes 起動・会話/通知の確認。

## Spec-first / Lean
設定値 (checksum) と Renovate 設定の修正のみで状態遷移規則が無いため、Lean モデルは対象外。
