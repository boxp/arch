# kohako-full-v5 試作

原画 SHA-256 と psd2live commit を検証し、ローカルで素材分割・legacy-standard rig・p2lrt 出力を行う。画像生成や公式 Cubism Core は使用しない。v4 の目は色で分割した虹彩メッシュに穴が生じるため、下側の目の層を虹彩の下にも残して被覆を試す。他の分割は v4 と同じ。目の変形・分離は自動処理であり品質は保証しない。

```sh
SOURCE=/path/to/gemini-fullbody-v0-1.jpg \
OUT=/absolute/path/to/output \
P2L=/path/to/psd2live \
GRADLE_CACHE=/path/to/gradle-cache \
./apps/kohako-studio/rig/kohako-full-v5/build.sh
```

`OUT/layout` と `OUT/out` は再生成時に消去される。共通 flock を用いて MCP ポートを直列化し、コンテナ名は一意でログを保存しない。必須の口 keyform、保存、出力の失敗は中断する。ポーズは静止描画であり物理シミュレーションではない。

Pillow、NumPy 環境で `python compare.py FULL4/out FULL5/out SOURCE OUT/comparison` を実行すると原画とポーズ比較を生成する。原画との差は描画を再標本化した RGB 平均絶対差で位置ずれや縮小の影響を含む。
