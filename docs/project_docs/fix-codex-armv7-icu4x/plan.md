# codex armv7 ICU4X ビルド失敗の修正計画

## 背景

`v8-150.4.0` crate は `third_party/rust/chromium_crates_io/vendor/` を配布していない。一方、V8 は既定で Temporal を有効にし、`temporal_capi` から ICU4X の Rust crate 群をビルドしようとする。この経路では欠落した `build.rs` を Ninja が要求して失敗する。

## 方針

- armv7 の V8 ビルドにだけ `GN_ARGS="v8_enable_temporal_support=false"` を渡す。
- `Cross.toml` のコンテナ環境へ `GN_ARGS` を passthrough する。
- `v8_enable_i18n_support` は有効のままとし、ICU4C のロケールデータ取得（壁 7）を維持する。code-mode は `Intl.DateTimeFormat` によるロケール書式化をテストしているためである。
- Temporal API は armv7 成果物では無効になる。upstream の code-mode グローバル一覧テストには `Temporal` が含まれるため、この差異を workflow コメントに残す。

## 検証

1. v8 crate の GN ファイルと build.rs から依存経路と `GN_ARGS` 転送を確認する。
2. actionlint（shellcheck 有効）と ghalint を実行する。
3. V8 全体のクロスビルドは実行しない。GN の入力・依存条件を静的に検証する。
