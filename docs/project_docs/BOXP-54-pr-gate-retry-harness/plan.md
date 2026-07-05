# BOXP-54 PR gate retry harness plan

## Goal

Task Board runner の PR review gate が agent で修正可能な失敗を即 `Blocked` にせず、同じチケットの Codex run へ修正指示として再投入できるようにする。

## Plan

- 現行 runner の PR gate と lane 遷移を確認する。
- PR gate 失敗を retry 可能 / human blocker に分類する。
- retry 状態を `/home/boxp/.codex-task-board/state.edn` に保存し、同一 PR/gate/reason の連続失敗上限を設ける。
- retry prompt に PR URL、gate、失敗理由、前回 run の summary/log 参照、期待する完了状態を含める。
- runner 実装、black-box test、仕様文書を更新する。
- focused test を実行し、draft / codex-review finding / 上限到達 / gate 通過を検証する。
