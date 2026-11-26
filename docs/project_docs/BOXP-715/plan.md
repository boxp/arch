# BOXP-715: コハコの声候補に Drama-3-Japanese を追加して AivisSpeech と聴き比べる

## 目的

既定の声（AivisSpeech コハク／ノーマル）はそのまま、家（kohako-home）で本人だけが選べる試用の声として Drama-3-Japanese を加え、同じ文での比較音声と試用入口を用意する。

## 出所と利用条件（2026-11-26 確認）

- モデル: `StudioYebisu-ship-it/Drama-3-Japanese-speech-cpp-gguf` rev `cca4c0d8`（GGUF 変換）← `Aratako/Drama-3-Japanese` rev `e3762feb`（日本語 LoRA ファインチューン）← `fishaudio/drama-3`
- ライセンス: Fish Audio Community License 1.0。個人・非商用は無償。第三者が自分の文で生成できる Hosted Service は不可（本人限定・自アプリのアシスタント発話は対象外と明記）。「Built with Fish Audio」の表示義務。実在人物の声の無断模倣禁止。
- 実行系: speech.cpp v0.11.2（MIT）公式 linux-x64-cpu リリース。HF 配布のパッチは使わない（未改変の Q4_K は公式版で動く）。
- 参照音声: コハク（ACML 1.0）の出力や第三者の録音は複製元にしない。モデル自身の声設計（日本語の説明＋固定 seed）の出力を一度だけ声ファイル化し、全文を同じ声にする。

## 方式

- lolice: `kohako-studio-drama3`（golyat-4、CPU 8 まで、GPU 不使用）。初回起動でリリースとモデル（22.4GB）を sha256 検証つきで PVC に取得し、声ファイルを作って `speech serve`。BFF からのみ到達。
- メモリ: 常駐約 24GB に対し golyat-4 の空きは 7 日最小 25GB。request を小さくし負の PriorityClass（preemption なし）で、圧迫時は試用声が先に退く。落ちたら BFF は `tts_voice_unavailable` を返し、端末で既定の声に戻せる。
- arch BFF: `/kohako/api/v1/tts` の body に `voice: 'drama3'` を受け、speech.cpp の `/v1/audio/speech` へ。owner/verifier のみ。キューは声ごとに同時 1・待ち 4。
- arch web: 設定「読み上げの声」に「Drama-3（試用）」。既定はコハクのまま。注記に Built with Fish Audio。

## 仕様

vault `Projects/kohako-home/tts-trial-voice-spec.md`。状態遷移の新しい規則はなく（既存キューの流用）、Lean モデルは作らない。

## 検証

1. CI / codex review → lolice と arch を merge・配備
2. 配備後、verifier 経路で同じ 3 文（短い返事・固有名詞入り通知・長い説明）をコハクと Drama-3 で生成し比較音声を保存（`/home/boxp/verification-artifacts/BOXP-715/`）
3. 再生開始までの待ち・合成時間・RTF、golyat-4 のメモリ/CPU、GPU 不使用、LLM・画像生成への影響を記録
4. 自然さ・読み間違いは本人の聴感で判断（担当は聴取不可のため、認識器による読み間違い確認を補助に使う）

## 除外

既定の声の切替、一般公開、新しい課金、第三者の声の複製。

## ロールバック

lolice/arch の PR を revert。既定の声には影響しない。
