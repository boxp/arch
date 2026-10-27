# BOXP-336: lolice で Strata と大型 MoE モデルの実用性を現行 localllm と実機比較する

## 目的

- lolice（golyat-4: Core Ultra 9 285H / Arc 140T iGPU / RAM 93 GB 共有）で、Strata（https://github.com/Niko1221/Strata）を使うメリットがあるかを実機で検証する。
- 現行ハードウェアでは本来困難な人気の大型 MoE モデルを、実行可能性を gate したうえで試す。
- Strata は一時隔離 runtime（golyat-4 の static pod、127.0.0.1 のみ）で動かし、既存 localllm（`local-llm/llama-server`）の構成・既定モデルは変更しない。

## 前提（2026-10-27 UTC 実測）

| 項目 | 値 |
| --- | --- |
| CPU | Intel Core Ultra 9 285H（16 core、AVX-VNNI、AVX-512 なし） |
| GPU | Arc 140T iGPU（PCI 8086:7D51、i915、graphics 12.74）、Level Zero 1.28.2、compute-runtime 26.18、host oneAPI 2026.0 |
| RAM | 93 GB（swap 0）、Gemma4 loaded 時 used 39 / available 54 GB |
| Disk | NVMe YMTC PC411 2 TB、`/` 空き 1.2 TB、direct read 3.4〜4.5 GB/s |
| 現行 localllm | `llama-sycl@sha256:f74b5341`（llama.cpp b11669-620d2225c）router mode、`--models-max 1 -c 262144`、既定 gemma4-26b |
| 同居 | codex-workspace / hermes-agent / argocd 等が同一 node |

## 候補と gate

| 候補 | 判定 | 根拠 |
| --- | --- | --- |
| Qwen3.8-Flash-Next（ISTA-DASLab GSQ-RCO Q2_0、rev ed59f920、66.4 GB） | 試験 | Strata の Intel（SYCL）経路が対応する唯一の系統。experts 34 GB + PLE 表 28.8 GB（SSD 読み）。llama.cpp b11669 も qwen4exp / Q2_0 に対応 |
| DeepSeekV4.1-Flash-1017（763B、MIT） | 未試験 | Strata docs/INTEL.md「DeepSeek V4.1-Flash does not run on Intel」、engine は CUDA13 / HIP R9700 のみ。最小 IST-DAS 1.75 bpw でも 239 GB で RAM 93 GB を大幅超過 |
| Qwen3.6-35B-A3B | Strata 未試験 | Strata docs/QWEN36.md「The Intel Arc and Mac engines do not run it」 |

## 安全境界

- Strata の install.sh / setup.sh は実行しない。release v0.2.6 の SYCL engine tarball を SHA256SUMS で検証して展開、pack は `tools/iq_pack.py`（commit 4b9e05a2）を隔離 container 内で実行。
- 実行は golyat-4 の static pod（hostNetwork 127.0.0.1、memory limit、`/dev/dri`）。外部公開・credential・権限拡張なし。
- モデル格納先は既存運用の `/var/lib/local-llm/models/boxp336-strata/`（codex-workspace PVC は使わない）。llama.cpp と Strata は同じファイルを参照し複製しない。
- メモリ: node MemAvailable 20 GiB 以上を維持。15 GiB 未満で試験 pod を自動撤去する watchdog。Strata の UMA 自動 sizing（MemAvailable−6 GiB）は `STRATA_UMA_HEADROOM_GIB` と明示 `--expert-cache` で抑える。
- live の gemma4-26b は進行中の localllm run が無いことを確認した時だけ `/models/unload` し、試験後に 1 要求で再ロードして `/health` を確認する。

## 比較手順

1. 共通条件: 同一 GGUF（Flash-Next Q2_0）、ctx 32768、thinking off、temperature 0、同一 fixture / max_tokens。
2. llama.cpp b11669（live と同一 image digest）static pod で bench（cold / warm load、TTFT、prefill / decode、日本語・コード・長文・JSON・tool call の決定的 check、memory / IO）。
3. Strata engine 0.1.50 SYCL static pod で同じ bench。
4. 参考: 現行 gemma4-26b（live）を同じ fixture で測る（別モデルなので別表）。
5. 結果は Obsidian `Projects/strata-localllm-evaluation/` に記録（owner-summary.md と再現ノート）。

## 後片付け

- static pod・一時 config を撤去し、live `/health` と gemma4-26b loaded を確認。
- 取得したモデル・engine の保持/削除は owner-summary に明記（既存モデルは削除しない）。
- 恒久 localllm 登録・既定変更は本票では行わない（比較後の別判断）。

## 結果（2026-10-27 実施）

- Strata 0.1.50 SYCL（i915 公式経路）は、Arc 140T iGPU では約 60 token までの短い prompt しか処理できない。それより長い prompt（8.3k の長文、json_schema 付き、tools 付き）は batched prompt 経路で毎回 GPU が止まり（i915 `Fence expiration time out`）、engine が自己 abort して再起動する。prompt chunk を 512 にし、GDN / XMX kernel を無効にした緩和も 1 回試したが同じだった。上流 docs も integrated Arc は未試験としている。
- 同じ GGUF の Flash-Next Q2_0 での比較（中央値）: llama.cpp 全層 iGPU は decode 6.2 tok/s、8.3k cold prefill 176 s、合格 24/27。llama.cpp で expert を CPU に置く構成は 5.5 tok/s / 324 s / 24/27。Strata は 4.5 tok/s / 失敗 / 14/24 で、日本語出力に中国語の混入があった。
- 参考: gemma4-26b（live）は 14.3 tok/s、8.4k cold prefill 34.5 s、24/27。
- 判断: Strata は不採用。既定は gemma4-26b のまま。Flash-Next を localllm に登録するかは別票で判断する。
- 後片付け: static pod、watchdog、tunnel を撤去済み。gemma4-26b を再ロードし、`/health` が ok であることを確認した。取得物の保持と削除は Owner の判断に委ねる（vault の owner-summary に記載）。
- 詳細: Obsidian `Projects/strata-localllm-evaluation/owner-summary.md` / `reproduction.md`
