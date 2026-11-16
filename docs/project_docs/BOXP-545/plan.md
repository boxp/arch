# BOXP-545: コハコの家 スマホの読み上げ開始で他アプリの音楽が止まる問題の改善

## 原因（Chromium ソース確認）
- 家の「コハクの声」は合成 WAV（1 要求あたり約 18〜20 秒）を `HTMLAudioElement` で再生している。
- Chromium `media/base/media_content_type.cc`: 長さが 5 秒を超える（または不明な）メディアは `kPersistent`。
  `content/browser/media/session/media_session_impl.cc` `AddPlayer`: `kPersistent` は `AudioFocusType::kGain`
  （Android の永続オーディオフォーカス）を要求し、他アプリ（音楽）は一時停止して自動では再開しない。
- 一方 Web Audio (`AudioContext`) は `MediaContentType::kAmbient` として報告され（blink `audio_context.cc`）、
  `AddAmbientPlayer` は Android で「audio focus から完全に無視」される。→ 音楽と重ねて鳴る。

## 方針
- 設定に「他アプリの音楽を止めない」(prefs `mix`, 既定 ON) を追加。ON のときコハクの声の WAV を
  `AudioContext` + `decodeAudioData` + `AudioBufferSourceNode` (+ GainNode で音量) で再生する。
- OFF、AudioContext 非対応、context が running にできない、decode 失敗のときは従来の `HTMLAudioElement` 再生にフォールバック
  （読み上げ自体は無効化しない／元の挙動に戻せる）。
- 停止・割込み・再開（cancel / speak(start)）、onSentence の duration、onChunkEnd/onEnd/onError の契約は現状維持。
- ユーザー操作（読み上げ ON 切替・送信等の pointerdown/keydown）で AudioContext を resume しておく（autoplay 対策）。
- 端末の声（speechSynthesis）は Android の TTS エンジンが一時ダッキング扱いのため変更しない。
- iOS Safari: Web Audio は ambient 扱いでマナーモード中は無音になる制約を設定の説明に明記（OFF で従来再生）。

## 検証
- vitest: voice の Web Audio 経路・フォールバック・cancel 中の stop、prefs 既定/保存。
- Playwright(BFF モック): 配備版で読み上げ中に HTMLAudio が再生されず AudioContext 経由で再生・停止/再開できる、OFF で従来経路。
- 実機（Android 上の音楽アプリと併用）は Owner 確認が必要。未確認の実機挙動を成功扱いにしない。

## 関連
- BOXP-522（voice.ts の区切り改善, blocked）, BOXP-544（縦表示 CSS）と衝突しないよう最新 main に追従。
