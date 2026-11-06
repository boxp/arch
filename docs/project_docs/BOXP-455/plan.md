# BOXP-455 修復計画

承認対象は433の重複表示だけ。元業務・grant・active票・lock台帳は変更しない。

1. Codex(dotfiles)とHermes(arch/PVC)の版と配布経路を照合する。
2. Hermes最新版helperに433限定のreconcile-done操作を追加。Done/boxpの既存カードを保持し、意味が一致する古いIn Progressカードだけ除く。期待rev・ticket/board/source/helper hashをdry-runとapplyに拘束する。
3. sourceのticket guard、既存vault writer/board/ticket lockを使う。共有writer lock未設定・active claim・不明なsource・parse不正・競合は拒否。Boardだけを原子的に置換し、票と完了日付を一切変更しない。
4. 隔離fixtureで正常・二重実行・競合・active・類似link・欠落・破損・root拒否を検証し通常CI/P0P1 gateを通す。
5. merge後にCodex入口とHermes image/PVCの実hash、全writerの共通lock利用を確認。必要な互換反映は独立worktreeで行う。画像更新だけでPVC配布済と扱わない。
6. 最新Owner/source再確認、433のみdry-run/apply/readback。432/425/active票の不変更を確認してProjects/task-board-state-reconciliationと454へ日本語で引き継ぐ。

実利用版: Codex helperはdotfiles 8075e31 (sha256 0ab419acff735dca70b91112ed8be3185e09114215b4645d6f2997b7fb85db38)。Hermes PVC/image入口はsha256 f221ff2b9d3d32b96bba1417e27ef72e010dea7530634da772cacd71d0e773af。arch作業treeをorigin/main 6e109685へ更新して既存guardを継承する。

## 第2段階

1. runnerの終端遷移でカードとチケットに同一の新revisionを記録し、古いBoardの復旧を可能にする。
2. 重複カードの投影・移動・dispatchを停止する。
3. reconcile-doneで共有ロックを任意とし、vault外バックアップと置換後の読み戻しを追加する。

テストは終端revision、LWW復旧、重複、superseded、修復の両ロックモード・競合・再実行を確認する。
