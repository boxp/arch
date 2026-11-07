# v31: 髪輪郭ゴーストの除去試行（不採用）

画像生成 0 回、公式 Cubism Core 不使用。v30 の body には長髪の切り抜き後、低 alpha の髪輪郭が残っていた。`fix_ghost.py` は v30 の肩修正後に、髪マスクを 7px 拡張した範囲で alpha 1〜159 かつ alpha 160 以上の画素から 3px より離れた画素を透明化する。正規の輪郭に接する画素は保護する。

`WORK=... OUT=... ./build.sh` で再現する。v30 の再ビルド SHA-256 は `03a4d4ec3cae8833d63f1fb4eef805597f75508a9058afe8fe87148b841f927d`、v31 は `7f3aedc3de62f429c852effc0b44c847f3a7c46c90d1dd1298b540ecf57b3d3d`。compiler 3.7.0、loss 0。差分は 2,883 画素で全て髪マスクから 7px 以内、RGB と alpha 160 以上の画素の変更は 0。

nat / det を v30 と同じシナリオで OVERRIDE_P2LRT により録画。左肩・髪内部の拡大では点線が残るため不採用。右肩と大きな首振りの全体では、明瞭な輪郭欠け・白縁・目口の退行は見られなかった。sampled frame の時刻とパラメータは多少ずれる。比較画像は `web/public/kohako/live2d/compare/kohako-v31-{left,right,det}.jpg`。body 輪郭近傍に残る断片や別レイヤーの寄与は未特定で、次の調査が必要。v30 を既定のままとし、v31 p2lrt は配備しない。
