# BOXP-367: 創作 Ornith-1.5 / coding Qwen3-Coder-Next の設定と Task Board 実経路の検証

## 現状（2026-10-30 調査）

- local-llm router（llama.cpp b11669、`--models-max 1`）は `ornith15-35b-a3b`（通常版 Ornith-1.5 Q4_K_M）と `qwen3-coder-next`（Qwen3-Coder-Next Q4_K_S）を preset として提供済み（`/v1/models` で確認）。
- Task Board の localllm 経路（`assignee: localllm`）は文書更新専用。既定 model は `CODEX_TASK_BOARD_LOCALLLM_MODEL` が未設定のため code 既定の `gemma4-26b`。票ごとの `docs-model:` で別 preset を選べる。
- local model で repo を編集する coding 経路は Task Board に存在しない。pi 1.4.0 と `llama.cpp` provider の models.json（lolice configmap）はあるが、`qwen3-coder-next` は未登録。
- codex-workspace は `strategy: Recreate`。active run（BOXP-360 など）がある間に rollout すると既存 run を止めるため、反映は active run がない時間帯に行う。

## 変更

1. boxp/arch（本 PR）: `assignee: localllm-coder` の限定 coding 経路を追加する。
   - pi を `--provider llama.cpp --model <CODEX_TASK_BOARD_LOCALLLM_CODER_MODEL、既定 qwen3-coder-next>` に固定して per-run worktree で非対話実行する。
   - 実行前に router の `/v1/models` でその id が提供されているかを確認し、なければ blocked（別 model・cloud へは切り替えない）。
   - 実 model id・router の preset readback・所要時間・exit・diff stat・patch を run dir の `localllm-coder.edn` / `localllm-coder.patch` に残す。
   - push・PR 作成・merge はしない。patch は隔離した worktree と run dir に留め、Review で止める。
   - 同じチケットで後続の localllm-coder run（review-fix・retry）が起きたら、直前の run の patch を新しい worktree へ `git apply` してから開始する。適用できなければ blocked にし、patch は worktree 相対パスで記録する。
   - 既存の Codex / Claude / localllm docs 経路と全 Board の既定は変えない。
2. boxp/lolice（別 PR）: Task Board localllm 創作経路の既定を `ornith15-35b-a3b` にする（`CODEX_TASK_BOARD_LOCALLLM_MODEL`）。`CODEX_TASK_BOARD_LOCALLLM_CODER_MODEL=qwen3-coder-next`、pi models.json に `qwen3-coder-next` を追加。rollback は env を外すか `gemma4-26b` に戻す。uncensored 派生は使わない。

## 検証

- runner self-test（`bb task_board_runner.bb test`）に localllm-coder の候補 action・コマンド組み立て・preflight 失敗時の blocked を追加。
- 反映後に実 readback（pod env、`pi --list-models`、router `/v1/models`）。
- 創作 pilot: `assignee: localllm` の通常票（docs-model 指定なし）を Backlog→groom→Ready→実行→Review、続けて同じ note への改稿指示。成人の敵キャラ 1 名の非露骨な設定のみ。
- coding pilot: `assignee: localllm-coder` の通常票で boxp/arch の実在の限定的な不具合 1 件を修正させ、修正前 fail / 修正後 pass の再現テストと関連既存テストを確認する。

## 範囲外

- 本番 merge / Apply（coding pilot の patch）、Hermes 再起動、active run の強制停止、cloud fallback。
