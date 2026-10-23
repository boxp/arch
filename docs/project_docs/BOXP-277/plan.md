# BOXP-277: Task Board で localllm (Gemma 4) の文書更新アサインを実装し現行ハーネス適性を評価する

- チケット: vault `Tickets/BOXP-277`
- 設計・評価の正本: vault `Projects/task-board-localllm-docs/README.md`（owner 入口）、`evaluation.md`（ケース表・分母付き結果）、`evidence/`（非秘密 run 証拠）
- 実装: boxp/arch `docker/codex-workspace/task-board/localllm_docs.bb`（新規）+ `task_board_runner.bb`（assignee `localllm` の経路追加）+ `tests/codex-workspace/localllm-docs-test.sh`（fake LLM で安全性 black-box）+ `tests/codex-workspace/localllm-eval/`（実 Gemma 4 評価ハーネス、CI では実行しない）

## 調査結果（Phase 0/1）

| 項目 | 事実（2026-10-23 実測） |
| --- | --- |
| 配備中 runner | `ghcr.io/boxp/arch/codex-workspace:sha-b42f09e`。runner source は arch `origin/main`（c8714c441）と同一 |
| 対応 assignee | `fable` / `claude-fable` / `claude-opus` / `claude-sonnet` / `codex*`（reasoning suffix 可）。`localllm` は未対応で、カードは無視される（Notes への記録なし） |
| 実行契約 | prompt を stdin で CLI (`claude --print` / `codex exec`) に渡し、無制限 shell + vault 全体書込み権限。stdout 末尾の `TASK_BOARD_RESULT: done|review|blocked` を runner が解釈し、review は PR URL か `TASK_BOARD_REVIEW_PR: none` を要求 |
| claim / heartbeat / 再開 | `locks/<ticket>.edn` + heartbeat、stale lock (180s) 回収、planned shutdown marker、idle timeout 7200s。lane は SSOT |
| local-llm 実 API | `http://llama-server.local-llm.svc.cluster.local:8080/v1`（llama.cpp router b11669）、model id `gemma4-26b`（`Gemma4-26B-A4B-QAT-Uncensored-HauhauCS-Balanced-Q4_K_M.gguf`、Q4_K_M、n_params 25.2B、ctx 262144、`--parallel 1`、`--jinja`、`--reasoning off`）、認証不要（placeholder `local-llm`）、`/health` 200 |
| tool / schema 対応 | `tools` 指定で `finish_reason=tool_calls` と正しい引数 JSON を返す（実測）。`response_format: json_schema (strict)` は grammar で有効 JSON を返す（実測）。decode ≒ 14 tok/s、prefill 2K ≒ 250 tok/s（BOXP-253 計測） |
| 代替 CLI ハーネス | `pi` 0.80 が `llama.cpp/gemma4-26b`（maxTokens 4096）で設定済み。Novel Board では「Pi 起動不良」のため不採用、runner が HTTP 直接呼び出し |
| Novel Board 実績 | `novel_board_runner.bb` に SSE streaming + idle/total 上限 + 継続要求 + `llm-evidence.edn` の実装あり（再利用）。小説生成は「本文のみ出力」契約で、既存 Markdown を保持する編集ではないため文書更新の成功証拠にはしない |

## 方針

1. **評価（Phase 2）**: 隔離 fixture vault（実 vault/実 secret を使わない）に対し、実 Gemma 4 を 3 つのハーネスで通す。
   - H1 現行ハーネス相当: `pi -p --model llama.cpp/gemma4-26b`（read/edit/write ツール、cwd=fixture）に Task Board と同じ契約（日本語指示 + `TASK_BOARD_RESULT` marker）。
   - H2 全文書き換え: chat completion に対象ノート全文を渡し、更新後の全文を出力させて保存。
   - H3 構造化差分 adapter: 変更案を JSON schema（`replace-section` / `append-section` / `replace-text` / `needs-human`）で出させ、runner 側の trusted executor が検証して適用。
   - ケース 12（限定差替え / 追記 / 要約→更新 / 複数参照+出典 / frontmatter・wikilink・コードブロック保持 / 日英混在 / 曖昧→停止 / 長文 / 複数ターン改稿 / 命令注入 / 秘密要求 / allowlist 外）。H3 は 2 反復、H1/H2 は 1 反復。判定は決定的 checker（frontmatter 同一・範囲外差分 0・リンク/フェンス保持・期待文字列）+ claude-fable の目視（LLM 自己採点はしない）。
   - 予算: GPU 直列、合計 2.5 時間 / 60 リクエスト上限、HTTP エラー 3 連続または Novel Board lock 出現で停止。
2. **実装（Phase 3/4）**: `localllm_docs.bb` を runner に組み込み、`assignee: localllm` かつ frontmatter `docs-target:`（vault 相対 path）の明示 opt-in がある票だけを実行。runner 側で強制: allowlist root（`CODEX_TASK_BOARD_LOCALLLM_DOCS_ROOTS`、既定 `Projects/task-board-localllm-docs/pilot`）、canonical path / symlink 拒否、`.md` のみ、frontmatter 不変、base hash による競合検査、原本 backup、原子的保存、失敗時不適用、audit（`localllm-audit.edn` / `llm-evidence.edn`）と rollback コマンド。結果は常に Review（担当 boxp）か Blocked（理由付き）で、Done にしない。model 到達不能時は cloud に切り替えず Blocked。
3. **非干渉**: 既存 cloud 経路・Novel Board・稼働 run・lolice manifest は変更しない（env 既定値で動く）。`autonomy_policy.bb` の v2 schema registry は触らない（実行許可ではないため）。
4. **E2E**: merge → image build → GitOps 配備は Pod 再作成を伴うため、本 run（同 Pod 内）からは merge しない。配備前に、この Pod 内で `tick --ticket <テスト票>` を実 vault・実 API・専用テストノートに対して 1 回実行し、assign → 限定差分 → Review 停止 → Obsidian 側で閲覧できることを確認する（他の候補カードには触らない）。配備後の sidecar での再確認は owner の merge 後の判断事項として残す。

## やらないこと

- 新モデル download / GPU 二重 load / driver・kernel 変更 / 推論 tuning。認証追加 / 課金切替 / 本番インフラ変更 / 既存票の再実行 / lock 強制削除 / 他 agent 中断 / 全 vault 無条件更新。docs-only PR。
