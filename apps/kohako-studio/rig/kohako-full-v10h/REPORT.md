# BOXP-441 full-v10h

**担当自己評価: 未受入・比較候補。** 静止 layout の頭部の内部穴を埋め、固定姿勢 9 種の頭部矩形内の背景露出は減った。ただし、動作中の細い背景線が残る。後ろ髪領域の拡張による変形や実機での見た目は未検証であり、Owner の受入判定ではない。

## 再現と補修

v10g を固定 digest の Python/JDK と psd2live `6fe868a20c7bf12586fa8ce0a05982f099faa865`、同梱 anchor patch で再構築し SHA-256 `f4080344c56850b8e8b42aa78a5276a3dbf52165ac0a58733e98cd07e27c737e` に一致。v10g 最終 layout を使用。v10h は `3f2b10813a6226dd099511fa6199f7c37b9d85dad22523fa0486726a52b686ef`。MCP はログ無効。back_hair は v10g の後ろ髪追従ワープの対象で、上部は頭に追従する設計。首は neck 層を使用。補修マスクを 3 px 膨張し、各層の既存不透明画素の最近傍色で補間。back_hair の矩形上端は y=261→204 に拡張したので、生成メッシュ・変形への副作用がありうる。

`holes.py` は rest で非表示の閉眼・半目・開口・笑顔差分を除外し、各画素で全可視層の alpha 最大値が 128 未満の領域を 4 近傍で連結し、キャンバス外周に接しない領域を列挙する。bbox は元キャンバス座標、両端を含む。2 px 以内の alpha ≥128 層を隣接層とする。全一覧は `before-holes.json`、`h1-holes.json`、`after-holes.json`。透明領域は必ずしも欠損ではなく、腕と体の間など意図的な背景も含む。

| 領域 | 面積 | bbox x1,y1,x2,y2 | 隣接層 | 処理 |
|---|---:|---|---|---|
| 頭部左 | 780 | 441,233,467,315 | back_hair、braid_right、hair_side_right、hair_front | H1 back_hair |
| 頭部右 | 173 | 658,290,671,316 | face、braid_left、hair_side_left、hair_front | H1 back_hair |
| 顔脇 | 120 | 626,364,630,389 | back_hair、body、neck、face、braid_left | H1 back_hair |
| 前髪近傍 | 6 | 616,207,618,209 | face、hair_front | H1 back_hair |
| 顎下 | 42 | 565,397,567,410 | neck、face | H2 neck |

初期は 139 領域・20,847 px。H1 のみで 135 領域・19,768 px、H2 後 134 領域・19,726 px。頭部 y<420 の上記 5 領域はすべて解消。残りは腕と長髪の間などの外形上の空間や細いスリットで、一律に塗るとシルエットを損なうため残した。最大 4 領域は 6,231、4,888、3,512、3,072 px。H1 で back_hair に 2,036 px、H2 で neck に 51 px を追加。顔・目・口・前髪・側髪の画像は v10g とバイト一致。桜飾りを含む他の画像も変更していない。

## 評価

419×555 stage の頭部矩形 x=96〜321、y=24〜216 の RGB が R,B>245、G<10 の画素。外側背景も含むので穴の面積そのものではない。固定パラメータは v10g と同じ。

| 姿勢 | v10g | v10h |
|---|---:|---:|
| rest | 18184 | 17991 |
| idle4 | 17670 | 17473 |
| idle10 | 16954 | 16718 |
| AngleX −20 | 18298 | 18130 |
| AngleX +20 | 18286 | 18100 |
| AngleZ −10 | 18563 | 18314 |
| AngleZ +10 | 18360 | 18088 |
| BodyAngleX −10 | 18483 | 18287 |
| BodyAngleX +10 | 18517 | 18314 |

通常背景の rest RGB 差分は 4,421 / 232,545 画素。素材としての前面層は不変だが、描画差分があるため全前面画素の不変は断言できない。差分には埋めた背景や後ろ髪メッシュ再生成の影響が含まれる。固定姿勢と動作で細いマゼンタ線が一部残る。

[固定姿勢比較](../../web/public/kohako/live2d/compare/kohako-full-v10h-background.jpg)、[通常背景の静止差分](../../web/public/kohako/live2d/compare/kohako-full-v10h-rest-difference.png)、[待機 15 秒](../../web/public/kohako/live2d/compare/kohako-full-v10h-natural-detail.jpg)、[考え中 15 秒](../../web/public/kohako/live2d/compare/kohako-full-v10h-thinking-detail.jpg)。動作比較は各 31 枚、約 0.5 秒間隔で v10g と v10h の実測時刻を表示。独立撮影のため姿勢の完全一致は保証しない。画像はすべて 1.5 MB 以下。

Web の typecheck、test（4 files / 30 tests）、build 成功。LATEST は kohako-v45 のまま。実機 GPU、Owner 確認、全動作におけるメッシュ被覆検証は未実施。画像生成、外部画像 API、Core 取得、push、PR、merge、配備は行っていない。
