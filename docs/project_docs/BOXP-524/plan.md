# BOXP-524: コハコの家の音声入力（明示マイク→認識文の確認・修正→本人送信）

## 方式選定
- 既存資産: BFF に `POST /kohako/api/v1/transcriptions`（16kHz PCM → WAV → whisper.cpp `/inference`、上限 960000 byte = 30 秒）と家 UI の「押して録音」が既にあるが、本番 BFF に `KOHAKO_STT_URL` が未設定のため非表示。
- 認識器: 既存の `even-g2-lab/kohako-stt`（whisper.cpp, CPU 2 core, `--no-gpu`, VAD, 日本語、BOXP-332 で G2 用に配備済み・外部送信なし）を再利用する。新モデル取得・GPU 占有・新課金・新 token なし。
- 不採用: ブラウザ標準 Web Speech API（Chrome/Android はクラウド送信、iOS は端末依存で送信先が保証できない）。無断で新しい外部音声送信経路を作らない。
- 送信先 privacy: 端末 → Cloudflare Access 認証済み BFF → クラスタ内 whisper.cpp のみ。BFF/whisper は音声を保存しない（メモリ上のみ・応答後破棄）。認識文は入力欄の草稿としてだけ残る。

## 変更
### boxp/lolice（配備）
- `kohako-studio-bff` に `KOHAKO_STT_URL=http://kohako-stt.even-g2-lab.svc.cluster.local:8080`。
- Calico: kohako-studio BFF の egress に kohako-stt:8080、kohako-stt の ingress に kohako-studio BFF を追加。

### boxp/arch（家 UI）
- 押し続け方式 → 明示クリックの「🎤 音声入力」開始 / 「停止して文字にする」/「取消」。自動送信しない。音声で承認しない。常時録音しない。
- 録音開始時に読み上げ（522）を止め、その旨を表示。録音終了後に読み上げは自動再開しない（次の返答から通常どおり）。
- 認識文は既存入力欄の草稿へ追記（既存草稿を上書きしない）しフォーカス。本人が編集して送信ボタンで送る。
- 回帰: 権限拒否/マイクなし/非対応環境(HTTPS・getUserMedia なし)の明示、0.5 秒未満・無音（RMS 閾値）を送らない、30 秒で自動停止、取消・タブ非表示・pagehide で破棄と資源解放、世代番号で旧録音結果を破棄、認識中の二重開始/二重送信なし、401/403 は既存 Access 再認証導線、通信断は再試行可能な表示。
- BFF: 空文字の認識結果は 422 `no_speech`。

## 検証
- unit test（dictation モジュール・BFF）、typecheck/build、CI、codex review P0/P1。
- merge/Argo CD 配備後、合成日本語音声（AivisSpeech/既存 TTS）を認証済み BFF の transcriptions へ送り認識文を確認、実ブラウザ（PC/モバイル viewport, fake media stream）でマイク→認識文編集→送信→実 Hermes 応答。
