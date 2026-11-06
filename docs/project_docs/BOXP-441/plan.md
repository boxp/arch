# BOXP-441: OpenAmika 風 UI を既存コハコの音声・表情・画面 UI として隔離プロトタイプ化する

## Owner の選択

「既存コハコを維持し、音声・表情・画面UIとして活用したい」。Amika の人格・brain・記憶を主役にしない。

## 照合結果（要約）

| 項目 | upstream OpenAmika (5d5e056) | 現環境 | 判断 |
| --- | --- | --- | --- |
| 判断主体 | Amika brain が主会話、Hermes は helper | Hermes（コハコ）が唯一の判断・人格主体 | upstream 本体は持ち込まない |
| Hermes 連携 | `adapters/hermes.py`: Runs / SSE / approval / clarify / stop | `apps/kohako-bff` が `/v1/runs` 送信・照会・approval(once/deny)・stop を既に中継 | 同じ契約を既存 BFF で使う。BFF に停止 endpoint だけ追加 |
| OS | Windows 中心、Linux untested | k8s (Linux headless) | ブラウザ UI として実装 |
| モデル | OpenRouter / 大型 Ollama（15–20GB） | 既存 subscription/provider | 新課金・大容量 weights なし |
| 音声入力 | upstream 独自 | 既存 whisper STT（BFF `/transcriptions`） | 押している間だけ録音（常時録音なし） |
| 音声出力 | Amika 声（別ライセンス） | コハコ専用 TTS は未整備 | ブラウザ内蔵 speechSynthesis（コハコ専用声ではないと明示） |
| 表情 | Live2D (Cubism Core は MIT 外) + Amika モデル | コハコの Live2D リグなし。正本シート参照で作られ Owner 受入済みの c48v6 7表情（ドット絵） | 静止ドット絵の状態切替。Live2D は未対応として差分判断へ |
| 公開 | ローカル | `kohako-g2.b0xp.io` は Cloudflare Access（Owner 限定） | 同一 origin の `/kohako/studio.html`。新規公開なし |

## 最小構成

- `boxp/even-g2-lab`
  - `apps/kohako-bff`: `POST /kohako/api/v1/requests/:id/cancel`（既存 `conversation.cancel` → Hermes `/v1/runs/:id/stop`）。
  - `apps/g2-client/nginx.conf`: cancel route（POST のみ）と studio ページ。
  - `apps/kohako-g2`: `studio.html`（テキスト / 押下録音 STT / 承認・拒否 / 停止 / 状態表情 / ブラウザ TTS / 遅延表示）。
- 既存 G2 アプリ (`index.html`)、Telegram、Hermes 設定、NetworkPolicy、Access policy は変更しない。
- K8s manifest 変更なし（同じ image の中のページ追加のみ）。

## 非承認事項（実施しない）

新 API 課金・OpenRouter 契約、大容量 weights、研究 GPU の停止・奪取、本人音声 clone、Amika 素材の流用、外部一般公開、本番 UI 置換、新権限、カメラ/IoT/PC 操作、upstream desktop helper の持ち込み。

## 検証計画

1. even-g2-lab の通常 CI（test / typecheck / build / nginx route test）と codex review P0/P1。
2. merge → 既存 image 更新経路で even-g2-main へ反映 → `/healthz`・既存 `/kohako/` と G2 の維持確認。
3. `/kohako/studio.html` で日本語の無害依頼・音声入力・承認拒否・停止・再送・session 境界を実試験し、PC / スマホ幅で確認。遅延と Pod 資源を実測して記録。

## 残る判断（差分）

- 本物の Live2D 化: コハコ用 Live2D リグ（パーツ分け原画 + Cubism モデリング）と Cubism SDK ライセンス確認が必要。
- コハコ専用の声: 既存 TTS 経路の選定（本人音声 clone は対象外）。
