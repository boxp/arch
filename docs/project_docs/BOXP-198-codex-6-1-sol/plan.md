# BOXP-198: task board runner の GPT-6.1 Sol 対応

## 目的

2026-09-29 に公開された GPT-6.1 Sol（`gpt-6.1-sol`）を Task Board runner から利用できるようにする。

## 事前検証（2026-09-30）

- `@openai/codex` の npm latest は `0.159.2`（0.159.1 で GPT-6.1 Sol が bundled catalog に追加された）。
- 隔離した `CODEX_HOME` で codex 0.159.2 を使い、`codex exec --model gpt-6.1-sol` が成功することを確認した。
- `models_cache.json`（client_version 0.159.2）に記載された `gpt-6.1-sol` の `supported_reasoning_levels` は `low/medium/high/xhigh/max/ultra`（default: `low`）。
- `model_reasoning_effort=minimal` を指定すると、API が `400 unsupported_value` を返す。

## 変更内容

1. `docker/codex-workspace/Dockerfile` の `CODEX_VERSION` を `0.153.4` から `0.159.2` に更新する（codex の Renovate PR は出ていないため、本 PR で更新する）。
2. `task_board_runner.bb`
   - `assignee->model` の `codex-sol` / `codex-full` の割当先を `gpt-6.1-sol` に変更する。
   - モデル階層コメントを `gpt-6-astra > gpt-6.1-sol > gpt-5.6-terra > gpt-5.6-luna` に更新する。
   - `fable-policy-prompt` と `codex-astra-policy-prompt` の `gpt-5.6-sol` 表記を `gpt-6.1-sol` に置き換える。
   - `sol-reasoning-levels`（low/medium/high/xhigh）を追加し、`codex-sol-minimal` / `codex-full-minimal` を受け付けないようにする。
   - self-test の期待値を更新する。
3. `tests/codex-workspace/task-board-runner-test.sh` のモデル割当ペアを更新し、`codex-sol-xhigh` の正常系と `codex-sol-minimal` / `codex-full-minimal` の拒否ケースを追加する。
4. `docker/hermes-agent/skills/obsidian-task-board/SKILL.md` に、assignee ごとの割当先モデルと有効な suffix を明記する。
   - ローカル版（dotfiles 管理）の SKILL.md にはモデル割当の記述がないため、変更しない。

## 対象外

- 既定の `codex`（terra）の割当先の変更。
- astra / sol の `max` / `ultra` reasoning 対応（別チケットで扱う）。

## 検証

- `bb docker/codex-workspace/task-board/task_board_runner.bb test`
- `tests/codex-workspace/task-board-runner-test.sh`
- デプロイ後、Pod 内で `codex --version` と models_cache を確認し、`codex-sol` assignee で実際の run を 1 件行う。
