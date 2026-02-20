# OpenClaw Tool Call ID Sanitization Fix

## 概要

GitHub Issue [openclaw/openclaw#10640](https://github.com/openclaw/openclaw/issues/10640) の問題に対するパッチを、archリポジトリのOpenClawカスタムイメージビルドに追加する。

## 問題

- Tool call IDがAPIの制限（OpenAI 40文字、他64文字）を超えてエラーになる
- エラー: `Invalid 'input[180].call_id': string too long. Expected a string with maximum length 64, but got a string with length 67 instead.`

## 根本原因

OpenAI向けのtool call ID sanitizationが2箇所でバイパスされている：

1. `transcript-policy.ts`: `sanitizeToolCallIds: !isOpenAi && sanitizeToolCallIds`
2. `images.ts`: `sanitizeMode: "images-only"`の場合、ID sanitizeがバイパス

## 実装内容

### 1. パッチスクリプト

**ファイル**: `docker/openclaw/patches/fix-tool-call-id-sanitization.sh`

コンパイル済みJavaScriptファイル内の以下のパターンを修正：

- Fix A: `!isOpenAi&&sanitizeToolCallIds` → `sanitizeToolCallIds`
- Fix B: `allowNonImageSanitization&&options?.sanitizeToolCallIds` → `options?.sanitizeToolCallIds`

### 2. Dockerfileの修正

**ファイル**: `docker/openclaw/Dockerfile`

`USER root`の直後にパッチ適用ステップを追加。

## 修正対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `docker/openclaw/patches/fix-tool-call-id-sanitization.sh` | 新規作成 |
| `docker/openclaw/Dockerfile` | パッチ適用ステップ追加 |

## 検証方法

1. **ローカルビルドテスト**
   ```bash
   cd /home/boxp/ghq/github.com/boxp/arch
   docker build -t openclaw-patched docker/openclaw/
   ```

2. **パッチ適用確認**
   ```bash
   docker run --rm openclaw-patched grep -r '!isOpenAi&&sanitizeToolCallIds' /app/dist/*.js
   # 上記が何も出力しなければOK（パターンが存在しない）
   ```

3. **動作確認**
   - パッチ適用後のイメージでOpenClawを起動
   - tool call機能を使用してエラーが発生しないことを確認

## リスクと軽減策

| リスク | 軽減策 |
|--------|--------|
| minifiedコードのパターン変更 | 検証ステップで失敗検出 |
| 上流で別の方法で修正 | WARNING出力のみ（失敗にはしない） |
| パッチ適用後の動作不良 | ローカル検証後にPR |

## 上流への対応

- 一時的な回避策であり、上流でマージされたらパッチを削除
- Renovate PRレビュー時に上流の状況を確認

## 参考リンク

- [GitHub Issue #10640](https://github.com/openclaw/openclaw/issues/10640)
- issueコメントでの詳細な分析と修正提案
