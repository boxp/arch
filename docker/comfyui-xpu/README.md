# ComfyUI XPU

Intel Arc 140T 向けの PyTorch ネイティブ XPU / Level Zero イメージ。ComfyUI は v0.45.0、torch は 2.12.0+xpu、torchvision は 0.27.0+xpu に固定する（稼働中の SD.Next イメージと同じ版）。ComfyUI v0.45.0 は torchaudio を使わず、音声は PyAV で扱うため torchaudio は入れない。取得したソースのコミットは `/opt/comfyui-source-revision` に記録される。

`--base-directory /data` で起動し、`/data` に input、output、user と models を配置し、`/scratch` に一時ファイルとキャッシュを置く。両方とも UID/GID 1000 で書き込み可能なボリュームを用意する。カスタムノード、ComfyUI-Manager、パートナー API ノードは意図的に無効化している。

更新時は Dockerfile の `COMFYUI_REF` を変更し（workflow は既定でこの値を使う）、ビルド時の CPU テストと MiniMax H3 の検査を確認する。Renovate は Dockerfile のタグ更新を検出する。
