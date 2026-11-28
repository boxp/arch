# BOXP-781: codex-workspace の回収候補と空き容量を削除なしで 24 時間計測する

## 目的
BOXP-780 の案B（証明できたファイルだけ消す）・案D（checkout 外を退避して回収）の候補量を、**何も消さず**に 24 時間だけ計測する。既存の回収・保持・容量ガード・退避の判定は変えない。

仕様: vault `Projects/codex-workspace-disk-growth/criteria-trial-spec.md`（spec_feature `codex-workspace-criteria-trial`）

## 実装
- `task_board_runner.bb`
  - `$ROOT/criteria-trial.edn` `{:id :from :until}`（最大 25 時間、until で自動終了、無効なら計測しない）
  - 既存の容量帰属走査（prune 後・最短 50 分毎の `find` 1 回）に相乗りし、run ごとに名前だけで分類（再生成物 / ダウンロード物 / `.git` 内部 / checkout 内その他 / ghq 外）。**新しい du / find / git 走査なし**
  - 同じ prune 回の各 run の結果（deleted / held:理由）と突合し、`:criteria-trial` 記録（状態別の量、保留 run だけの候補量、上位 20 run、空きの減り・soft guard までの時間、`:near-guard` / `:fast-drop` の合図）
  - `criteria-trial-report` コマンド（読取のみ）: 空き推移、既存回収量、生成量の見込み（使用増分 + 既存回収）、最後の候補量
- 試験: boundary-test（期間・分類・集計・合図・減り速度・報告）、runner-test `test_criteria_trial_attribution`（窓なしで記録しない、ファイルを消さない、期限切れ/25h 超で記録しない、報告コマンド）。e2e は変更前の runner で失敗することを確認。

## 配備と計測
1. CI・codex review → merge → image build → lolice 反映 → pod 再起動（通常経路）
2. 再起動後に `criteria-trial.edn` を 24 時間の窓で置き、最初の `:criteria-trial` 記録で計測開始を確認
3. ガード接近（空き < soft guard + 4GiB）や急減（soft guard まで 24h 未満）は 24h を待たず報告
4. 24h 後 `criteria-trial-report` で集計し Obsidian に報告。窓は until で自動終了

## Lean
期間判定・名前分類・集計の入出力関数のみで、順序に依存する状態規則がないため対象外。
