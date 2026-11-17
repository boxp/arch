# BOXP-600: kohako-studio へミューテーションテストを導入し検出力と実行時間を実測する

参考: https://zenn.dev/mizchi/articles/mutation-test-quality

## 方針

- ツール: `@mizchi/mutator` 0.3.0（diff 駆動・関数単位キャッシュ・Vitest 5 対応）。
  kohako-studio は Node 26 / Vitest 5.1 / TypeScript 7 で、mutator の要件（Node >= 24, Vitest ^5）を満たす。
  依存追加は mutator 本体と oxc-parser 等の小さな依存のみで、既存依存の更新は不要だったため StrykerJS には切り替えない
  （StrykerJS 10.1 も Vitest runner を持つが、関数単位キャッシュ・`--since` 差分実行・型不一致変異の事前除外が
  mutator 側にあり、反復開発での所要時間で有利）。
- 対象（代表範囲、全 repo 一括適用はしない）:
  - bff `src/notifications.ts`（通知の受理検査・振分け/状態遷移）, `src/status.ts`（状態取得/閾値判定）
  - web `src/home/markdown.ts`（リンク/URL 検査）, `src/home/sync.ts`（同期の状態遷移）
  - 対象は各 package の `mutator.config.json` の `include` で限定。BOXP-599 が触る bff app/hermes/conversation は対象外。
- CI: `.github/workflows/kohako-studio-mutation.yml` を既存 build/verify とは独立した並列 job（bff/web の matrix）で
  report-only 導入。スコア閾値・`--fail-on-survived` の merge gate は置かない。main push で全件を走らせて
  `.mutator/` キャッシュを保存し、PR はキャッシュを復元して `--since origin/<base> --include-test-changes`
  （diff 内の変異と、変更テストが覆う変異）だけ実行する。
- テスト改善: 生存変異を「意味ある見逃し / 等価変異 / 未到達 / 実行失敗」に分類し、意味ある見逃しは呼び出し側から
  観測できる振る舞いを assert するテストで潰す。等価変異だけを理由付きで `mutator.accepted.json` に記録する。
  スコア合わせのテスト・除外・本番コード変更はしない（実バグを見つけた場合は報告して別途判断）。

## 再実行方法

```sh
cd apps/kohako-studio/bff   # または web
npm ci
npm run test:mutation                       # 対象全体（2回目以降はキャッシュ再利用）
npm run test:mutation -- --since origin/main  # 差分だけ
npx mutator --reporter agent > .mutator/agent.json   # 生存変異の一覧（key 付き）
npx mutator --only <key> --reporter agent             # 個別の再確認（数秒）
```

`.mutator/` はキャッシュとレポートで git 管理しない。`mutator.accepted.json` はコミットする。

## 実測（ローカル 2 CPU, 2026-11-17）

| package | 変異数 | 実行 | 型不一致で除外 | 初回 | 変更なし再実行 | 設定変更後 | 初期スコア |
|---|---|---|---|---|---|---|---|
| bff (notifications+status) | 916 | 582 | 294 | 10分30秒 | 0.7秒 | 10分25秒（全件） | 63.8% |
| web (markdown+sync) | 1015 | 528 | 284 | 78.6秒 | 0.6秒 | 76.6秒（全件） | 55.8% |

- 通常の `npm test`: bff 約12秒（184 tests）, web 約5秒（393 tests）。bff は 1 変異あたり約1秒
  （覆うテストファイルの実行時間が長い）で、web（約0.15秒）より重い。
- `mutator.config.json` / package.json の変更でキャッシュが無効化され全件再実行になる。
- テスト改善後の結果と CI 実測は下の「結果」に追記する。

## 結果（テスト強化後, 本番コード変更なし）

| package | Killed | Survived | NoCoverage | スコア | テスト変更後の差分再実行 |
|---|---|---|---|---|---|
| bff | 397 → 435 | 200 → 174 | 25 → 11 | 63.8% → 70.2% | 116変異を再実行 5分56秒 |
| web | 389 → 427 | 134 → 102 | 189 → 181 | 55.8% → 61.2% | 446変異を再実行 61秒 |

追加したテスト（呼び出し側から観測できる振る舞いを assert）:

- web `obsidian-link.test.ts`: 許可するリンクスキーム（http/https/mailto のみ、ftp/javascript/data は文字列化）、
  obsidian URL の全体一致（前置/後置文字の拒否）、復号後パス 1500 文字境界、許可パス/BOXP ID の全体一致。
  これらは導入前は `'http:' -> ''` や `^`/`$` 除去などの変異が生存していた **URL 検査の意味ある見逃し**。
- web `vault-image.test.ts`: 画像拡張子の末尾一致（`image.png.exe` の拒否）とパス長境界。
- web `sync.test.ts`: 履歴（transcript）の各フィールドの型・長さ上限。
- bff `notifications.test.ts`: 未知キーの拒否、各フィールドの境界、案内リースの 30 秒境界、push 失敗の永続化、
  返信の not_found/invalid、500 件保持と処理済み優先の削除。

残りの分類:

- 意味ある見逃し（次段階候補）: web `parseMarkdown`（純関数だが直接のテストが無い）、bff `status.ts` の
  `parseBoard`/`parseQuota`/`parseMetrics` の文字列・条件変異、`notifications.ts:120` の削除対象探索境界、
  `sync.ts:48` の views 上限境界、`status.ts:158` の 90% 境界。
- 未到達（テスト環境の制約）: web `renderMarkdown` は DOM を要し、web のテストは DOM 環境を持たないため到達しない。
  jsdom 等の追加は本件の範囲外とした（実画面検証は既存の verify/home が担う）。
- 等価の可能性: bff `notifications.ts:72` の createdAt 先頭アンカー除去（後段の `Date.parse` が前置文字を拒否する）。
  全入力で等価とは確認できないため accept していない。`mutator.accepted.json` は作っていない。
- 実行失敗: なし（bff status の 4 変異が一度 timeout し、3 倍の予算での再実行で Survived と判定）。
- 実バグ: 見つからなかった。

## 開発反復 / CI 配置の判断

- 開発反復: 変更なしの再実行は 1 秒未満。テストを変えると、そのテストが覆う変異は全て再実行される
  （bff で 6 分弱）。個別確認は `--only <key>` で数秒。日常は `--since origin/main` か `--only` を使う。
- CI: 通常の build/verify（PR で約 1.5 分）とは独立した report-only job として並列配置した。
  一律スコア gate は置かない（スコアは対象範囲の取り方で大きく変わり、残りに未到達/環境制約が含まれるため）。
  `critical` 指定や `--fail-on-survived` は、対象を広げて基準値が安定してから個別に判断する。
- 横展開: 同じ構成（devDependency + mutator.config.json の include 限定 + report-only job）を他 package に
  広げるのは、Vitest 5 / Node 24+ であれば可能。全 repo 一括適用はしない。
