# T-20260301-010: 自宅Local LLM運用（OpenClaw前提）詳細調査レポート

## 概要

ローカルLLM運用のハードウェア/モデル/構成を実務レベルで比較し、100万円以内で実行可能な具体構成案を複数提示する調査タスク。

## 成果物

- `docs/research/local-llm-home-ops-2026-03-01.md` - 詳細調査レポート

## 調査スコープ

1. ハードウェア比較（NVIDIA/AMD/Mac Studio、予算〜100万円）
2. モデル選定比較（coding/chat/reasoning、サイズ別・量子化別）
3. AMD向き/NVIDIA向きの切り分け
4. OpenClaw連携設計（litellm、lolice k8s統合）
5. X（旧Twitter）調査（ROCm実運用、自宅LLM構成等）
6. 推奨アーキテクチャ提案（A/B/C 3案）
7. Qwen3.5 追加調査（公式モデルカード + Model Studio + X投稿）
8. X検索による一般ユーザー検証（OpenClaw/Ollama/llama.cpp の実測投稿）

## 結論

- **A案（保守重視）**: Mac Studio M4 Ultra 192GB（約80〜90万円）
- **B案（コスパ重視）**: RTX 5090 + 自作PC（約55〜70万円）
- **C案（性能重視）**: 2x RTX 4090 + 自作PC（約75〜100万円）
- **推奨**: A案（静音・省電力・大型モデル対応・メンテナンスフリー）
