# codex を armv7 (32bit ARM) 向けにビルドする

IS01 (Sharp, ARMv7, Debian bookworm armhf) で codex を動かすためのビルド定義。

`@openai/codex` の公式配布は **linux-x64 と linux-arm64 のみ**で 32bit ARM が無い。
ソースは Rust なのでクロスコンパイルできるが、32bit 固有の壁が 3 つある。
アップデートのたびに手で直すのは現実的でないため、変換を自動化している。

## 32bit で踏む 4 つの壁

| 壁 | 内容 | 対処 |
|---|---|---|
| `pagable` | 32bit の想定サイズを **wasm32 の実測値 (12 usize)** で決め打ちしており、armv7 の実レイアウト (10 usize) と合わずビルドが止まる | 表明を wasm32 限定に緩めた複製を `[patch.crates-io]` で差し替える |
| `codex-linux-sandbox` | `libc::SYS_*` は 64bit では `i64`、**32bit では `i32`**。`i64` を要求する seccomp API と型が合わない | `libc::SYS_*` に `as i64` を付ける |
| **glibc** | `cross` の既定イメージは新しい Ubuntu ベースで **glibc 2.38/2.39** に対してリンクする。実機の Debian bookworm は **2.36** なので起動できない。かといって古いイメージにすると、今度は**ホスト側の glibc が古すぎて `aws-lc-sys` / `zstd-sys` の build script (x86_64) が起動できない** | **musl** を使う。静的リンクになり glibc に一切依存しない (実測で GLIBC 参照 0 件) |
| `openssl-sys` | upstream は musl 向けの `vendored` を **x86_64 と aarch64 にしか付けておらず armv7 が漏れている**。`Could not find openssl via pkg-config` で止まる | `core/Cargo.toml` に armv7 の指定を足す |

いずれも「64bit しか想定していないコード」で、32bit ARM が実質サポート外であることの現れ。

⚠️ `pagable` の表明を外している点は記録しておくこと。`assert_eq_size!` は
コンパイル時のサイズ確認のみで実行時の意味を持たず、`12` はこの表明以外の
どこでも使われていないことを確認済みだが、**素の codex とは別物**である。
`starlark` が実行時に異常を示すようなら、まずここを疑う。

## 成果物

`codex-armv7-<ref>.gz` (gzip)。展開して `/usr/local/bin/codex` へ置く。

⚠️ `.text` だけで約 188MB ある。IS01 の RAM は 204MB しかないため、
展開だけで数分かかる。転送は gzip のまま行うこと (87MB)。

## 手で作り直す場合

```sh
git clone --depth 1 https://github.com/openai/codex
cd codex/codex-rs
cp <このディレクトリ>/Cross.toml .
# 上の表の 4 つの変換を適用してから
cross build --release -p codex-cli --target armv7-unknown-linux-musleabihf
```
