# kohako-v41（不採用）

BOXP-441 TD-29。公式 Cubism Core は不使用。最新は v38 のまま。

目の画像生成 1/1 は参照6枚が組込み image_gen の上限5枚を超えたため入力検証で失敗し、画像なし。失敗も回数に含め、再生成していない。口の生成 1/1 は成功。参照上限に収めるため v38 の口 crop と v17 口素材を1枚にまとめて添付した。元画像を別々に添付したわけではない。生成物・全文プロンプト・ハッシュは vault の `live2d/gen/provenance.md` を参照。

生成口は閉口素材より上唇線の弧が浅く、口角も異なる。試作 A はこれを ECC で胸像に位置合わせして既存の開口メッシュ画像へ差し替える。中間専用レイヤーではなく、全開時にも影響する検証用試作である。目の新素材がないため目の統合は行っていない。したがって採用条件を満たさず、p2lrt は試作出力としてのみ保持する。

## 再現

まず v38 `build.sh` を実行し SHA-256 `f576b58d66cf402ecef85cb5209052cc83c30d2ee8a40cd0d08e6a6cca88a260` を確認。指定の WORK / OUT と生成口画像を用いて以下を実行する。固定 digest の Docker イメージ、ローカル MCP、ポート 18767 共通ロックを使用。MCP サーバーは `--log-driver none`。描画は静止ポーズで物理を含む時系列ではない。

```sh
WORK=/home/boxp/b441work/work OUT=/home/boxp/b441work/td41/out \
MOUTH_ASSET=/home/boxp/Documents/obsidian-headless/BOXP/Projects/kohako-openamika-ui/live2d/gen/codex-mouth-slight-v41-1.png \
./apps/kohako-studio/rig/kohako-v41/build.sh
```

残り: 半開き目素材の取得、口の上唇と口角を固定した中間専用レイヤーの実装、全開度と姿勢における連続性、物理を含む動画の検証。

## 評価

実描画の正面では 0.04 に二重線が残り、1 の口は v38 より浅い。静止比較は目 1 / 0.75 / 0.5 / 0.3 / 0.15 / 0.1 / 0、口 0 / 0.04 / 0.1 / 0.25 / 0.5 / 1、それぞれ正面・AngleX ±30・AngleY ±20。比較画像の上段が v38、下段が試作、左端が原画。素材比較も Web に掲載。

変更箇所は `mouth_open.png` のみだが、別々にビルドした全身描画を比較すると矩形外差分があった。目評価の矩形 canvas x=250〜560, y=130〜310 を除き 50,162 画素、最大チャネル差 255。口評価の矩形 x=300〜500, y=240〜340 を除き 64,830 画素、最大チャネル差 65。各値は5姿勢・全開度の累計であり、原因未特定。退行条件を満たさない。髪・肩のスクリプトと設定には手を加えていないが、描画に差がないとは言えない。

- 試作 p2lrt SHA-256: `cfb629887e2d29519efe2a27a308d411cbe21b7100434d472e0a300d0285f48b`（export losses `[]`）
- 口生成物 SHA-256: `cd191064bffe83ffa8514d7bf159f3cb67b3c0d3c5481c0d5d2ff3f9dccb58d0`
- v38 の同条件基準描画は別の OUT にマスクを置き、同じ build に `V41_BASELINE=1` を渡して取得。基準出力の p2lrt SHA-256 は v38 と同じ。
- `compare.py BASE_OUT CANDIDATE_OUT BUST DEST` で比較画像と差分 JSON を生成（Pillow / NumPy が必要）。OUT の各値は `v41/out` ディレクトリ。
