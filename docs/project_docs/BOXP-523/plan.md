# BOXP-523: Access認証切れ時は再接続ボタンから画面再読込で再認証へ復帰

## 実経路（調査結果）
- `apps/kohako-studio/web/src/home/main.ts` の `call()` は `redirect: 'manual'`。Cloudflare Access の期限切れは 302→`opaqueredirect` となり 401 扱いで `fail()` →「未認証」表示。
- 「再接続」ボタンは `initialize()` で同じ fetch を再試行するだけなので、何度押しても `opaqueredirect` に戻り Access のログイン画面へ遷移できない（Owner 報告の原因）。
- `sw.js` は navigation を `fetch(request)` で素通しするため、トップレベル再読込なら Access ログインへ進める。
- 送信待ちキュー（BOXP-508）はメモリのみで再読込で消える。成否不明の控え・追跡中依頼は sessionStorage から照会再開し自動再送しない（既存）。

## 方針
1. 認証切れ（API 401/403、または `opaqueredirect`）を `authExpired` として通常切断（通信例外・5xx）と区別する。ログインHTMLの200等は認証切れと断定しない（従来の失敗表示＋再接続）。
2. 認証切れ中だけボタン表示を「再認証のため再読み込み」に変え、説明文を出す。押下時は fetch 再試行ではなく `location.reload()`（同一 origin の現在の家 URL、外部 redirect 先を受け取らない）。
3. 再読込前に入力草稿と送信待ちキュー本文を sessionStorage（タブ限定）の一時キーへ退避（TTL 付き）。localStorage には保存しない。添付は再追加が必要と明示確認。
4. 再読込後は認証成功（`me` 200 かつ `conversation` 200）まで復元しない。成功時のみ草稿を入力欄へ戻し、キューは `auth` 保留状態で復元（明示「再開」まで送らない）し、一時キーを即削除。認証失敗のままなら保持したまま（TTL 超過で破棄）。
5. 自動 reload は一切しない（ボタン押下のみ）。直近の再読込後もまだ認証切れなら、その旨を表示（ループ防止）。
6. 再読込による beforeunload 確認はキュー退避済みのときは抑止。成否不明・承認・既送信は既存の照会経路のみ（自動再送なし）。

## 検証
- vitest: 判定・退避/復元の純関数の Red/Green。
- Playwright（BFF 完全モック、PC/Pixel 7 相当）: 認証切れ→ボタン文言→トップレベル遷移（navigation 発生）→認証成功で草稿/キュー復元・保留・POST 重複なし／通常切断では reload せず従来再接続／連打・自動 reload なし。
- CI / codex review P0P1 → merge → 通常配備 → 配備版 JS の readback。実 Access 期限切れは本人ブラウザ確認が必要な限界として報告。
