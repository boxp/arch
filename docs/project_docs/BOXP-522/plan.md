# BOXP-522: コハク／ノーマルをコハコの家の読み上げへ導入する

## 確定事項（2026-11-12 公式 API 読取）

- AivisHub model `22e8ed77-94fe-4ef2-871f-a86f94e9a579`「コハク」（配布 @ozchat）、AIVMX v1.1.0、255,326,987 bytes、sha256 `3f5c08b52bb8a64efd361268580c81510f96c927cd6905aa7dbae6851333270a`、Style-Bert-VITS2 (JP-Extra)。
- speaker UUID `5680ac39-43c9-487a-bc3e-018c0d29cc38`、style「ノーマル」local_id 0（他: あまあま1/せつなめ2/ねむたい3）。
- ライセンス ACML 1.0。禁止事項（本人・公式の誤認、毀損、攻撃、虚偽、政治宗教、反社）外は利用可。クレジット任意、表記する場合は「AivisSpeech: コハク」。コハコの声として使い、非公式である旨を設定欄に表示する。
- AivisSpeech Engine 1.2.0（LGPL-3.0）`ghcr.io/aivis-project/aivisspeech-engine:cpu-1.2.0`（index digest `sha256:5799c94c3594501be80eeda62106f15439a858c1630d25d1385576581433b192`、amd64 圧縮約 1.2GB）。初回に BERT 約 650MB を Hugging Face から取得。

## 方式

1. lolice `argoproj/kohako-studio` に AivisSpeech Engine（CPU）を追加。
   - 起動ラッパで AivisHub の既定モデル自動導入をコハクのみに限定（まおを取得しない）、起動イベント送信・Sentry を無効化。
   - モデル/BERT は新規 PVC 2Gi（Longhorn）に保持。golyat-1/3（amd64, GPU なし）を優先。
   - Service は ClusterIP、NetworkPolicy で ingress を BFF からのみ許可。BFF の egress に engine:10101 を追加。
2. arch `apps/kohako-studio/bff` に Owner 認証下の `POST /kohako/api/v1/tts` と `GET /kohako/api/v1/tts`（状態）を追加。
   - `/speakers` から speaker UUID + style 名「ノーマル」で style id を解決。見つからなければ 503（他の声へ置換しない）。
   - 1 文（最大 300 字）ずつ合成、同時 1 件、本文・音声を保存しない。verifier/notifier は不可。
3. arch `apps/kohako-studio/web` の家画面に「声」の選択（コハク／ノーマル＝既定、端末の声）を追加し保存。
   - 文ごとに BFF から WAV を取得し `<audio>` で順に再生、次文を先読み。停止・OFF・新規依頼・次 turn で中断し旧音声を破棄。
   - 合成失敗時は家に「コハクの声で読めませんでした」と表示し口パクのみ（端末の声へ黙って切替えない）。
   - 口形は実音声の長さで既存推定を伸縮（AivisSpeech はモーラ時刻がダミー値のため近似）。
4. 通常 CI・codex review（P0/P1）→ merge → 配備 → 実合成（共通短文 3 種）で WAV デコード・遅延・CPU/RAM 計測、style 読戻し。PC/モバイル再生は可能な範囲で実機確認し未確認を明示。

## 非実施

Aivis Cloud API・他の有料 TTS、他の声の取得、GPU 使用、学習・clone・録音、既存 PVC 拡張、G2/Discord の音声設定変更。

## Rollback

家の設定で「端末の声」を選ぶ（即時）。障害時は lolice の engine Deployment を replicas 0 にすれば BFF は 503 を返し家に失敗表示が出る。
