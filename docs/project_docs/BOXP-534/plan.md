# BOXP-534: コハコの家で読み上げ音量を調整できるようにする

## 現状
- 家の読み上げは2経路: コハク（AivisSpeech→BFF `/kohako/api/v1/tts`→`HTMLAudioElement`）と端末の声（`speechSynthesis`）。
- どちらも音量は固定（1.0）で、家の設定に音量項目はない。

## 方式
- 設定ドロワー「読み上げ」に音量スライダー（0〜100%、5%刻み、既定100%）を追加し、既存の設定と同じく `localStorage`（`kohako-home-prefs`）へ保存。
- コハクの声: `voiceAudio.volume` に反映（スライダー操作中も再生中の音声へ即時反映）。
- 端末の声: `SpeechSynthesisUtterance.volume` に反映（次の文から）。
- BFF/TTS エンジン・合成内容・分割/先読み・停止/再開の動作は変更しない。
- 制約: iPhone/iPad の Safari は `HTMLMediaElement.volume` を無視するため、端末の音量ボタンで調整する旨を設定欄に明記。

## 検証
- `parsePrefs`/`parseVolume` 単体テスト（範囲外・非数値・旧設定の既定100）。
- web typecheck/test/build。
- 実 Chromium でスライダー→保存→再読み込み復元、再生中 Audio の volume 反映、端末の声の utterance.volume を確認。
- merge・配備後、配備版で同様に確認。
