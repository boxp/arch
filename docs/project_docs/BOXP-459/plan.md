# BOXP-459: Renovate/agent PR 定期棚卸し — arch の aqua-registry pin 更新

## 背景
- 日次PR棚卸し（BOXP-459）で、Renovate PR boxp/arch#14177（tfprovidercheck v1.0.8）が
  `update-aqua-checksums` で失敗し automerge が滞留していることを確認した。
- 原因: `aqua/aqua.yaml` の standard registry が commit `3546ea19`（ghalint v1.5.7 の Sigstore bundle 修正待ちの一時 pin, BOXP-322）に固定され、
  tfprovidercheck v1.0.8 の新しい cosign bundle（`*_checksums.txt.sigstore.json`）定義（aqua-registry #63446, 8f28fd9）を含まない。
  旧定義は v1.0.8 で配布されなくなった `.pem` を取得しようとして HTTP 404 になる。
- 一時 pin の解除条件（「次の aqua-registry release が修正を含むまで」）は満たされた:
  v4.582.0 は `3546ea19` と `8f28fd9` の両方を含む（compare: behind_by=0）。

## 変更
- `aqua/aqua.yaml` の registry ref を `v4.582.0` に更新し、一時 pin コメントを削除（Renovate の通常追従に戻す）。
- `aqua/aqua-checksums.json` は既存の `update-aqua-checksums` workflow で再生成される。

## 検証
- PR CI（update-aqua-checksums / status-check 等）が成功し、署名検証（cosign）を省略しないこと。
- merge 後に Renovate が #14177 を rebase し、checksum 更新と CI 成功 → automerge されることを確認する。

## 範囲外
- 署名検証の無効化・require_checksum の緩和はしない。
