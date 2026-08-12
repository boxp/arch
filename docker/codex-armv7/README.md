# codex を armv7 (32bit ARM) 向けにビルドする

IS01 (Sharp, ARMv7, Debian bookworm armhf) で codex を動かすためのビルド定義。

`@openai/codex` の公式配布は **linux-x64 と linux-arm64 のみ**で 32bit ARM が無い。
ソースは Rust なのでクロスコンパイルできるが、32bit 固有の壁が 3 つある。
アップデートのたびに手で直すのは現実的でないため、変換を自動化している。

## 32bit で踏む 8 つの壁

| 壁 | 内容 | 対処 |
|---|---|---|
| `pagable` | 32bit の想定サイズを **wasm32 の実測値 (12 usize)** で決め打ちしており、armv7 の実レイアウト (10 usize) と合わずビルドが止まる | 表明を wasm32 限定に緩めた複製を `[patch.crates-io]` で差し替える |
| `codex-linux-sandbox` | `libc::SYS_*` は 64bit では `i64`、**32bit では `i32`**。`i64` を要求する seccomp API と型が合わない | `libc::SYS_*` に `as i64` を付ける |
| **glibc** | `cross` の既定イメージは新しい Ubuntu ベースで **glibc 2.38/2.39** に対してリンクする。実機の Debian bookworm は **2.36** なので起動できない。かといって古いイメージ (16.04 / 2.23) にすると、今度は**ホスト側が古すぎて `aws-lc-sys` / `zstd-sys` の build script (x86_64) が起動できない** | 実機と同じ **Debian bookworm (glibc 2.36)** の自前イメージを使う (`Dockerfile`) |
| `openssl-sys` | ターゲット (armhf) の OpenSSL が要る | 自前イメージに `libssl-dev:armhf` を入れる。Debian は amd64 と armhf を同じ repository から取得するため、Ubuntu の archive/ports 混在を避けられる |
| **`rusty_v8`** | `code-mode` は `codex-code-mode-host` を要し、それは V8 に依存する。armv7 の**プリビルドが無い** (404)。musl は build.rs が明示的に拒否する (`musl builds are only supported for x86_64 and aarch64`) | **`V8_FROM_SOURCE=1`** でソースからビルドする。V8 のソースは crate に同梱 (79MB) されており、V8 自体は 32bit ARM を正式サポートしている |
| **`v8_enable_sandbox`** | `codex-code-mode-runtime` がこの feature を有効化するが、sandbox は pointer compression を要求し、V8 の BUILD.gn が 32bit ARM を拒否する (`Sharing a pointer compression cage is only supported on x64, arm64, ...`) | armv7 のときだけ feature を外す。⚠️ **V8 のメモリ安全機構が 1 段減る** |
| **V8 の sysroot** | `build.rs` の `maybe_install_sysroot("arm")` が壊れている。①`install-sysroot.py` が受け付ける名前は `armhf` で `arm` は無効 ②探すパスが `debian_sid_*` と古い (現在は `debian_bullseye_*`) ③ホスト用ツールに要る `amd64` 側を入れない | ビルド前に `install-sysroot.py --arch=amd64` と `--arch=armhf` を明示的に実行する |
| **ICU のロケールデータ** | `third_party/icu/BUILD.gn` は armv7 に対して `data_dir="common"` を選ぶが、crate 配布では `common/` が空 (10.9MB あるため除外)。`ninja: error: '.../third_party/icu/common/icudtl.dat' missing` で止まる | Chromium の icu リポジトリから取得する。⚠️ `flutter_desktop/` や `chromecast_video/` にも `icudtl.dat` はあるが**ロケールを削った別データ**なので流用しない |

いずれも「64bit しか想定していないコード」で、32bit ARM が実質サポート外であることの現れ。

⚠️ `pagable` の表明を外している点は記録しておくこと。`assert_eq_size!` は
コンパイル時のサイズ確認のみで実行時の意味を持たず、`12` はこの表明以外の
どこでも使われていないことを確認済みだが、**素の codex とは別物**である。
`starlark` が実行時に異常を示すようなら、まずここを疑う。

## 成果物

`codex-armv7-<ref>.tar.gz`。`codex` と `codex-code-mode-host` の 2 本が入っている。
両方を `/usr/local/bin/` へ置く。**`codex-code-mode-host` が無いと code-mode が使えず
`failed to spawn code-mode host` になる**。

⚠️ `.text` だけで約 188MB ある。IS01 の RAM は 204MB しかないため、
展開だけで数分かかる。転送は gzip のまま行うこと (87MB)。

## 手で作り直す場合

```sh
git clone --depth 1 https://github.com/openai/codex
cd codex/codex-rs
cp <このディレクトリ>/Cross.toml .
# 上の表の変換を適用してから
V8_FROM_SOURCE=1 cross build --release --jobs 2 -p codex-cli -p codex-code-mode-host --target armv7-unknown-linux-gnueabihf
```

## ⚠️ 手元でビルドしないこと

V8 のビルドは重く、並列度を絞らないとメモリを使い切る。実際に手元の WSL を
クラッシュさせた。CI では `--jobs 2` に制限している。手で回す場合も必ず絞ること。
