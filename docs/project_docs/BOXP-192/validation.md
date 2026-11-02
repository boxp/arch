# BOXP-192 検証記録（2026-09-29）

## CLI と実モデル

更新 Dockerfile から `boxp-192-codex-workspace:validation` をローカルビルドした。
イメージ ID は `sha256:98059441ec87d68e106d8501a37aa8d43d1c4354af5bf6d0cbec9f0e8e5856cf`。

PATH 先頭へ旧版を模した `/tmp/old-home/.local/bin/claude` を置いた場合も、
`CODEX_TASK_BOARD_CLAUDE_BIN=/usr/bin/claude` はイメージの
`/usr/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe` を指し、
`--version` は `2.1.284 (Claude Code)` だった。イメージ内の runner 内蔵テストも全件成功した。

既存認証を使い、このイメージの `/usr/bin/claude` で plan.md 記載の最小非対話コマンドを実行した。
3モデルとも exit 0、`subtype=success`、`is_error=false`、応答 `OK`。
`modelUsage` のキーと `canonicalModel` がそれぞれ要求した ID に一致した。
[構造化結果](image-model-smoke-results.json)に記録した。先行する隔離 npm 導入版での結果は
[こちら](model-smoke-results.json)。認証情報を含めず、検証コンテナは削除した。

| 担当 | 要求モデル = 実使用モデル | 結果 |
| --- | --- | --- |
| claude-fable | claude-fable-5-1 | 成功 |
| claude-opus | claude-opus-5-5 | 成功 |
| claude-sonnet | claude-sonnet-5-5 | 成功 |

## セキュリティ検査

Trivy 0.74.0 の `trivy config .` はチェックbundleの取得が停滞したため、
`trivy config --skip-check-update .` で同梱チェックを使って実行した（exit 0）。
変更したDockerfileをmain版と比較した結果、両方とも既存のDS-0002 (HIGH: root user)、
DS-0026 (LOW: HEALTHCHECKなし) の2件で、新規指摘はなかった。
リポジトリ全体には既存の指摘が残るため、全件解消を意味しない。

## 配布状態

この検証時点では本番へmerge・rolloutしていない。
稼働中の `codex-workspace` runner は image `sha-70db98a`、
PATH上のCLIは `/home/boxp/.local/bin/claude` 2.1.161、
image同梱 `/usr/bin/claude` は2.1.283、CLI固定envは未設定だった。
レビュー後はplan.mdの手順でimageを配布し、実行パス・版・担当別runを再確認する。

担当表示は [lolice PR #802](https://github.com/boxp/lolice/pull/802) に分離した。
ConfigMapから抽出したserver.pyのfixtureでagent属性と旧summary互換を検証し、
`kubectl kustomize`とCI（argocd-diff/detect/gitleaks）を通過した。
