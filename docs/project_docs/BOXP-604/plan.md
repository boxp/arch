# BOXP-604: runner の terra 実装委譲を外し、親の自律委任と総コストを比較する

## 目的
Claude 親（Fable/Opus）は自分の判断で低コストのサブエージェントを使っている。runner が課している「Codex（gpt-6.1-terra）へ委譲せよ・done には委譲成功か免除記録が必要」という定型の委譲が、総コストを下げているのかを、外して比べる。

## 現状（変更前）
- `delegation-required?` が fable / claude-fable / claude-opus / codex-sol / codex-full / codex-astra で真になり、
  - prompt に `Delegation contract`（delegate.py run か exempt の記録）が入る。
  - Claude/Fable の方針文に「Codex へ委譲せよ。委譲できなければ blocked」が入る。
  - done の結果は `delegate.py verify`（委譲成功か exempt）が通らないと失敗扱いになる。
- 11/03〜11/17 の Claude 親 1557 run: 委譲 447 run、exempt 981 run。親 token 5684M に対し terra 子 1365M（`Projects/model-usage-attribution/delegation-optional-trial.md`）。

## 変更
- `CODEX_TASK_BOARD_DELEGATION_MODE`（`required` / `optional`）を追加。試行中の既定は `optional`。
- `optional` のとき、Claude 親（fable / claude-fable / claude-opus）だけ:
  - done の委譲ゲートを外す（evidence がなくても done を失敗扱いにしない）。
  - 必須の `Delegation contract` と「委譲せよ・できなければ blocked」を外し、「委譲は任意。総コスト（親＋子＋review＋再試行）が下がるときだけ自分の判断でサブエージェントや低コストモデルを使う」に替える。delegate.py は任意で 1 回使える。
- run summary に `:delegation-mode`（required / optional / none）を記録し、比較の層別に使う。
- harness_eval の契約文も runner と同じ分岐にする。

## 変えないもの
codex-sol / codex-full / codex-astra 親の委譲契約、独立 codex review gate、PR ゲート、予算・retry 上限、排他、担当既定、モデル既定。Sonnet などその他の担当。

## 復帰
`default-delegation-mode` を `"required"` に戻す 1 行の PR（または env `CODEX_TASK_BOARD_DELEGATION_MODE=required`）。復帰条件と評価は vault の試行ノートに切替前に固定する。

## 検証
- runner self-test（mode ごとの真偽表と方針文）、結合テスト `test_optional_delegation_mode_releases_claude_parents`、既存の委譲テストは `required` 固定で通す。
- 配備後、実 prompt と run summary の `:delegation-mode "optional"` を読み戻す。
