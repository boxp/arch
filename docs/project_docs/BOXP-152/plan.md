# BOXP-152: babashka を ARM32 native image として動かす

## 方針

- boxp/graal と boxp/llvm-project の fork で GraalVM LLVM バックエンドを ARMv7 hard-float に対応させる
- ビルドは IS01 と同じ Debian bookworm (glibc 2.36、32bit time_t) のコンテナで行う
- `.github/workflows/build-babashka-arm32.yml` を手動実行し、qemu-arm で Hello と babashka を検証する
- 失敗はそのまま失敗にする。別アーキテクチャや stock native-image への fallback、`continue-on-error` は使わない

## 検証範囲

- qemu-arm 上の `--version`、式評価、例外、スレッド、JSON、ファイル操作、GC
- IS01 実機は未検証。qemu の成功は実機の成功を意味しない

## 既知の制限

- 配列をモニタにした `synchronized` の高競合で停止する (2 スレッド 100 万回で再現)
- 実行ファイルが大きい (text 約 94MB、data 約 47MB)。RAM 204MB の IS01 では別途検証が必要
