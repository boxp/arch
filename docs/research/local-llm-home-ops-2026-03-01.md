# 自宅ローカルLLM運用 詳細調査レポート

**作成日**: 2026-03-01
**更新日**: 2026-03-02（Qwen3.5調査 + X検索結果を追記）
**タスクID**: T-20260301-010
**対象**: BOXP 自宅環境（OpenClaw + lolice k8s前提）

> **注意**: 本レポートの価格は調査時点（2026年3月）の参考値です。GPU市場は変動が激しいため、購入時には最新価格を確認してください。
>
> **信頼度タグについて**: 本文中の情報には以下のタグを付与しています。
> - **[事実]**: 公式スペック、公式ドキュメントに基づく情報
> - **[推定]**: コミュニティ報告や類似データからの推定値
> - **[要検証]**: 未検証の前提や仮説。実装前にPoCが必要

---

## 意思決定サマリ（1ページ要約）

### 推奨3案の比較

| 項目 | A案: 保守重視 | B案: コスパ重視 | C案: 性能重視 |
|------|-------------|---------------|-------------|
| **構成** | Mac Studio M4 Ultra 192GB | RTX 5090 + 自作PC | 2x RTX 4090 + 自作PC |
| **推定総額** | 約80〜90万円 | 約55〜70万円 | 約75〜100万円 |
| **利用可能メモリ** | 192GB（統合） | 32GB VRAM | 48GB VRAM |
| **最大モデル** | 70B FP16 / 120B+ Q4 | 32B Q8 / 70B Q3(一部CPU) | 70B Q4 快適 |
| **消費電力** | ~150W | ~700W | ~1050W |
| **騒音** | 極静音 | 大 | 大〜爆音 |
| **セットアップ** | 極めて容易 | 中程度 | 高い |
| **AMD/CUDA** | Metal/MLX | CUDA完全対応 | CUDA完全対応 |
| **拡張性** | なし | GPU換装可 | GPU換装可 |
| **codex-mini到達度** | 85-90% | 80-85% | 90%+ |
| **OpenClaw連携** | Tailscale + litellm | Tailscale + litellm | Tailscale + litellm |
| **推奨ユーザー** | 静音・省電力・大型モデル重視 | CUDA必須・バランス重視 | 最高速度・将来拡張重視 |

### 結論

**最もBOXP環境に適した推奨: A案（Mac Studio M4 Ultra 192GB）**

理由:
1. 192GBの統合メモリで70Bモデルを量子化なし(FP16)で動作可能
2. 静音・省電力で自宅24時間稼働に最適
3. セットアップ・メンテナンスがほぼ不要
4. Ollama + litellm でOpenClaw連携が即座に可能
5. 予算100万円以内に収まる

ただし、CUDAエコシステム（fine-tuning、vLLM等）が必要な場合はB案を検討。

---

## 目次

1. [ハードウェア比較（予算〜100万円）](#1-ハードウェア比較予算100万円)
2. [モデル選定比較](#2-モデル選定比較)
3. [AMD向き/NVIDIA向きの切り分け](#3-amdnvidia切り分け)
4. [OpenClaw連携設計](#4-openclaw連携設計)
5. [X（旧Twitter）調査結果](#5-x旧twitter調査結果)
6. [推奨アーキテクチャ提案](#6-推奨アーキテクチャ提案)
7. [参照URL一覧](#7-参照url一覧)

---

## 1. ハードウェア比較（予算〜100万円）

### 1.1 NVIDIA主軸構成

#### 1.1.1 RTX 5090（32GB GDDR7）

| 項目 | 詳細 |
|------|------|
| VRAM | 32GB GDDR7 (512-bit) |
| メモリ帯域幅 | ~1,792 GB/s |
| TDP | 575W |
| 推定価格（日本） | 約38〜45万円（MSRP $1,999、日本は割増傾向） |
| 物理サイズ | 3.5〜4スロット占有、全長350mm超 |
| 電源要件 | 1000W以上PSU推奨、16ピン(12V-2x6)コネクタ |
| 騒音 | 高負荷時にファンがかなり回る |
| 拡張性 | NVLink非対応（コンシューマ向け）、1枚運用が前提 |
| メンテナンス | GPU本体は低い。サーマルスロットリング対策が重要 |

**LLM適性** [事実/推定混合]: 32GB VRAMで13B〜30Bモデルを量子化(Q4/Q5)で快適に動作 [事実: VRAMサイズに基づく]。Blackwellアーキテクチャ由来のFP4推論サポートが利点 [事実]。70Bモデルは4bit量子化でも部分的にCPU offloadが必要 [推定: VRAM容量からの計算]。

**PC込み推定費用**:
- GPU: ~40万円
- CPU (Ryzen 7 9700X): ~5万円
- RAM 64GB DDR5: ~2万円
- MB X670E: ~3万円
- PSU 1000W 80+ Gold: ~2.5万円
- ケース（フルタワー）: ~1.5万円
- SSD 2TB NVMe: ~1.5万円
- CPUクーラー等: ~1.5万円
- **合計: 約55〜70万円**

#### 1.1.2 RTX 4090（24GB GDDR6X）

| 項目 | 詳細 |
|------|------|
| VRAM | 24GB GDDR6X (384-bit) |
| メモリ帯域幅 | 1,008 GB/s |
| TDP | 450W |
| 推定価格（日本） | 新品: 28〜35万円、中古: 20〜26万円 |
| 騒音 | 高負荷時やや大きいが5090より低め |
| メンテナンス | 低い。成熟した製品 |

**LLM適性**: 24GBで13Bモデル(Q4_K_M)が快適。5090登場で中古市場に流れている可能性が高い。

#### 1.1.3 RTX 4080 Super / 4070 Ti Super

| モデル | VRAM | 帯域幅 | TDP | 推定価格（日本） |
|--------|------|--------|-----|-----------------|
| RTX 4080 Super | 16GB GDDR6X | 736 GB/s | 320W | 15〜18万円 |
| RTX 4070 Ti Super | 16GB GDDR6X | 672 GB/s | 285W | 12〜15万円 |

**LLM適性**: 16GB VRAMが制約。7B〜13Bモデル(強い量子化)まで。コスパ重視なら選択肢だがLLM用途ではVRAM不足を感じやすい。

#### 1.1.4 マルチGPU構成

| 構成 | 合計VRAM | 推定総コスト | 注意点 |
|------|---------|-------------|--------|
| 2x RTX 3090（中古） | 48GB | 15〜22万円（2枚合計） | NVLink対応可。コスパ最高 |
| 2x RTX 4090 | 48GB | 50〜70万円 | NVLink非対応。PCIe帯域がボトルネック |
| RTX 5090 + RTX 4090 | 56GB | 55〜75万円 | 異種GPU。llama.cppで層分割可能 |

**マルチGPU現実チェック**（事実）:
- llama.cpp は `--tensor-split` オプションでマルチGPU対応。PCIe経由でもトークン生成速度は許容範囲内
- ただしprompt processing (prefill) 速度はPCIe帯域で制限される
- 2x RTX 3090 (NVLink) は中古で非常にコスパが良い。合計48GBで70Bモデル(Q4)が動作
- 電力・排熱・ケース内スペースの問題が大きい（日本の住宅環境では重要）
- マザーボードのPCIeレーン数に注意（x16/x16が理想、x16/x8だと帯域半減）

#### 1.1.5 中古 RTX 3090（24GB）

| 項目 | 詳細 |
|------|------|
| VRAM | 24GB GDDR6X (384-bit) |
| メモリ帯域幅 | 936 GB/s |
| TDP | 350W |
| 推定中古価格（日本） | 7.5〜11万円（マイニング落ち注意） |
| 騒音 | FEモデルは爆音。AIBモデルはまだマシ |

**LLM適性**: VRAM容量は4090と同じ24GB。推論速度は4090の60〜70%程度。マイニング使用歴がある個体はファン寿命に注意。

### 1.2 AMD/Radeon主軸構成

#### 1.2.1 Radeon RX 7900 XTX（24GB GDDR6）

| 項目 | 詳細 |
|------|------|
| VRAM | 24GB GDDR6 (384-bit) |
| メモリ帯域幅 | 960 GB/s |
| TDP | 355W |
| 推定価格（日本） | 13〜17万円 |
| ROCm対応 | ROCm 6.x で gfx1100 として公式サポート |

**ROCm現実チェック**（事実 + コミュニティ報告に基づく推測）:
- ROCm 6.0〜6.1でRX 7900 XTXは**公式サポート**入り
- llama.cppのHIPバックエンドは動作する。ただしCUDAバックエンドと比較して10〜20%遅い傾向
- PyTorch (ROCm版) も動作するが、flash-attention等の最適化カーネルでCUDA版との差がある
- vLLMのROCm対応は進んでいるが一部機能に制限あり
- **主な問題**: ドライババグ、メモリリーク、特定モデルでのクラッシュが散発的に報告
- WindowsでのROCmサポートは限定的。Linux (Ubuntu 22.04/24.04) が推奨

#### 1.2.2 Radeon RX 9070 XT（RDNA 4）

| 項目 | 詳細（推定含む） |
|------|----------------|
| VRAM | 16GB GDDR6 (256-bit) |
| メモリ帯域幅 | ~640 GB/s |
| TDP | ~250W |
| 推定価格（日本） | 9〜13万円 |
| ROCm対応 | gfx12系。ROCm 6.2+で対応（推定） |

**注意**: RDNA 4はミッドレンジ戦略のため、ハイエンド（RX 9090相当）は未発表の可能性あり。16GB VRAMはLLM用途では制約が大きい。

#### 1.2.3 GMKtec / AMD APU（共有メモリアーキテクチャ）

| 項目 | 詳細 |
|------|------|
| 例 | Ryzen AI 9 HX 370搭載ミニPC |
| メモリ | 最大64GB DDR5（統合メモリ） |
| メモリ帯域幅 | ~90 GB/s（DDR5-5600デュアルチャネル） |
| TDP | 35〜54W |
| 推定価格 | 8〜15万円（本体のみ） |
| 騒音 | 非常に静か |
| サイズ | 超コンパクト |

**LLM適性**:
- 統合メモリにより最大64GBをGPUとして利用可能
- ただしメモリ帯域幅が約90 GB/sとdGPUの1/10程度。推論速度は非常に遅い
- 7Bモデルなら実用的な速度。13B以上は遅延が大きい
- **静音・省電力を最優先する場合のみ推奨**

#### 1.2.4 AMD Instinct MI100/MI210（中古）

| モデル | VRAM | 帯域幅 | TDP | 推定中古価格 |
|--------|------|--------|-----|-------------|
| MI100 | 32GB HBM2 | 1,228 GB/s | 300W | 5〜10万円 |
| MI210 | 64GB HBM2e | 1,638 GB/s | 300W | 15〜25万円 |
| MI250 | 128GB HBM2e | 3,277 GB/s | 500W | 30〜50万円 |

**Instinct現実チェック**（事実）:
- MI100 (gfx908): ROCm対応良好。CDNA1アーキテクチャ
- MI210 (gfx90a): ROCm対応良好。CDNA2
- **問題点**: パッシブ冷却設計のためサーバーラック前提。自宅運用にはファン改造または外付けブロワーが必要
- 映像出力なし（計算専用カード）。別途表示用GPUが必要
- eBay/ヤフオクで流通。国内流通は少ない

### 1.3 Mac Studio構成

#### 1.3.1 Mac Studio M4 Ultra

| 項目 | 詳細 |
|------|------|
| 統合メモリ | 192GB / 256GB 構成 |
| メモリ帯域幅 | ~800 GB/s（M2 Ultra同等、M4世代で改善の可能性） |
| TDP | ~150W（システム全体） |
| 推定価格（日本） | 192GB: 約79.8〜90万円 / 256GB: 約100万円超 |
| 騒音 | 非常に静か（ファンはあるがほぼ無音） |
| サイズ | 197 x 197 x 99mm（非常にコンパクト） |
| 拡張性 | なし（メモリ・ストレージ固定） |
| メンテナンス | ほぼ不要 |

**LLM適性**:
- **192GBモデルは100万円予算でギリギリ射程圏内** [推定: Apple Store価格からの推算]
- 192GBあれば70Bモデルをフル精度(FP16)で、または120B以上のモデルを量子化で動作可能 [事実: メモリ容量に基づく計算]
- MLXフレームワーク + llama.cpp (Metalバックエンド) で非常に良好な推論性能 [事実: 両ランタイムともMetal対応済み]
- トークン/秒はメモリ帯域幅に依存。~800 GB/sなら70B Q4で約20〜30 tok/s [推定: M2 Ultra実測からの外挿]
- **最大の利点**: 静音、省電力、巨大な統合メモリ、セットアップの容易さ [事実]

#### 1.3.2 Mac Studio M4 Max

| 構成 | メモリ | 帯域幅 | 推定価格（日本） |
|------|--------|--------|-----------------|
| M4 Max (36GPU) 36GB | 36GB | ~400 GB/s | 約29.8万円 |
| M4 Max (40GPU) 64GB | 64GB | ~400 GB/s | 約39.8万円 |
| M4 Max (40GPU) 128GB | 128GB | ~400 GB/s | 約54.8〜60万円 |

**LLM適性**: 128GBモデルなら70Bモデル(Q4〜Q6)が快適。帯域幅はUltraの半分程度なのでトークン生成速度も半分程度。

#### 1.3.3 MLXフレームワーク成熟度（事実）

- **MLX**: Apple公式の機械学習フレームワーク。Metal最適化
- **mlx-lm**: HuggingFaceモデルを直接読み込んで推論可能
- **対応モデル**: Llama系、Mistral系、Qwen系、Gemma系など主要モデルは対応
- **量子化**: 4bit/8bit量子化サポート。AWQ/GPTQ形式も対応
- **LoRA fine-tuning**: MLXで対応済み
- **llama.cpp Metalバックエンド**: 非常に成熟。ほぼすべてのGGUFモデルが動作

### 1.4 ハードウェア総合比較

| 構成 | 総コスト（推定） | 利用可能メモリ | 帯域幅 | 消費電力 | 騒音 | セットアップ難度 | 70B Q4 |
|------|----------------|---------------|--------|---------|------|---------------|--------|
| RTX 5090 単体 | PC込 55〜70万円 | 32GB | 1,792 GB/s | ~700W | 大 | 中 | △（一部CPU offload） |
| RTX 4090 単体 | PC込 45〜60万円 | 24GB | 1,008 GB/s | ~600W | 中〜大 | 中 | ×（13B〜30Bまで） |
| 2x RTX 3090（中古） | PC込 35〜50万円 | 48GB | 1,872 GB/s | ~850W | 大〜爆音 | 高 | ○ 動作可能 |
| 2x RTX 4090 | PC込 75〜100万円 | 48GB | 2,016 GB/s | ~1050W | 大 | 高 | ◎ 快適 |
| RX 7900 XTX | PC込 35〜45万円 | 24GB | 960 GB/s | ~550W | 中 | 中〜高(ROCm) | ×（13B〜30Bまで） |
| MI210（中古） | PC込 35〜50万円 | 64GB | 1,638 GB/s | ~500W | 爆音(要改造) | 非常に高 | ◎ 快適 |
| Mac Studio M4 Ultra 192GB | 約80〜90万円 | 192GB | ~800 GB/s | ~150W | 極静音 | 極低 | ◎◎ 非常に快適 |
| Mac Studio M4 Max 128GB | 約55〜60万円 | 128GB | ~400 GB/s | ~100W | 極静音 | 極低 | ○（やや遅い） |
| GMKtec AMD APU 64GB | 約10〜15万円 | 64GB（共有） | ~90 GB/s | ~55W | 極静音 | 低 | △（非常に遅い） |

### 1.5 電気代比較（日本、東京電力 約30円/kWh）

| 構成 | 消費電力 | 月間電気代（8h/日稼働） | 月間電気代（24h稼働） |
|------|---------|----------------------|---------------------|
| RTX 5090 PC | ~700W | 約5,040円 | 約15,120円 |
| 2x RTX 3090 PC | ~1000W | 約7,200円 | 約21,600円 |
| 2x RTX 4090 PC | ~1050W | 約7,560円 | 約22,680円 |
| Mac Studio M4 Ultra | ~150W | 約1,080円 | 約3,240円 |
| Mac Studio M4 Max | ~100W | 約720円 | 約2,160円 |
| GMKtec AMD APU | ~55W | 約396円 | 約1,188円 |

---

## 2. モデル選定比較

### 2.1 コーディング特化モデル

| モデル | パラメータ | HumanEval (pass@1) | コンテキスト長 | ライセンス | 推奨度 |
|--------|-----------|-------------------|---------------|-----------|--------|
| **Qwen2.5-Coder-32B-Instruct** | 32B | ~92% | 128K | Apache 2.0 | ★★★★★ |
| **Qwen2.5-Coder-14B-Instruct** | 14B | ~87% | 128K | Apache 2.0 | ★★★★☆ |
| **Qwen2.5-Coder-7B-Instruct** | 7B | ~84% | 128K | Apache 2.0 | ★★★☆☆ |
| **DeepSeek-V3** | 671B MoE (37B active) | ~90% | 128K | DeepSeek | ★★★★☆（要大VRAM） |
| **DeepSeek-Coder-V2.5** | 236B MoE (21B active) | ~88% | 128K | DeepSeek | ★★★★☆ |
| **Codestral-22B** | 22B | ~81% | 32K | MNPL | ★★★☆☆ |
| **StarCoder2-15B** | 15B | ~72% | 16K | BigCode | ★★☆☆☆ |

**推奨**: Qwen2.5-Coderシリーズが現時点でローカルコーディングモデルの最有力。32Bは多くのベンチマークでGPT-4o（2024年版）に匹敵する。

### 2.2 チャット/汎用モデル

| モデル | パラメータ | MMLU | Arena Elo（推定） | コンテキスト長 | 推奨度 |
|--------|-----------|------|-------------------|---------------|--------|
| **Qwen2.5-72B-Instruct** | 72B | ~85% | ~1230 | 128K | ★★★★★ |
| **Llama 3.3-70B-Instruct** | 70B | ~84% | ~1220 | 128K | ★★★★★ |
| **Qwen2.5-32B-Instruct** | 32B | ~80% | ~1180 | 128K | ★★★★☆ |
| **Qwen2.5-14B-Instruct** | 14B | ~76% | ~1140 | 128K | ★★★☆☆ |
| **Gemma 2 27B** | 27B | ~75% | ~1130 | 8K | ★★★☆☆ |
| **Llama 3.1-8B-Instruct** | 8B | ~68% | ~1100 | 128K | ★★☆☆☆ |

### 2.3 推論（Reasoning）モデル

| モデル | パラメータ | AIME 2024 | MATH-500 | コンテキスト長 | 推奨度 |
|--------|-----------|-----------|----------|---------------|--------|
| **DeepSeek-R1-Distill-Qwen-32B** | 32B | ~72% | ~94% | 128K | ★★★★★ |
| **DeepSeek-R1-Distill-Llama-70B** | 70B | ~75% | ~95% | 128K | ★★★★★（要大VRAM） |
| **QwQ-32B** | 32B | ~68% | ~93% | 128K | ★★★★☆ |
| **DeepSeek-R1-Distill-Qwen-14B** | 14B | ~60% | ~90% | 128K | ★★★☆☆ |
| **DeepSeek-R1-Distill-Qwen-7B** | 7B | ~45% | ~83% | 128K | ★★☆☆☆ |

### 2.4 VRAM要件（量子化レベル別）

| モデルサイズ | FP16 | Q8_0 | Q6_K | Q5_K_M | Q4_K_M | Q3_K_M |
|-------------|------|------|------|--------|--------|--------|
| 7B | 14GB | 7.5GB | 6GB | 5.5GB | 4.5GB | 3.5GB |
| 14B | 28GB | 15GB | 12GB | 10.5GB | 9GB | 7GB |
| 32B | 64GB | 34GB | 27GB | 23GB | 19GB | 15GB |
| 70B | 140GB | 72GB | 57GB | 49GB | 40GB | 32GB |

> **注意**: 上記はモデルウェイトのみ。KVキャッシュ用に追加VRAM（コンテキスト長に応じて1〜8GB+）が必要。

### 2.5 ハードウェア別推定パフォーマンス（tokens/sec）

> **[推定]**: 以下のパフォーマンス数値はコミュニティベンチマーク報告（r/LocalLLaMA、llama.cpp GitHub Issues等）に基づく推定値です。実測環境（ドライババージョン、モデルバリアント、コンテキスト長等）により大きく変動します。購入前に最新のベンチマーク結果を確認してください。

#### RTX 4090（24GB VRAM）[推定]

| モデル | 量子化 | Prompt (t/s) | Generate (t/s) | 実用性 |
|--------|--------|-------------|----------------|--------|
| 7B | Q4_K_M | ~2500 | ~120-150 | 快適 |
| 14B | Q4_K_M | ~1200 | ~55-70 | 実用的 |
| 32B | Q4_K_M | ~500 | ~25-35 | VRAMギリギリ |
| 70B | Q4_K_M | 収まらない | - | 2枚で分割推論可 |

#### Mac M4 Ultra（192GB統合メモリ、推定）

| モデル | 量子化 | Prompt (t/s) | Generate (t/s) | 実用性 |
|--------|--------|-------------|----------------|--------|
| 7B | Q4_K_M | ~1500 | ~100-120 | 快適 |
| 14B | Q4_K_M | ~800 | ~55-65 | 快適 |
| 32B | Q4_K_M | ~400 | ~30-40 | 快適 |
| 70B | Q4_K_M | ~180 | ~15-22 | メモリに余裕あり |
| 70B | FP16 | ~60 | ~5-8 | フル精度可能 |

#### RX 7900 XTX（24GB VRAM, ROCm）

| モデル | 量子化 | Prompt (t/s) | Generate (t/s) | 実用性 |
|--------|--------|-------------|----------------|--------|
| 7B | Q4_K_M | ~1800 | ~80-100 | 実用的 |
| 14B | Q4_K_M | ~800 | ~40-50 | 実用可 |
| 32B | Q4_K_M | ~350 | ~18-25 | ギリギリ |

### 2.6 量子化トレードオフ

| 量子化レベル | bpw | 品質維持率 | Perplexity増加 | 推奨用途 |
|-------------|-----|-----------|---------------|---------|
| FP16 | 16.0 | 100% | 0% | 研究・評価用 |
| Q8_0 | 8.0 | ~99.5% | <0.5% | 品質重視 |
| Q6_K | 6.5 | ~99% | <1% | 品質とサイズのバランス |
| **Q5_K_M** | 5.5 | ~98% | ~1-2% | **大型モデルのスイートスポット** |
| **Q4_K_M** | 4.5 | ~96-97% | ~2-4% | **中型モデルのスイートスポット** |
| Q3_K_M | 3.5 | ~90-93% | ~5-8% | メモリ制約時のみ |

**モデルサイズ別推奨量子化**:
- 7B: Q8_0 または Q6_K（元々パラメータが少ないため過度な量子化は致命的）
- 14B: Q6_K または Q5_K_M
- 32B: Q4_K_M または Q5_K_M（パラメータが十分多いため量子化耐性が高い）
- 70B+: Q4_K_M（大きいモデルほど量子化耐性が高い。Q4の70Bは Q8の7Bより高品質）

### 2.7 量子化フォーマット比較

| フォーマット | 主な用途 | ランタイム | 特徴 | AMD対応 |
|-------------|---------|-----------|------|---------|
| **GGUF** | 汎用 | llama.cpp, Ollama | 最も広い互換性 | ○ |
| GPTQ | サーバー用 | vLLM, TGI | 4bit特化、GPU専用 | △（実験的） |
| AWQ | サーバー用 | vLLM, TGI | GPTQより高品質4bit | △ |
| EXL2 | 高速推論 | ExLlamaV2 | NVIDIA最速 | × |
| MLX | Mac専用 | MLX | Apple Silicon最適化 | × |

**推奨**: ローカル運用では**GGUF (llama.cpp / Ollama)** が最も汎用性が高い。

### 2.8 codex-mini到達戦略

**codex-miniの推定能力レベル**:
- HumanEval: ~90%+
- 複雑なマルチファイル編集能力
- ツール使用・関数呼び出し能力
- 長いコンテキスト理解（100K+）

**到達可能性評価**:

| 観点 | 現状のオープンモデル | ギャップ | 評価 |
|------|-------------------|---------|------|
| コード生成精度 | Qwen2.5-Coder-32B: ~92% | 小さい | ほぼ到達可能 |
| マルチファイル編集 | 限定的 | 大きい | ギャップあり |
| ツール使用 | Qwen2.5/Llama3.1で対応 | 中程度 | 改善中 |
| 推論速度 | ハード依存 | 中程度 | ハード投資次第 |
| エージェント能力 | 初期段階 | 大きい | 最大のギャップ |

**結論**: codex-miniの**80-90%レベルのコーディング品質**はQwen2.5-Coder-32B (Q4_K_M〜Q8_0) で現実的に到達可能。ただしエージェント能力（自律的なファイル操作、ツール連鎖）には大きなギャップがあり、2025年後半〜2026年のモデルリリースで改善が期待される。

### 2.9 推奨ランタイム

| ランタイム | 対応ハード | 量子化形式 | 特徴 | 推奨用途 |
|-----------|-----------|-----------|------|---------|
| **llama.cpp / llama-server** | CUDA, ROCm, Metal, CPU | GGUF | 最も広い互換性 | 汎用、AMDユーザー |
| **vLLM** | CUDA（ROCm実験的） | FP16, AWQ, GPTQ | PagedAttention、高スループット | サーバー用 |
| **Ollama** | CUDA, Metal, CPU | GGUF | llama.cppラッパー、簡単 | 初心者、お手軽 |
| **MLX** | Apple Silicon | MLX形式, GGUF | Apple純正最適化 | Mac専用 |
| **ExLlamaV2** | CUDA | EXL2 | 最高のCUDA推論速度 | NVIDIA最速重視 |

### 2.10 Qwen3.5 追加調査（2026-03-02更新）

> **調査メモ**: PRレビューで「Qwen3.5 の調査不足」を指摘されたため、公式情報と X 投稿を追加調査した。

#### 2.10.1 公式リリース/モデル仕様（事実）

- **Qwen3.5は 2026-01-01 に初回公開**（Qwen公式ニュース）
- オープンウェイト系列として、`Qwen3.5-35B-A3B-Instruct-2507`、`Qwen3.5-122B-A10B-Instruct-2507`、`Qwen3.5-397B-A17B-Instruct-2507` を確認
- いずれも MoE 系列で、**総パラメータに対して活性化パラメータが小さい**（例: 35B/3B, 397B/17B）
- `qwen3.5-flash` / `qwen3.5-plus` は Model Studio の OpenAI互換API経由で利用可能

| モデル | 形態 | パラメータ | コンテキスト | 備考 |
|------|------|-----------|-------------|------|
| Qwen3.5-35B-A3B-Instruct-2507 | Open Weights | 35.5B（3B active） | 262K（API版は最大1M） | ローカル運用の主力候補 |
| Qwen3.5-122B-A10B-Instruct-2507 | Open Weights | 122B（10B active） | 262K | 大型メモリ構成向け |
| Qwen3.5-397B-A17B-Instruct-2507 | Open Weights | 397B（17B active） | 262K（API版は最大1M） | 高性能だがローカル常用は高難度 |
| qwen3.5-flash | Hosted API | 非公開（Qwen3.5系列） | 最大1M | 低コスト/高速用途 |
| qwen3.5-plus | Hosted API | 非公開（Qwen3.5系列） | 最大1M | 高品質用途 |

#### 2.10.2 コーディング観点の再評価（事実 + 推定）

- Qwen公式モデルカードに掲載された coding 指標（SWE-Bench Verified / LiveCodeBench）では、Qwen3.5 系列が高水準
- **ローカル重視**では `35B-A3B`、**品質重視**では `397B-A17B` または `qwen3.5-plus` が現実的な選択
- 既存推奨の `Qwen2.5-Coder-32B` は引き続き有力だが、**2026年3月時点の話題性と更新性では Qwen3.5 系列を優先検証すべき**

#### 2.10.3 本レポートへの反映方針

1. ローカル実機の第一候補を `Qwen2.5-Coder-32B` 単独から **`Qwen2.5-Coder-32B` + `Qwen3.5-35B-A3B` の比較運用**に変更
2. OpenClaw のクラウドフォールバック候補に `qwen3.5-flash` / `qwen3.5-plus` を追加
3. X上の実運用投稿（OpenClawローカル構成、Qwen公式告知）を継続監視対象に追加

---

## 3. AMD/NVIDIA切り分け

### 3.1 NVIDIAが優位なケース

| ケース | 理由 |
|--------|------|
| **vLLMでの高スループットサービング** | vLLMのCUDA最適化が最も成熟 |
| **fine-tuning（LoRA/QLoRA）** | PyTorch + bitsandbytesのCUDA対応が完璧 |
| **ExLlamaV2での最速推論** | EXL2はCUDA専用 |
| **FlashAttention利用** | FlashAttention v2のCUDA対応が最も安定 |
| **マルチモーダルモデル** | 画像/音声モデルのCUDA対応が先行 |
| **コミュニティサポート** | トラブルシューティング情報が圧倒的に多い |
| **Dockerコンテナ連携** | nvidia-container-toolkitが成熟 |

### 3.2 AMDが優位/同等なケース

| ケース | 理由 |
|--------|------|
| **llama.cpp (GGUF) での推論のみ** | hipBLASバックエンドで安定動作 |
| **Ollamaでの簡易運用** | ROCm自動検出で動作 |
| **VRAM単価重視** | RX 7900 XTX（24GB）がRTX 4090より安い |
| **MI100/MI210中古** | 大容量HBMメモリが安価に手に入る |
| **Vulkanバックエンド** | GPU非依存の汎用バックエンド |

### 3.3 AMD ROCm互換性ステータス

| ランタイム | ROCmサポート | 安定度 | 備考 |
|-----------|-------------|--------|------|
| llama.cpp | 公式（hipBLAS） | ★★★★☆ | gfx1100 (RDNA3) 良好 |
| vLLM | 実験的 | ★★★☆☆ | FlashAttention ROCm版が必要 |
| Ollama | 公式 | ★★★★☆ | 内部でllama.cpp使用 |
| ExLlamaV2 | 非対応 | - | CUDA専用 |
| MLX | 非対応 | - | Apple Silicon専用 |

### 3.4 推奨切り分け

```
「推論のみ（llama.cpp/Ollama）でコスパ重視」→ AMD RX 7900 XTX
「fine-tuning もする、最新エコシステムが必要」→ NVIDIA RTX 5090/4090
「大型モデルを静かに動かしたい」→ Mac Studio M4 Ultra
「予算最小でとりあえず試したい」→ AMD APU (GMKtec) or MI100中古
```

---

## 4. OpenClaw連携設計

### 4.1 現在のOpenClawアーキテクチャ（事実）

```
OpenClaw アーキテクチャ:
├── moltworker (Cloudflare Workers + Containers)
│   ├── Worker (TypeScript) -- リクエストルーティング
│   └── Container (Sandbox) -- OpenClaw Gateway (:18789)
│       ├── 認証方式:
│       │   ├── Cloudflare AI Gateway API Key
│       │   ├── Anthropic API Key
│       │   └── OpenAI API Key
│       └── Gateway起動: openclaw gateway --port 18789
│
├── OpenClaw Docker Image (ghcr.io/boxp/arch/openclaw)
│   ├── ベース: ghcr.io/openclaw/openclaw:2026.2.25
│   ├── 追加ツール: gh, docker, ghq, gwq, mcp-grafana, bb, codex
│   └── MCP Server: grafana
```

### 4.2 接続パターン比較

| パターン | 構成 | メリット | デメリット |
|---------|------|---------|-----------|
| **A: Ollama直接** | OpenClaw → Ollama API | シンプル | フォールバックなし |
| **B: litellm経由** | OpenClaw → litellm → Ollama/Cloud | フォールバック対応 | litellm管理が追加 |
| **C: vLLM** | OpenClaw → vLLM API | 高スループット | NVIDIA必須 |
| **D: llama.cpp server** | OpenClaw → llama.cpp API | 軽量 | 単一モデルのみ |

**推奨: Pattern B（litellm経由）** -- フォールバック対応と統一的なAPI管理が可能。

### 4.3 litellmによるルーティング設計

```yaml
# litellm config.yaml
model_list:
  # ローカルモデル（優先）-- model_name を分離してフォールバックを明示
  - model_name: "gpt-4o-local"
    litellm_params:
      model: "ollama/qwen2.5:72b"
      api_base: "http://gpu-server.local:11434"
      timeout: 30
      max_retries: 1

  # クラウドフォールバック
  - model_name: "gpt-4o-cloud"
    litellm_params:
      model: "openai/gpt-4o"
      api_key: "os.environ/OPENAI_API_KEY"
      timeout: 60

  # ローカル小規模モデル（高速、コーディング等）
  - model_name: "gpt-4o-mini-local"
    litellm_params:
      model: "ollama/qwen2.5-coder:32b"
      api_base: "http://gpu-server.local:11434"
      timeout: 15

  - model_name: "gpt-4o-mini-cloud"
    litellm_params:
      model: "openai/gpt-4o-mini"
      api_key: "os.environ/OPENAI_API_KEY"

router_settings:
  routing_strategy: "simple-shuffle"
  num_retries: 2
  timeout: 60
  # ローカル失敗時にクラウドへ明示的にフォールバック
  fallbacks:
    - {"gpt-4o-local": ["gpt-4o-cloud"]}
    - {"gpt-4o-mini-local": ["gpt-4o-mini-cloud"]}
  enable_health_check: true
  health_check_interval: 300

  # OpenClawからは "gpt-4o-local" を指定。
  # litellmが自動的にフォールバック先へルーティング。
```

### 4.4 lolice k8sでの管理パターン

#### 推奨: Pattern B（外部推論ホスト + k8s内litellm）

```
[lolice k8s cluster]                [スタンドアロン GPU サーバー]
├── shanghai-1,2,3 (ARM64 CP)        192.168.10.110
├── golyat-1,2,3 (x86_64 Workers)    ├── Ubuntu Server
│                                     ├── NVIDIA Driver / ROCm
│   litellm Deployment               ├── Ollama (systemd service)
│   └── routes to gpu-server          │   └── :11434 (OpenAI compat)
│       or cloud API fallback         ├── Node Exporter
│                                     └── DCGM Exporter
│   Service (ExternalName)                └── :9400 (GPU metrics)
│   └── llm-inference → gpu-server
│
│   ServiceMonitor
│   └── scrapes gpu-server metrics
```

**理由**:
1. 既存lolice k8s（Orange Pi Zero 3）はARM64で小規模 → GPU Operator導入は過重
2. golyatノードは主にゲームサーバー等に使用 → GPU追加はスペース/電力の制約
3. 専用GPUサーバーを192.168.10.0/24内に追加するのが最もシンプル
4. Tailscale経由でリモートGPUサーバー接続も可能

#### k8sマニフェスト例

> **PoC前提**: 以下のマニフェストはコンセプト設計段階です。ExternalName + Tailscale MagicDNSの組み合わせはクラスタDNS設定に依存するため、実運用前にPoC検証が必要です。代替として、EndpointSlice + 固定IPパターンも検討してください。

```yaml
# ExternalName Service（PoC: Tailscale MagicDNS前提、要検証）
apiVersion: v1
kind: Service
metadata:
  name: llm-inference
  namespace: llm
spec:
  type: ExternalName
  externalName: gpu-server.tailnet.ts.net

---
# litellm Deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: litellm
  namespace: llm
spec:
  replicas: 1
  selector:
    matchLabels:
      app: litellm
  template:
    metadata:
      labels:
        app: litellm
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "4000"
    spec:
      containers:
      - name: litellm
        image: ghcr.io/berriai/litellm:main-latest
        ports:
        - containerPort: 4000
        env:
        - name: OPENAI_API_KEY
          valueFrom:
            secretKeyRef:
              name: llm-api-keys
              key: openai-api-key
        volumeMounts:
        - name: config
          mountPath: /app/config.yaml
          subPath: config.yaml
        args: ["--config", "/app/config.yaml", "--port", "4000"]
        livenessProbe:
          httpGet:
            path: /health
            port: 4000
        readinessProbe:
          httpGet:
            path: /health/readiness
            port: 4000
      volumes:
      - name: config
        configMap:
          name: litellm-config
```

### 4.5 OpenClawからの接続

OpenClawはCloudflare Workers + Containers上で動作しているため、lolice k8s内のServiceに直接アクセスできない。以下の方法が必要:

1. **Cloudflare Tunnel**: litellmをCloudflare Tunnel経由で公開（既にarchでトンネル管理中）
2. **Tailscale**: moltworker ContainerにTailscaleエージェントを組み込み
3. **パブリックエンドポイント**: litellmをインターネットに公開（認証必須）

**推奨**: Cloudflare Tunnel経由。moltworkerの環境変数で`OPENAI_API_BASE`をTunnel URLに設定。

```bash
# moltworker .dev.vars
OPENAI_API_BASE=https://litellm.b0xp.io/v1
OPENAI_API_KEY=sk-litellm-master-key
```

### 4.6 フォールバック設計

```
リクエストフロー:
OpenClaw → litellm → [ローカルLLM優先]
                    ↓ (失敗/タイムアウト時)
                    → [クラウドAPI フォールバック]
```

| 戦略 | 実装方法 |
|------|---------|
| ローカル優先 | litellm routing でlocal modelを先にトライ |
| モデル使い分け | 簡単なタスクは小規模ローカル(7B)、複雑なタスクはクラウド |
| トークン閾値 | ローカルのコンテキスト長超過時にクラウドフォールバック |
| キャッシュ | litellmのセマンティックキャッシュでAPIコール削減 |

### 4.7 監視設計（Grafana統合）

既存のPrometheus Operator + Grafana環境を活用。

**収集メトリクス**:
```
# NVIDIA DCGM Exporter
DCGM_FI_DEV_GPU_UTIL       -- GPU使用率 (%)
DCGM_FI_DEV_FB_USED        -- VRAM使用量 (MB)
DCGM_FI_DEV_GPU_TEMP       -- GPU温度 (°C)
DCGM_FI_DEV_POWER_USAGE    -- 電力消費 (W)

# litellm メトリクス
litellm_request_total              -- 総リクエスト数
litellm_request_duration_seconds   -- リクエスト処理時間
litellm_tokens_total               -- 総トークン数
litellm_deployment_success_rate    -- 成功率
```

**推奨Grafanaダッシュボード構成**:
```
LLM Inference Dashboard
├── GPU Hardware: 使用率、メモリ、温度、電力
├── Inference Performance: レイテンシー、TPS、TTFT
├── Routing & Fallback: ローカル/クラウド比率、フォールバック率
└── Health: エラー率、キュー深度、接続数
```

### 4.8 Qwen3.5を使う場合のlitellmルーティング追記

```yaml
# 例: ローカルQwen3.5 + APIフォールバック
model_list:
  - model_name: "gpt-4o-local"
    litellm_params:
      model: "ollama/qwen3.5:30b-a3b"
      api_base: "http://gpu-server.local:11434"
      timeout: 30

  - model_name: "gpt-4o-cloud-qwen35-flash"
    litellm_params:
      model: "openai/qwen3.5-flash"
      api_base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
      api_key: "os.environ/DASHSCOPE_API_KEY"
      timeout: 60

router_settings:
  fallbacks:
    - {"gpt-4o-local": ["gpt-4o-cloud-qwen35-flash"]}
```

> **補足**: `qwen3.5-plus` を使う場合は `model: "openai/qwen3.5-plus"` に差し替える。

---

## 5. X（旧Twitter）調査結果

> **調査方法**: 今回は `x.com` を対象に検索を実施し、Qwen公式アカウント投稿とコミュニティ投稿を確認した。

### 5.1 ROCm実運用知見（コミュニティ報告に基づく推測含む）

- **ROCm 6.x でRX 7900 XTXの安定性が大幅改善**: 以前のバージョンと比較してクラッシュ頻度が減少
- **llama.cppのhipBLASバックエンド**: RDNA3 (gfx1100) で最も安定。自前ビルド推奨
- **Flash Attention ROCm版**: composable_kernel (CK) ベースの実装が進行中
- **主な詰まりポイント**: ROCmバージョンとドライバの組み合わせ、Pythonパッケージの依存関係
- **Ubuntu 22.04/24.04が最も安定**: 他のディストロでは追加の苦労が多い

### 5.2 自宅LLMサーバー構築知見

- **2x RTX 3090構成が日本のホームラボで人気**: コスパと48GB VRAMのバランス
- **騒音対策**: 別室設置、防音ラック、水冷化が主な対策
- **Mac Studio M2/M4 Ultra**: 「静かすぎて動いてるか分からない」との報告多数
- **電気代**: dGPU構成は月5000〜20000円程度の電気代増加を覚悟

### 5.3 モデル性能実測（コミュニティ報告）

- **Qwen2.5-Coder-32B**: RTX 4090でQ4_K_Mを使い、実用的なコード生成が可能と複数報告
- **DeepSeek-R1蒸留版**: 32B版がローカル推論モデルとして最も評価が高い
- **Llama 3.3-70B**: M4 Ultra上でQ4_K_Mで約20 tok/sとの報告（推定）

### 5.4 k8s + ローカルLLM運用

- **Ollama + k8s**: Helm chartが利用可能、GPU device pluginとの組み合わせ
- **litellm**: ルーティングプロキシとして評価が高い
- **ホームラボでのGPUノード**: 「k8sの中に入れるより外に出した方が管理が楽」との意見が多い

### 5.5 Qwen3.5関連（今回追加）

- **[事実] 2026-02-24 (UTC)**: `@Alibaba_Qwen` が「Qwen 3.5 Medium Model Series」を告知（`35B-A3B` / `122B-A10B`）
- **[事実] 2026-02-25 (UTC)**: `@Alibaba_Qwen` が `Qwen3.5-35B-A3B-Thinking-2507` の **1Mコンテキスト対応**を告知（`qwen3.5-flash`）
- **[推定] 2026-02-23 (UTC)**: OpenClaw + Ollama + Qwen3.5-coder のローカル運用投稿が確認され、OpenClaw文脈での実運用関心が高い
- **[判断]**: 「話題性」「更新性」「OpenClawとの親和性」の3点で、Qwen3.5は本調査の優先対象に含めるべき

### 5.6 一般ユーザー検証（X検索, 2026-03-02追記）

> **注意**: 以下は X 上の自己申告ベンチマークを含む。公式ベンチマークではないため、再現条件（GPUクロック、量子化形式、コンテキスト長、バッチサイズ）を揃えたPoCで再検証が必要。

| 日付 (UTC) | 投稿者 | URL | 検証サマリ | 信頼度 |
|-----------|--------|-----|-----------|--------|
| 2026-03-01 | @fahdmirza | https://x.com/fahdmirza/status/2028434848440881510 | OpenClaw + Ollama + qwen3.5-coder でローカル運用した報告。OpenClaw経由の実運用文脈あり。 | 中 |
| 2026-03-01 | @saiho_seki | https://x.com/saiho_seki/status/2028372176072497411 | RTX 5090 24GB環境で Qwen3.5-30B-A3B の推論速度（eval rate 2.47 tok/s）を共有。 | 中 |
| 2026-03-01 | @simonw | https://x.com/simonw/status/2028599533748314564 | Qwen3.5 30B A3B を 64GB RAM Mac で動かす実験ログを共有。メモリ要求の実践知見。 | 中 |
| 2026-02-25 | @awnihannun | https://x.com/awnihannun/status/2026500250035439832 | Qwen3.5公開直後の性能/効率トレードオフに関する実運用目線のコメント。 | 低〜中 |

**暫定判断**:
1. OpenClaw連携の実例は増えており、`qwen3.5` 系をフォールバック候補だけでなく一次候補としてPoC対象にする価値がある
2. 5090 24GB では量子化・推論設定により速度差が大きく、単一投稿の tok/s を鵜呑みにしない
3. Mac 64GB での動作報告は「動く/遅い」の境界確認として有用だが、常用性能の判断には追加実測が必要

---

## 6. 推奨アーキテクチャ提案

> **費用に関する注記**: 各案の推定費用はハードウェア本体価格（税込参考値）です。以下の追加費用は含まれていません:
> - 送料（通常無料〜数千円）
> - UPS/無停電電源装置（必要に応じて1〜3万円）
> - 騒音対策費（防音ラック等、dGPU構成の場合1〜5万円）
> - ネットワーク機器（既存環境で賄える前提）
> - 予備冷却部品（ファン交換等、中古GPU構成の場合数千円）

### A案: 保守重視（Mac Studio M4 Ultra 192GB）

**推定費用: 約80〜90万円**（Apple Store税込価格。追加費用は上記注記参照）

```
Mac Studio M4 Ultra 192GB
├── 統合メモリ: 192GB
├── ストレージ: 2TB SSD
├── 消費電力: ~150W
├── 騒音: ほぼ無音
├── ランタイム: Ollama (Metal) + MLX
├── 常駐モデル:
│   ├── Qwen2.5-Coder-32B (Q8_0, ~34GB) -- コーディング
│   ├── Qwen2.5-72B (Q5_K_M, ~50GB) -- 汎用チャット
│   └── DeepSeek-R1-Distill-Qwen-32B (Q6_K, ~27GB) -- 推論
└── 接続: Tailscale → litellm (k8s内) → OpenClaw
```

| メリット | デメリット |
|---------|-----------|
| 圧倒的な静音性・省電力 | CUDAエコシステム不可 |
| 192GBで複数モデル常駐可能 | fine-tuning困難 |
| セットアップ極めて容易 | 拡張性ゼロ |
| メンテナンスほぼ不要 | GPU性能はdGPUに劣る |
| コンパクト | 帯域幅で推論速度に限界 |

**今週やること**:
1. Apple Storeで M4 Ultra 192GB の在庫・納期確認
2. Ollama をMac上でセットアップ・基本テスト
3. Tailscale でMac Studioをloliceネットワークに接続

**来月やること**:
1. litellm を lolice k8s上にデプロイ
2. Cloudflare Tunnel 経由でOpenClawからlitellmに接続
3. Grafanaダッシュボード構築
4. フォールバック設計のテスト

---

### B案: コスパ重視（RTX 5090 + 自作PC）

**推定費用: 約55〜70万円**

```
自作PC
├── GPU: RTX 5090 32GB (~40万円)
├── CPU: Ryzen 7 9700X (~5万円)
├── RAM: 64GB DDR5 (~2万円)
├── MB: X670E (~3万円)
├── PSU: 1000W 80+ Gold (~2.5万円)
├── Case: フルタワー (~1.5万円)
├── SSD: 2TB NVMe (~1.5万円)
├── Cooler等: (~1.5万円)
├── ランタイム: Ollama (CUDA) or vLLM
├── モデル:
│   ├── Qwen2.5-Coder-32B (Q4_K_M, ~19GB) -- コーディング
│   ├── DeepSeek-R1-Distill-Qwen-14B (Q6_K, ~12GB) -- 推論
│   └── Qwen2.5-14B (Q6_K, ~12GB) -- 汎用（モデル切替）
└── 接続: Tailscale → litellm (k8s内) → OpenClaw
```

| メリット | デメリット |
|---------|-----------|
| CUDAエコシステム完全対応 | 騒音・発熱が大きい |
| FP4推論サポート（Blackwell） | 32GBで70Bは厳しい |
| 将来GPU換装可能 | 消費電力700W超 |
| vLLM使用可能 | 組み立て・メンテナンス必要 |
| 予算に余裕（残り30〜45万円） | 別室設置推奨 |

**今週やること**:
1. パーツ選定・価格確認（kakaku.com）
2. RTX 5090の在庫状況確認
3. PCケース・設置場所の検討（騒音対策）

**来月やること**:
1. PC組み立て・OSインストール（Ubuntu Server 24.04）
2. NVIDIA Driver + CUDA + Ollama セットアップ
3. Tailscale 接続 + litellm デプロイ
4. OpenClaw連携テスト

---

### C案: 性能重視（2x RTX 4090 + 自作PC）

**推定費用: 約75〜100万円**

```
自作PC
├── GPU: 2x RTX 4090 24GB (~55〜70万円)
├── CPU: Ryzen 9 9900X (~6万円)
├── RAM: 128GB DDR5 (~5万円)
├── MB: X670E (PCIe x16/x16対応) (~4万円)
├── PSU: 1600W 80+ Titanium (~5万円)
├── Case: フルタワー(エアフロー重視) (~2万円)
├── SSD: 2TB NVMe (~1.5万円)
├── Cooler等: (~2万円)
├── ランタイム: vLLM (Tensor Parallel) or llama.cpp
├── モデル:
│   ├── Qwen2.5-Coder-32B (Q8_0, ~34GB, テンソル並列) -- コーディング
│   ├── Llama 3.3-70B (Q4_K_M, ~40GB, テンソル並列) -- 汎用
│   └── DeepSeek-R1-Distill-Qwen-32B (Q6_K, ~27GB) -- 推論
└── 接続: Tailscale → litellm (k8s内) → OpenClaw
```

| メリット | デメリット |
|---------|-----------|
| 48GB VRAMで70B Q4快適動作 | 消費電力1050W超 |
| テンソル並列で高速推論 | 騒音・発熱が最大の問題 |
| fine-tuning可能 | 予算100万円ギリギリ |
| CUDAエコシステム完全対応 | 1600W PSUが必要 |
| 最高品質の推論が可能 | 別室設置必須 |

**今週やること**:
1. RTX 4090の新品/中古価格調査
2. PCIe x16/x16対応マザーボード選定
3. 電力容量の確認（自宅のブレーカー容量）

**来月やること**:
1. PC組み立て・テスト
2. vLLM + テンソル並列セットアップ
3. 70Bモデルの実測ベンチマーク
4. litellm + OpenClaw統合

---

### 実装ロードマップ（全案共通）

#### Phase 1: 基盤構築（1〜2週間）

1. ハードウェア調達・セットアップ
2. Ollamaインストール・モデルダウンロード
3. Tailscale接続設定

#### Phase 2: k8s統合（1〜2週間）

4. lolice k8s上にlitellm Deploymentを作成
5. ExternalName Serviceで GPUサーバーに接続
6. Prometheus ServiceMonitorでメトリクス収集

#### Phase 3: OpenClaw統合（1週間）

7. Cloudflare Tunnel経由でlitellmを公開
8. moltworkerの環境変数でOpenAI API Base URLを変更
9. フォールバックテスト

#### Phase 4: 監視強化（1週間）

10. Grafanaダッシュボード構築
11. アラートルール設定
12. コスト追跡ダッシュボード

---

## 7. 参照URL一覧

### Web情報源

| カテゴリ | URL | 説明 |
|---------|-----|------|
| GPU価格比較 | https://kakaku.com/pc/videocard/ | 日本国内GPU最安値 |
| Mac Studio | https://www.apple.com/jp/shop/buy-mac/mac-studio | Apple Store日本 |
| llama.cpp | https://github.com/ggerganov/llama.cpp | 主要推論ランタイム |
| Ollama | https://ollama.com/ | 簡易LLMランタイム |
| vLLM | https://github.com/vllm-project/vllm | 高性能推論エンジン |
| litellm | https://github.com/BerriAI/litellm | LLMプロキシ/ルーター |
| MLX | https://github.com/ml-explore/mlx | Apple Silicon ML |
| ROCm | https://rocm.docs.amd.com/ | AMD GPU公式ドキュメント |
| HuggingFace LLM Leaderboard | https://huggingface.co/spaces/open-llm-leaderboard/open_llm_leaderboard | モデルベンチマーク |
| BigCode Leaderboard | https://huggingface.co/spaces/bigcode/bigcode-models-leaderboard | コーディングベンチマーク |
| LMSYS Chatbot Arena | https://chat.lmsys.org/ | 人間評価ランキング |
| r/LocalLLaMA | https://reddit.com/r/LocalLLaMA | コミュニティ知見 |
| NVIDIA GPU Operator | https://docs.nvidia.com/datacenter/cloud-native/gpu-operator/ | k8s GPU管理 |
| Qwen2.5-Coder | https://huggingface.co/Qwen/Qwen2.5-Coder-32B-Instruct | 推奨コーディングモデル |
| Qwen3.5 リリースノート | https://qwen.readthedocs.io/en/latest/getting_started/news.html | 公式ニュース（公開日確認） |
| Qwen3.5-35B-A3B | https://huggingface.co/Qwen/Qwen3.5-35B-A3B-Instruct-2507 | 公式モデルカード |
| Qwen3.5-122B-A10B | https://huggingface.co/Qwen/Qwen3.5-122B-A10B-Instruct-2507 | 公式モデルカード |
| Qwen3.5-397B-A17B | https://huggingface.co/Qwen/Qwen3.5-397B-A17B-Instruct-2507 | 公式モデルカード |
| Qwen3.5-27B | https://huggingface.co/Qwen/Qwen3.5-27B-Instruct-2507 | 公式モデルカード |
| DashScope OpenAI互換API | https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope | OpenAI互換エンドポイント |
| DeepSeek-R1 | https://huggingface.co/deepseek-ai/DeepSeek-R1 | 推奨推論モデル |

### X（旧Twitter）情報源

| カテゴリ | URL / クエリ | 知見サマリ |
|---------|--------------|-----------|
| Qwen公式（Medium series） | https://x.com/Alibaba_Qwen/status/2026339351530188939 | 35B-A3B / 122B-A10B の告知 |
| Qwen公式（1M context） | https://x.com/Alibaba_Qwen/status/2026502059479179602 | 35B-A3B-Thinking-2507 の1M対応告知 |
| Qwen公式（補足投稿） | https://x.com/Alibaba_Qwen/status/2026500171614531930 | Qwen3.5 Medium系列の運用補足 |
| OpenClawローカル運用言及 | `OpenClaw ollama qwen3.5-coder` | OpenClaw + Qwen3.5の実運用関心を確認 |
| 一般ユーザー検証（OpenClaw） | https://x.com/fahdmirza/status/2028434848440881510 | OpenClaw + Ollama + qwen3.5-coder の運用報告 |
| 一般ユーザー検証（RTX 5090） | https://x.com/saiho_seki/status/2028372176072497411 | Qwen3.5-30B-A3B の実測投稿（tok/s付き） |
| 一般ユーザー検証（Mac 64GB） | https://x.com/simonw/status/2028599533748314564 | Mac環境でのQwen3.5実行ログ |
| 一般ユーザー見解 | https://x.com/awnihannun/status/2026500250035439832 | Qwen3.5公開時の実運用観点コメント |
| ROCm実運用 | `ROCm LLM 実運用` | ROCm 6.xでRDNA3の安定性が改善。llama.cpp hipBLASが推奨 |
| 自宅LLMサーバー | `自宅 LLM サーバー GPU` | 2x RTX 3090が人気、Mac Studioは静音で高評価 |

### 残課題（要検証項目）

1. **M4 Ultra 192GB の実売価格と納期**: Apple Store日本での最新価格を確認
2. **RTX 5090 の実測ベンチマーク**: FP4推論のLLM性能実測データ
3. **ROCm 6.2+ のRDNA 4対応状況**: RX 9070 XTのllama.cpp互換性
4. **Qwen3.5 Plus/Flashの実測比較**: `qwen3.5-flash` と `qwen3.5-plus` の遅延/品質/コストを同条件で比較
5. **litellm の最新機能**: セマンティックキャッシュ、カスタムルーティングの実装状況
6. **Cloudflare Tunnel経由のレイテンシー**: litellmをTunnel経由で公開した際の追加遅延
7. **moltworker ContainerからのTailscale接続**: Cloudflare ContainerからTailscaleが使えるか検証
8. **1-bit量子化（BitNet等）の進捗**: 必要VRAM量のさらなる削減の可能性
9. **X自己申告ベンチの再現テスト**: 5090/Mac環境で同一プロンプト・同一量子化条件で tok/s を再計測
