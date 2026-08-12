# codex armv7 V8 generator 実行失敗の修正計画

## 背景

v8 crate 150.4.0 の `build.rs` は ARM32 クロスビルドで `target_cpu="arm"` と
`v8_target_cpu="arm"` を設定する。V8 の `snapshot_toolchain.gni` は snapshot と
generator をターゲットと同じ bit-width にするため、x64 ホストから ARM32 を作る
場合に `clang_x86_v8_arm` を選ぶ。この toolchain の `current_cpu` は `x86` であり、
`bytecode_builtins_list_generator` は i386 ELF としてリンクされる。

現在の Debian bookworm クロスビルドイメージには 32bit x86 ELF loader がない。
そのため generator の実体がビルドされても実行時の `execve(2)` が `ENOENT` となり、
Python からは `FileNotFoundError` に見える。また、V8 の i386 sysroot と lld で作った
C++ 実行ファイルを使った再現では、loader の次に i386 の `libstdc++.so.6` と
`libgcc_s.so.1` も必要になることを確認した。

## 変更方針

- クロスビルドイメージに Debian bookworm の `libc6-i386` と `lib32stdc++6` を追加し、
  amd64 ホスト上で V8 の i386 generator を実行できるようにする。
- workflow のイメージ検査で `/lib/ld-linux.so.2` を実際に起動し、32-bit の
  libstdc++/libgcc runtime も確認して、同じ欠落をクロスビルド開始前に検出する。
- Dockerfile の変更でも workflow が起動するよう `push.paths` に追加する。
- code-mode、`codex-code-mode-host`、`V8_FROM_SOURCE=1`、および壁 1〜13 の対処は
  維持する。

## 検証

1. クロスビルド用 Docker image をローカルで build する。
2. image 内で glibc 2.36、32bit x86 ELF loader、ARM hard-float cross compiler、
   V8 のビルドツールが利用できることを確認する。
3. workflow に `actionlint`（shellcheck 込み）と `ghalint run` を実行する。
4. 差分を確認し、既存の壁への対処が変更されていないことを確認する。

制約に従い、GitHub Actions のビルド実行・監視、commit、push、PR 作成は行わない。
