# BOXP-253: llama-sycl image の llama.cpp revision 更新と PR 候補 image の実機検証

チケット: BOXP-253（local-llm Gemma4 追加高速化）。設計・測定の正本は Obsidian `Projects/local-llm-gemma4-optimization`。

## 背景

- live の `ghcr.io/boxp/arch/llama-sycl` は llama.cpp `8c146a83`（2026-06-29）でビルドされており、約 3.5 か月分の SYCL 改善
  （gemma4-26b-a4b 向け flash attention shape tune #28450、Q4_K MMVQ/ESIMD 改善、MoE 用 XMX GEMM、oneMKL FA prefill など 110 件超）を取り込んでいない。
- これまで PR ビルドは image を push しないため、新 revision を本番（`latest`）に流さずに実機 A/B する手段が無かった。

## 変更

1. `docker/llama-sycl/Dockerfile` と workflow の既定 `LLAMA_REF` を llama.cpp `v0.7.0`（`757cad021b357f417065ddbc41a6e8f87c1f8136`, 2026-10-15）へ更新。
2. `build-llama-sycl-image.yml`: 同一リポジトリからの PR では `pr-<番号>` / `sha-<短縮 sha>` タグだけを push する。`latest` と日付タグは従来どおり main のみ。fork PR は push しない。

## 検証手順

1. PR ビルドで push された `pr-<番号>` image を golyat-4 に pull し、live コンテナと同じ条件（同 model/量子化/ctx 262144/f16 KV/`-ub 2048`）で
   候補 `llama-server` を隔離起動して pp512/tg128/pp2048/tg32@2048 と品質 probe（日本語/算数/列挙/要約）を 3 反復で計測、現行 revision の base と比較する。
2. 改善が再現し品質退行が無い場合のみ merge。merge 後は `latest` 更新 → local-llm Pod の rollout → live digest/args 確認 → Service 経由の同条件 after 計測で確認する。
3. 退行・エラー時は merge せず、`LLAMA_REF` を現行値に戻す（この PR を close）。

## 影響範囲

- image を使う local-llm（gemma4-26b / gemma4-26b-vision / ornith-35b）。モデル・量子化・context・起動引数は変更しない。
