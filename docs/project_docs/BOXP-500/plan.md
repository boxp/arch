# BOXP-500: コハコの家（kohako-home）段階1 実装計画

## 目的
Owner 承認済みの案A「ナビの部屋」を、本命UI **コハコの家（kohako-home）** として既存 Studio と同じ image・同じ host・同じ認証の別 path に実装・配備し、実ブラウザ・実 Hermes で動作を確認する。Studio は開発用プロトタイプとして無変更で残す。

## 入口
- `https://kohako-studio.b0xp.io/kohako/home.html`（既存 nginx の `/kohako/` 配下。新 DNS/host/Access/Secret 不要）
- API は既存 BFF `/kohako/api/v1/*` をそのまま使う（BFF・Hermes 指示文は変更しない）。

## 実装（apps/kohako-studio/web）
- `home.html` + `src/home/` を追加、`vite.config.ts` の input に追加。
- 純粋ロジック（vitest 対象）
  - `scene.ts`: 9状態→6場面（くつろぎ/おはなし/おみせ/おしごと/かくにん/つながらない）。かくにん・つながらないは即時、それ以外は 1.5 秒間隔・入力中/操作中は保留・固定時は抑止、60 秒無操作でくつろぎ。
  - `cards.ts`: 返答文から箇条書き/https リンク/コードを決まった手順でカード化（文字としてのみ表示、https のみ・ホスト名表示）。
  - `touch.ts`: tap/pat/長押しの判別、頻度制御（台詞 20 秒に 1 回、30 秒 6 回超で 60 秒控えめ、同反応の連続回避）、無効条件（承認・エラー・録音中・小窓）。
  - `phrases.ts`: ローカル決まり文句（一人称わたし・ご主人さま・です/ます、仮）。
  - `resume.ts`: 進行中 requestId だけを sessionStorage に控え、再読込後に追跡再開（本文は保存しない）。
- `main.ts`: Studio の送信/重複防止（`resolveUnconfirmed` 等）/停止/承認/ポーリング/演技（476）を再利用し、全画面レイアウト・時計・吹き出し・カード・履歴（タブ内のみ）・設定（ふれあい/ひとこと/固定/動きを減らす、localStorage）・ふれあい（`player.layout()` と `meshVertices` で頭・手の hit area をフレーム追従）を実装。
- CSS: 上帯/下の操作帯を固定、safe-area、`100dvh`、`prefers-reduced-motion`、重なり順（確認＞エラー＞操作帯＞カード＞吹き出し＞コハコ）。
- Studio フッター等は触らない。`index.html` に家へのリンクを追加。

## 検証
1. ローカル: `npm run typecheck && npm test && npm run build`。
2. Playwright（既存 b441pw 手順）でローカル build を PC/スマホ縦横で描画、頭なで/手タップ、BFF は検証用 principal 経由で実 Hermes。
3. PR → CI（Build Kohako Studio Image verify）→ codex review P0/P1 なし → merge → image updater による lolice 書き戻し → Pod の image digest 読戻し。
4. 配備版で PC/スマホの実描画・実 Hermes 複数ターン・停止・承認（verifier は拒否のみ）・エラー/再接続・重複送信・再読込追跡、Studio 非退行。

## rollback
- 家のページを外す revert PR（Studio は無変更なので影響なし）。緊急時は前 image への image updater 書き戻し revert。

## 範囲外
新課金/権限/画像・音声生成/新外部サービス、BFF/Hermes 変更、Telegram hook 移行（BOXP-501）。
