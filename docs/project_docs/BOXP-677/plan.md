# BOXP-677: kohako-home の PDF 添付を 30 MiB へ拡張し失敗理由を画面に返す

## 調査結果（2026-11-23）
- 現行（BOXP-517）: 画面・BFF とも 1 件 5 MiB、nginx の添付 route は 6m。PDF は先頭 30 ページ・本文 48KB を抽出し、本文だけを Hermes に渡す（原本は保存領域 200 MiB / PVC 1Gi に保持）。
- 失敗理由は `#error` に書かれるが、`#trouble` パネルは接続障害時しか表示されないため、通常時は画面に出ず履歴にだけ残っていた（実質無言）。
- 一部読取（30 ページ超・48KB 超）は 201 で「本文一部省略」のチップだけ。Hermes には範囲が伝わらない。
- BFF は limit 256Mi。合成 30 MB PDF（20/200/1000 ページ等）で pdfjs の開封 0.2〜0.5 秒・抽出 0.2 秒未満、1 件の RSS 増は約 55〜65 MiB。20 件続けると GC 前の最大 RSS が 264 MiB（GC 後 150〜178 MiB、リークなし）。

## 方針
- 上限: PDF のみ 1 件 30 MiB（31,457,280 バイト）。画像・テキストは 5 MiB のまま。ページ数（30）・本文（48KB）・件数（3）・画像合計（5.5 MiB）は変えない。表示は 2 進単位（MiB / KiB）にそろえ、超過時はバイト数も出す。
- 中継: nginx の添付 route を 31m にし、超過は JSON `413 {"error":"too_large"}`。BFF は Content-Length が 30 MiB を超えれば本文を読まずに 413、5 MiB 超の受信・抽出は同時 1 件（`429 attachment_busy`）。
- 保存: PDF は本文だけを保存し原本は保存しない（容量・保持の上限は不変）。pdfjs には複製せずに渡す。抽出の時間上限は 20 秒（`pdf_timeout`）、パスワード付きは `pdf_encrypted`。
- 結果: `read = full | partial | none` を返し、一部読取は「⚠ 一部のみ読取」と範囲（全 N ページ中先頭 30 ページ等）と次の手順を表示。Hermes への入力にも「読んだ範囲だけ、全文を読んだように答えない」を入れる。
- 表示: 添付の失敗・注意は入力欄の上の注意欄（`#attachment-note`）に出し、履歴にも残す。理由ごとに次にすること（小さくする・形式を変える・パスワードを外す・待つ・再ログイン・通信確認）を書く。失敗チップは × で取り消し、下書きは残す。アップロードは 5 分で打ち切る。
- メモリ: BFF の Deployment manifest は本リポジトリではなく boxp/lolice（`argoproj/kohako-studio/deployment-bff.yaml`）が管理するため、limit 256Mi→512Mi の変更は https://github.com/boxp/lolice/pull/1368 に入れる（requests は 64Mi のまま）。
- merge 順序（チケット条件 CD-01）: 本 PR は lolice#1368 の merge と配備（稼働中 BFF Pod の limit が 512Mi になったこと）を確認した後にだけ merge する。256Mi のまま本 PR を配備すると 30 MiB PDF の連続処理で OOMKill の恐れがあるため、先行 merge はしない。
- Lean: `bff/contract/attachment-model/AttachmentModel.lean` に上限と結果の規則を仕様から起こし、性質 5 件を証明。生成した境界表 729 件を BFF の `classifyUpload` と画面の `attachmentValidation` に照合する。CI は `.github/workflows/test-kohako-attachment-model.yml`（必須化は BOXP-673 の Lean 必須経路に合わせる）。

## 検証
- bff 285 件・web 565 件の unit test、typecheck、biome。境界の変異 5 件（`>`→`>=` 等）を照合テストが全件検出。
- `verify/home/attach677.mjs`: 配備イメージの nginx と web build、本物の BFF コード（認証・Hermes のみ置換）、Chromium で PC / Pixel 7。30 MiB ちょうどの PDF が約 3.6 秒で「本文読取済」、30 MiB+1 は画面で停止、直接送信の 30 MiB+1 / 31 MiB+1 は 413 JSON、未対応・本文なし・壊れ・一部読取・BFF 停止・通信断の理由表示、Hermes 入力の範囲注記を確認（失敗 0）。
- merge 後: 通常配備（image-updater）→ 配備 Service で未認証 30 MiB が BFF まで届き 401、31 MiB 超が 413 JSON になることを確認。認証付きの実会話（Owner の画面で 30 MiB PDF を送り返答を受ける）は検証用 token を agent が発行できないため Owner に依頼する。

## 残る制限
- PDF の本文は先頭 30 ページ・48KB まで（スキャン PDF は OCR しない）。1 回の送信の本文合計も 48KB。
- 遅い回線で 30 MiB を送る場合、5 分で打ち切る。Cloudflare 側の上限（無料プラン 100 MB）内。

## rollback
- arch の PR を revert（image-updater が前 sha へ追従）。lolice の limit は revert で 256Mi に戻る。PDF 原本は保存しないため保存領域の戻しは不要。
