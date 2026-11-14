# BOXP-549: kohako-home の format / TypeScript lint を CI 必須化

## 目的

kohako-home（`apps/kohako-studio` の web / bff）のコード可読性を上げるため、
フォーマットチェックと TypeScript lint を CI で実行し、違反時に失敗させる。

## ツール選定

- **Biome 2.6.7**（`@biomejs/biome`、web / bff それぞれの devDependencies に exact pin）
  - formatter と TypeScript 対応 linter を 1 バイナリで提供し、plugin 管理が不要。
  - 既存コードの書式（single quote / セミコロンなし / 2 space）に合わせて設定。
  - `lineWidth: 120`（既存コードの 1 行が極端に長いことが可読性低下の主因のため）。
- lint は `preset: recommended` をそのまま使い、`--error-on-warnings` で warning も失敗扱い。
  - ルールの無効化・ファイル除外・override は入れない。
  - インライン抑制は `noControlCharactersInRegex`（非信頼入力から制御文字を除去する意図的な正規表現）
    等、理由を書ける最小限のみ。

## CI への組み込み

- `apps/kohako-studio/Dockerfile` の web-build / bff-build stage で
  `npm run typecheck && npm run check && npm test && npm run build` とする（`check` = `biome ci --error-on-warnings .`）。
- これにより `build-kohako-studio-image.yml` の PR verify job と main の build-and-push job の両方で
  format / lint 違反があると image build が失敗する（違反を含む版は配備されない）。
- `test.yaml`（必須 `status-check`）は BOXP-207 の制約により変更しない。

## 既存コードの整備

1. `biome format --write` による機械整形（挙動変更なし）。
2. lint 違反の修正（`any` → 具体型 / `unknown`、non-null assertion → 明示 guard 等）。挙動・テスト期待値は変えない。

## 確認

- ローカル: web / bff で `npm run check`・`typecheck`・`test`・`build` が成功。
- 違反時失敗の確認: 故意に format 違反 / lint 違反を入れた状態で `npm run check` が非 0 で終わることを確認。
- CI: PR の `Build Kohako Studio Image / verify` が成功。
- merge 後: main の build-and-push 成功と、配備された Pod の image tag が merge commit に一致すること、
  kohako-home の画面が従来どおり表示されること（HTTP 応答・配信アセット）を確認。

## 他作業との調整

- BOXP-556（Hermes 上流追従）は `apps/kohako-studio` に触れないため衝突なし。
- BOXP-523（blocked, PR #14893）は `web/src/home/main.ts` 等を変更しており、本整形と衝突する。
  再開時は main を取り込み `npm run fix` を再適用すれば機械的に解消できる。
- renovate の TypeScript 7 / @types/node 26 PR とは package.json 変更行が近いが独立。
