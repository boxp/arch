# BOXP-152 ARM32 native-image static library path

## 目的

ARM32 (arm-linux-gnueabihf) 向け native-image クロスコンパイル時に、クロス sysroot の C ライブラリ検索パスを明示して、static JDK ライブラリ検出後のリンク工程まで進める。

## 実施内容

1. ARMHF sysroot 内の static archive をワークフローログへ出力する。
2. `native-image` に `-H:CLibraryPath=/usr/arm-linux-gnueabihf/lib` を渡す。
3. GitHub Actions を手動実行し、static JDK library 要件に与える影響を確認する。

## 次の判断

このパス指定だけで `libjava.a`、`libnio.a`、`libnet.a` の不足が解消しない場合、`boxp/labs-openjdk` を ARM32 向けにクロスビルドして生成物を GraalVM image の `lib` へ供給する。
