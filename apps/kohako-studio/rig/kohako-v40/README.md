# kohako-v40（不採用）

画像生成 0 回、公式 Cubism Core 不使用。v38 のまばたき途中と開眼時の縁を調べた。2 案とも不採用とし、Web の最新は v38 のまま。比較は psd2live MCP の静止描画であり、物理を含む動画や実ブラウザでの評価ではない。

## 原因と試行

v24/v25 は目の開度 0〜0.15 で開眼側（まつ毛・白目・虹彩）と v16 の閉眼素材を交差させる。v16 の閉眼素材は肌を含み、楕円状に alpha がすでにフェードしている。0.5 の問題はこの切替区間より上にも残る。入力の白目画像にも肌色とまつ毛が含まれるが、開眼時の多角形縁の原因は層単独描画では確定していない。

- A（切替）: 閉眼素材を 0.1〜0.12 で消し、開眼側を 0.12〜0.15 で現す。二重表示を避けるが、0.12 で両目の線が消え、0.11 / 0.13 でも薄い。0.5 と開眼の縁は残る。不採用。
- B（羽状化）: 白目画像の透明外周から 4px の alpha を減らす。開眼時に虹彩周辺の明るい切れ目が生じ、0.5 の肌境界も残る。目元外の差分も発生し、不採用。なぜ他領域に差が出たかは未特定。

7 開度（1 / 0.75 / 0.5 / 0.3 / 0.15 / 0.1 / 0）× 正面、X ±30、Y ±20 の静止比較。原画・v38・候補を同倍率で切り出した画像を Web の v40 比較に掲載。A の追加画像は 0.1 / 0.11 / 0.12 / 0.13 / 0.15。全身シート上で canvas x=250〜560, y=130〜310 の目元矩形を除き、RGB 差分を集計すると、A は変更 10,767 画素中、矩形外 0 画素。B は変更 630,993 画素中、矩形外 357,938 画素、最大チャネル差 255。5 姿勢×7 開度の累計であり、髪の動きの時系列検証ではない。髪・口のスクリプトや設定を変更していないが、B の矩形外差は退行条件を満たさない。

## 再現

指定の v38 ビルドを実行し、`OUT/v29-mask.png` を用意する。Python 3.12 用 numpy 2.5.4、Pillow 13.0.0、opencv-python-headless 5.0.0.93 をあらかじめオフラインで用意したディレクトリを `PY_DEPS` に指定する。固定 digest のローカル Docker イメージと MCP を使い、共通ロックでポート 18767 を直列化する。MCP サーバーは `--log-driver none`。

```sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td40/out PY_DEPS=/home/boxp/b441work/td40/python-deps ./apps/kohako-studio/rig/kohako-v40/build.sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td40/out PY_DEPS=/home/boxp/b441work/td40/python-deps ./apps/kohako-studio/rig/kohako-v40/build-feather.sh
```

A は `OUT/v40/out`、B は `OUT/v40b/out`。`compare.py` は A の before40 と各案の after40 の PNG/JSON、原画と保存先を引数に取る。B の比較では A の before40 一式を B の出力にコピーしてから使う。

- v38 再構築 SHA-256: `f576b58d66cf402ecef85cb5209052cc83c30d2ee8a40cd0d08e6a6cca88a260`（指定値一致）
- A p2lrt SHA-256: `48c74ab6e1750833a9de0ac4327c05d26fb023a1535fa9a713a1a63fb6e6009e`
- B p2lrt SHA-256: `f95601504de07ccb7af6c7bcf8fbe93f1055302f78daa01ad5f1c8f46466b05a`

残り: 白目・虹彩・閉眼パッチの層単独描画による開眼縁の特定、肌下地の境界をまぶたの変形へ追従させる修正、自然な切替と動画検証。今回の案では未解決。
