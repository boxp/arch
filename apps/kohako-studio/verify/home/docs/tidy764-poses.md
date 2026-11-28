# tidy764-poses.mjs（BOXP-764）

手を前でそろえるしぐさの試作候補 `tidy-5ba170b` の形を決める時に使った比較の道具です。BFF は完全にモック（token 不要）、時計を止めて進めます。準備（候補の build と Playwright のサーバー）は [tidy764-frames.md](tidy764-frames.md) と同じです。

- 実行: `node tidy764-poses.mjs <dist>/kohako <out.png> '<JSON>'`。JSON は腕セット `{label, right:{up,fo,ha,haS,art}, left:{...}}` の配列。
- 待機しぐさを止めた家で、腕セットを順に当て（0.7 秒待って描く）、手元を 1 枚に並べます。`BOX=x,y,w,h`（頭の幅・高さを単位）で範囲、`FW`・`COLS` で並べ方、`PW_WS` で接続先。
- 検証メディアは vault に置きません（`/home/boxp/verification-artifacts/<TICKET>/<label>/`）。
