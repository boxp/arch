# BOXP-152: babashka を ARM32 native image として動かす

## 方針

- boxp/graal と boxp/llvm-project の fork で GraalVM LLVM バックエンドを ARMv7 hard-float に対応させる
- ビルドは IS01 と同じ Debian bookworm (glibc 2.36、32bit time_t) のコンテナで行う
- `.github/workflows/build-babashka-arm32.yml` を手動実行し、qemu-arm で Hello と babashka を検証する
- 失敗はそのまま失敗にする。別アーキテクチャや stock native-image への fallback、`continue-on-error` は使わない

## 検証範囲

- qemu-arm 上の `--version`、式評価、例外、スレッド、JSON、ファイル操作、GC、配列モニタの高競合
- IS01 実機は未検証。qemu の成功は実機の成功を意味しない

## 既知の制限

- 実行ファイルが大きい (text 約 94MB、data 約 47MB)。RAM 204MB の IS01 では別途検証が必要

## 解決済みの不具合

- 配列をモニタにした `synchronized` の高競合で停止していた (2 スレッド 40 万回で 8 回中 7 回)。原因は `llc` に `+db` を渡しておらず、fence が qemu-arm で nop になる CP15 バリアに変換されていたこと。`dmb` を使うように直し、hello フェーズで競合テストを 10 回実行して回帰を検出する
- atomic read-modify-write の順序が monotonic だったため sequentially consistent に変更した。x86 上の qemu では差が出ないため、実機での確認は未実施
- 32bit 以下の volatile アクセスが LLVM 上で非 atomic だった。競合する非 atomic load の値は LLVM では未定義なので、`PLAIN` 以外をすべて monotonic atomic に変更した。hello フェーズで volatile long の tearing と volatile int の受け渡しを検査する
