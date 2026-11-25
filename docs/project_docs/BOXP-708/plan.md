# BOXP-708: 利用枠の早期解放後に runner が古い上限判定で停止し続ける再発を防ぐ

## 背景

BOXP-707 で、Fable の 7d 枠がリセット券で reset 前に戻っていたのに、runner の利用枠保留（`provider-quota-hold!`）が古い `rejected` を reset まで信じ、BOXP-704/706 が開始しなかった。
保留中は run が起きないので `rate_limit_event` が来ず、観測が更新されない構造が原因。BOXP-707 は手動の最小観測で一回限り復旧した。

## 方針

現行仕様: vault `Projects/task-board-provider-quota/spec.md`（BOXP-708 で新設、索引に登録）。

1. 新モジュール `docker/codex-workspace/task-board/ai_quota_reprobe.bb`
   - `decide`: 打つ/待つ/打たないを決める純粋関数。保留キー（route + limits + reset）ごとに、`min(base × 2^n, cap)`（既定 30 分 → 6 時間で頭打ち）の間隔、回数上限 40、reset 15 分前からは打たない、hold でない route には打たない、実行中は打たない。
   - `claim!`: ファイルロック下で判定し、打つときは CLI 起動前に試行を書く（複数プロセスでも 1 回）。
   - `reprobe!`: 公式 `claude` CLI に最小 1 回（ツールなし・MCP なし・hooks 無効・session 保存なし・一時ディレクトリ・API キー/別 provider 切替の env（model canary と同じ一覧）を外す）。`rate_limit_event` を run と同じ `record-claude-run-rate-limit!` で記録。snapshot の手書きはしない。
2. runner (`task_board_runner.bb`)
   - `provider-quota-hold!` が保留を出すたびに `maybe-quota-reprobe!`（loop では route ごと 1 本の background、`tick` では同期）。
   - allowed で保留が解けたら、保留された票の Notes に保留キーごと 1 行。run の開始はいつもの tick・lock・予算の経路のまま。
   - Owner 入口 `task_board_runner.bb quota-reprobe ROUTE`: 間隔・上限・reset 前の制限は無視、hold 必須・60 秒の二重押し防止・実行中排他は守る。
   - `CODEX_TASK_BOARD_QUOTA_REPROBE=off` で自動再観測を止められる。`CODEX_TASK_BOARD_PROVIDER_QUOTA_HOLD` は従来どおり。

## してはいけないこと（範囲外）

ガード全面無効化、snapshot 捏造、新課金・別アカウント・独自認証、担当/レーン/予算の変更。

## 検証

- `tests/ai-observability/test_quota_reprobe.bb`（仕様の例の表・停止条件・Owner 入口・CLI 引数・結果分類・偽 CLI での end-to-end）。モジュール未作成で失敗することを確認してから実装。
- runner self-test に保留→再観測の呼び出し・解除 Note を追加。
- 一時 root での再現（証跡 `/home/boxp/verification-artifacts/BOXP-708/reprobe/`）: 偽 CLI で「まだ上限 → hold のまま・60 秒以内は too-soon」、実 CLI（claude 2.1.330, claude-fable-5-2 に 1 回）で「古い rejected → allowed → clear」、自動経路で「1 tick 目に再観測 → 2 tick 目は保留なし・Note 1 行」。

Lean モデルは作らない: 判定は現在の状態 → 決定の純粋関数で、順序依存の規則は「保留キーが変わると数え直す」だけのため直接のテストで覆う。実際の並行性はファイルロックに依存し、テストは逐次のみ。
