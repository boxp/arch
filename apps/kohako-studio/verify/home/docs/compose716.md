# compose716.mjs（BOXP-716）

`compose716.mjs` は、`keshin716.mjs` の録画を、左に通常版の家・右に Keshin2D の試作として並べた mp4（H.264、音なし）にします。ffmpeg と ffprobe のある環境で `node compose716.mjs <keshin716.mjs の出力先>`。

- 録画の伸び（ソフトウェア描画では実時間より長く録れる）を `meta.json` の閉じるまでの実時間から直し、通常の速さにする。
- 台本 A・スマホは送信の時刻、台本 B は座り切った時刻をそろえる。
- PC は人物のいる左 600x800、スマホは 390x844 の全体を切り出す。出力は `01-idle-talk.mp4`・`02-seated-look.mp4`・`03-phone-idle-talk.mp4`（候補の一覧の録画）。
