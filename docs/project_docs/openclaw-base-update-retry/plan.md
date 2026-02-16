# OpenClaw Base Image Update Retry

## Status: COMPLETED

## PR URL
https://github.com/boxp/arch/pull/6968

## 更新前/更新後のベースイメージ
- **更新前**: `ghcr.io/openclaw/openclaw:2026.2.9@sha256:7503c7dc56800b61f1223d3c4032ada61a100538a41425210b4043b71f871488`
- **更新後**: `ghcr.io/openclaw/openclaw:2026.2.15@sha256:20fb8df4e6c6d893de5b8445394583258fdf0f98179e82cdfa24062c6bed5de0`

## #6967 Revert理由の要約
PR #6966 (Renovateによるv2026.2.9→v2026.2.15自動更新) のbuild-and-pushジョブが失敗したためRevert。

失敗原因: PR #6965で追加した`openclaw-codex-call-id-fix.patch`がv2026.2.15のソースコードに対して適用不能になった。
- `images.ts`: "Reversed (or previously applied)" — upstreamが既に修正を取り込んでいた
- `tool-call-id.ts`: Hunk #1 FAILED — upstreamでコード構造が変更されていた
- `transcript-policy.ts`: 2 hunks FAILED — upstreamでコード構造が変更されていた

## 今回の対処
1. ベースイメージを`2026.2.9`→`2026.2.15`に更新（digest pin付き）
2. upstreamで修正が取り込まれたため、パッチ適用ステップ（COPY + RUN patch + tsdown）を削除
3. パッチファイル`docker/openclaw/patches/openclaw-codex-call-id-fix.patch`を削除
4. 空になった`patches/`ディレクトリも削除

## CI結果
- build-and-push: **PASS** (3m36s)
- path-filter: **PASS**
- hide-comment: **PASS**
- test/setup: **PASS**
- その他: SKIPPED（Dockerfileのみの変更のため）

全CIパス確認済み。
