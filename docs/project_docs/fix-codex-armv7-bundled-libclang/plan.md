# codex armv7 rusty_v8 bindgen 失敗の修正計画

## 背景

v8 crate 150.4.0 の `build.rs` は、V8 のソースビルド開始時に
`tools/rust_toolchain.py` を実行し、`v8/DEPS` が固定する Chromium Rust
toolchain を `third_party/rust-toolchain` へ展開する。その Linux archive には
`lib/libclang.so` が含まれており、手元の実体は LLVM 23 系で、V8 同梱 libc++ が
要求する Clang 21 以降に対応している。

一方、後続の `build_binding()` は `LIBCLANG_PATH` が未設定でも警告だけで続行する。
Debian bookworm の system libclang は V8 同梱 libc++ の builtin type traits を
解釈できないため、V8 本体の Ninja build が終わった後の bindgen で
`__libcpp_remove_reference_t` や `__decay_t` などを解決できず失敗している。
V8 本体用に別途ダウンロードされる Chromium clang が新しくても、bindgen が動的に
ロードする libclang の選択には反映されない。

## 変更方針

- V8 の sysroot 準備後、crate 自身の `tools/rust_toolchain.py` を先に実行する。
- 展開された `third_party/rust-toolchain/lib/libclang.so` の存在を確認し、その
  ディレクトリを `LIBCLANG_PATH` として後続 step に渡す。
- `cross` が環境変数をコンテナへ渡すよう `Cross.toml` の passthrough に
  `LIBCLANG_PATH` を追加する。
- system clang/libclang の追加や差し替えは行わず、v8 crate の `DEPS` と一致する
  toolchain を使う。code-mode、`codex-code-mode-host`、`V8_FROM_SOURCE=1`、および
  壁 1〜14 の対処は維持する。

## 検証

1. workflow に `actionlint`（shellcheck 込み）を実行する。
2. workflow に `ghalint run` を実行する。
3. `Cross.toml` と差分を確認し、`LIBCLANG_PATH` がクロスビルド環境まで渡ること、
   既存の壁への対処を変更していないことを確認する。

制約に従い、GitHub Actions のビルド実行・監視、commit、push、PR 作成は行わない。
