# peteyes525.mjs（BOXP-525）

`peteyes525.mjs`（BOXP-525）は BFF を完全にモックし、PC（実マウス）と Pixel 7（CDP touch）で頭をなでたときの連続描画から、顔周りの青い瞳の画素数（variants510 と同じ指標）で閉眼と復帰を確かめる回帰検査です。なで中（押して動かして 0.7 秒以降）の全フレームが待機最大値の 15% 以下、離して 1.5〜3 秒の最大値が 60% 以上に戻ること、3 回の反復、取消（PC は押したまま描画面の外へ出す／Pixel 7 は touchcancel）で開くこと、hover・頭の tap・手の tap・ふれあい OFF・reduced-motion では閉じないこと、なで中も頭追従（headZ）が残ること、読み上げ中のなででも口形が動き続けることを検査します。`node peteyes525.mjs <build の dist> <出力先>`（Playwright 1.56.1、token 不要）。連続フレームの画像と `result.json` を保存し、失敗があれば終了コード 1 です。`petvisible.mjs` はなで中に目を閉じるようになったため、傾きを瞳の線ではなく頭全体の回転照合で測ります（瞳の線は `eyeTilt` として併記）。
