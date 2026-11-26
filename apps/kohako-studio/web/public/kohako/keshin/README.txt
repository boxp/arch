BOXP-716: Keshin2D（https://github.com/rotejin/Keshin2D 、commit 028bd9a61c1f65f2b73f2a41460ba01eb9221dee、MIT License = LICENSE.txt）を、
コハコの試作候補（本人限定の比較）のために同梱したもの。通常版の家では使わない。

- index.html・js/keyshape.js・js/lipsync.js は元のまま。
- js/avatar.js は、親の画面（keshin.html、同じ origin）から層の動き・絵・毎コマの処理を足す差し込み口と、台本から動かすための window.__k2d を足した
  （「BOXP-716」の印のある 6 か所。親が KOHAKO_K2D を置かない時は元と同じ動き）。
- vendor/mediapipe（Web カメラ）は同梱しない。カメラの動かし方は使えない。
- models/kohako/ は、コハコ v11r（kohako-full-v11r.p2lrt）の層を、画像生成なしで取り出して Keshin2D の座標へ写したもの。
  座り姿の絵は ../live2d/seat/ の BOXP-702 の素材をそのまま参照する。仕様は vault の Projects/kohako-home/keshin2d-trial-716.md。
