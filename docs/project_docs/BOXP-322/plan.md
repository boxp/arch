# BOXP-322 修復計画

## 対象と順序

1. ghalint 1.5.7: aqua registry の署名方式対応を取り込み、checksum と実インストールを検証する。
2. TFLint 0.65.0: checksum が欠けた stable-diffusion 更新を正規生成手順で補い、Plan CI を確認する。k8s 更新は既存の検証成功後に auto-merge 後処理の状態を再確認する。
3. TypeScript 7: lockfile を同一 Node/npm toolchain で再生成し、`npm ci` と Astro check/build を実行する。互換性問題は依存更新が必要な最小範囲に限定する。

## 安全条件

- Python 3.15 (#13804) と Kubernetes/CRI-O (#13440) は変更・再実行・merge しない。
- required checks、review、保護、トークン/権限を変更・迂回しない。
- Ansible Plan/Apply、Terraform 手動 apply、環境操作は行わない。
- 各修復は独立 PR として通常 CI・review を通し、merge 前後に head と CI を再確認する。

## 記録

結果は `Projects/renovate-ci-triage/repair-summary.md` と owner summary への入口リンクに反映する。
