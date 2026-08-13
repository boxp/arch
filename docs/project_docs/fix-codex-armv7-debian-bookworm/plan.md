# codex armv7 クロスビルドの APT 404 再発修正

## 背景

Ubuntu ベースで amd64 の archive と armhf の ports を混在させる方式は、ベース側に
残った別 release の source が `dpkg --add-architecture armhf` の対象になり、armhf
index の 404 が再発した。前回の Ubuntu 20.04 tag/digest 固定だけでは防げなかった。

## 計画

1. Ubuntu 固有の APT source 書換えを廃止し、実機と同じ glibc 2.36 の Debian
   bookworm-slim をクロスビルド母体にする。
2. Cross.toml と workflow の image 名、README、Renovate の tag 制約を同期する。
3. Docker image をローカルで build し、armhf cross compiler と V8 用ツール、
   glibc 2.36 を確認する。
4. actionlint（shellcheck 込み）と ghalint を実行し、workflow を検証する。

## 非対象

- V8/codex 本体の長時間クロスビルド
- Git commit、push、PR 作成、GitHub Actions の実行・監視
