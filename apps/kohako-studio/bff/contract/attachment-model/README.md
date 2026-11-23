# 添付の上限と結果のモデル（BOXP-677）

コハコの家の添付 1 件について、上限と「どう答えるか」を仕様（BOXP-677 の受入条件）から起こした Lean のモデルです。実装の写しではありません。

## 規則

| 段 | 条件 | 結果 |
| --- | --- | --- |
| 中継 | 31 MiB (32,505,856 バイト) を超える | nginx が `413 {"error":"too_large"}` |
| サイズ | PDF は 30 MiB (31,457,280)、画像・テキストは 5 MiB (5,242,880) を超える。形式不明は 30 MiB まで読んでから判定 | `413 too_large` |
| 形式 | PNG/JPEG/WebP/GIF・PDF・UTF-8 テキスト以外 | `415 unsupported_type` |
| 開封 | パスワード付き / 壊れている / 20 秒で読めない | `422 pdf_encrypted` / `pdf_unreadable` / `pdf_timeout` |
| 本文 | PDF に文字がない（スキャンのみ等） | `422 pdf_no_text` |
| 読取 | 本文 48,000 バイト以内かつ PDF は 30 ページ以内 | `201 read=full`（画像は `read=none`） |
| 読取 | どちらかを超える | `201 read=partial`（全文を読んだ扱いにしない。画面は「⚠ 一部のみ読取」と範囲、Hermes には読んだ範囲だけと明示） |

証明している性質: 上限の並び（5 MiB < 30 MiB < 31 MiB）、受け付けた添付は種類の上限内、`full` は本文・ページ上限内のときだけ、ページ上限超えは `full` にならない、画面の事前検査が通したものを BFF・中継がサイズで断らない。

## 実装との対応

- `bff/src/attachment-limits.ts` の `classifyUpload` が規則の実装。`bff/src/attachments.ts` の `upload` は事実（種類・サイズ・PDF の開封結果・ページ数・本文バイト数）を集めてこれを呼ぶ。
- `bff/src/attachment-limits.test.ts` が `cases.jsonl`（境界 729 件）を `classifyUpload` に照合する。
- `web/src/home/attachment-cases.jsonl` は `cases.jsonl` の写しで、`web/src/home/attachments.test.ts` が画面の事前検査（`attachmentValidation`）を `clientRejects` に照合する（web の Docker build には bff/ が入らないため写しを置く）。
- `nginx.conf` の添付 route の `client_max_body_size 31m` がモデルの `proxyMax`。

## 検査と生成

```sh
lean AttachmentModel.lean                       # 証明の検査
lean --run AttachmentModel.lean > cases.jsonl   # 境界表の生成
cp cases.jsonl ../../../web/src/home/attachment-cases.jsonl
```

CI: `.github/workflows/test-kohako-attachment-model.yml`（証明・sorry/公理なし・境界表と写しの一致・nginx の値）。照合は bff/web の unit test（Docker build 内）で常に走る。必須 check への接続は BOXP-673 の Lean 必須経路の一般化に合わせる。

## 省いたもの

1 回の送信の合計（画像 5.5 MiB・本文 48KB・3 件）、保存の容量・期限、同時受信 1 件（`429 attachment_busy`）、認証・通信失敗は、このモデルの外で既存の unit test が扱う。PDF の中身の解釈（pdfjs の正しさ）はモデルの事実として与えるだけで検証しない。
