# kohako-full-v4 試作

原画の SHA-256 と psd2live commit を検証し、ローカルで素材分割・legacy-standard rig・p2lrt 出力を行う。画像生成や公式 Cubism Core は使用しない。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v4/build.sh
```

`OUT/layout` と `OUT/out` は再生成時に消去される。共通 flock を用いて MCP ポートを直列化し、コンテナ名は一意でログを保存しない。`layout/parts-contact.jpg` と `counts.json`、各操作の結果とポーズを出力する。目口マスクは原画解像度で作り INTER_AREA で縮小する。目の分離と顔の補完は自動処理の試作であり品質は保証しない。

Pillow、NumPy、OpenCV 環境で `python diagnose.py OUT/layout SOURCE OUT/comparison` を実行すると目口の重ね合わせと alpha 連結成分を確認できる。`python compare.py FULL3/out FULL4/out SOURCE OUT/comparison` で原画とポーズ比較を生成する。原画との差は描画を再標本化した RGB 平均絶対差で位置ずれや縮小の影響を含む。
