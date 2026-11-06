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

1. runnerの終端遷移(done/blocked)でカードとチケットに同一の新revisionを記録し、古いBoardの復旧を可能にする。ready継続やTODO保留は担当継続のため既存revisionを維持し、失敗遷移の復元時はカードrevを票のrevへ再整合する。
2. 重複カードの投影・移動・dispatchを停止する。
3. reconcile-doneで共有ロックを任意とし、vault外バックアップと置換後の読み戻しを追加する。共有ロックなしの置換は`mv --exchange`で置換された内容自体を照合し、最終確認後の並行書き込みを検出したら元へ戻して停止する（exchange不可かつ共有ロックなしは拒否）。

テストは終端revision、LWW復旧、重複、superseded、修復の両ロックモード・競合・再実行を確認する。

レビュー対応: rev::を持たない旧カードも、票がrev付きでdone/blockedかつカードの状態が異なり、票の担当が終端遷移時のboxpのままで、さらにそのカード行がrunner自身が以前置き換えたrev無し行(state root の superseded-card-lines に記録)と完全一致する場合は、古いBoardの復元の可能性があるため投影・dispatchを保留する。ただし同じlaneで同一行を手で作り直した再依頼とは区別できないため、カードも票も書き換えず警告のみ出す（再依頼をDone/Blockedへ戻さない）。laneやassignee・本文を変えた再依頼(Readyへの移動等)やhelper更新(rev付与)は従来どおり追従する。記録はlaneと行の組。

## codex-review P0 (late writer) 対応

- 置換用ファイルを vault内 `.task-board-repair-retained/` に作成し、交換前に監査へ `:retain-pending`（許容ハッシュ=置換後/置換前）を記録。交換で外れた旧Board inodeは削除せずその追跡済みパスに残る（交換直後の強制終了でも未追跡にならない）。完了時 `:retained`、未交換時 `:retain-cancelled` を記録。未完了pendingは以後の実行で許容ハッシュ一致と書込みfd保持者なしを確認し、不一致は `interrupted repair` で非0終了。
- 成功を返す前に、保持inodeへ書込みfdを持つプロセスが無くなるまで待って（既定30秒）再照合。判定はカーネルのread lease(F_SETLEASE F_RDLCK)で、non-dumpable等で/procからfd表を隠した同一UIDのwriterも検出する。lease不可の環境では/proc走査で判定し、fd表を検査できないプロセスは保持中扱い(fail-closed)。待機後も開かれている／遅延書込みがあれば旧inodeを交換でBoardへ戻し、各版保存・conflict監査・非0終了（更新が保持ファイルだけに残る成功を返さない）。
- 以後のreconcile-done実行（dry-run含む）で保持inodeを全件照合し、遅延書込み・欠落を検出したら非0終了。apply後は時間を置いたdry-runで読み戻す。（同一ホストから見えないwriter向けの残余対策）
