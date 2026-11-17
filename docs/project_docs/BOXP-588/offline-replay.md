# BOXP-588 配備前オフライン再生（モデル呼出しなし）

2026-11-17 実施。道具: `tools/replay.bb`（runner 本体を load して同じ関数で再生。入力は読むだけ）。

## ① Notes 上限（既定 40KB）

`bb tools/replay.bb notes <runner.bb> <ticket.md>...`（2026-11-17 時点の実チケット）

| 票 | 元 | prompt に入る本文 | 省略 | 保護エントリ | 保護の欠落 | 最新3件の欠落 | Notes 以外の節 |
|---|---|---|---|---|---|---|---|
| BOXP-428 | 592KB | 134KB | 817件/468KB | 84 | 0 | 0 | 不変 |
| BOXP-476 | 371KB | 97KB | 419件/281KB | 59 | 0 | 0 | 不変 |
| BOXP-525 | 106KB | 39KB | 151件/68KB | 12 | 0 | 0 | 不変 |
| BOXP-501 | 151KB | 52KB | 199件/103KB | 34 | 0 | 0 | 不変 |
| BOXP-586/584/587/450（小型） | 4〜17KB | 同じ（byte 不変） | 0 | — | 0 | 0 | 不変 |

- codex review P1 対応（同日）: `Owner：外部送信は禁止` のような Owner/本人の制約表記（`Owner:`・`本人：`、Owner/本人の後40字以内の禁止・制約・条件・不可・必須・限定・除外・範囲・しない）も保護対象に追加し、上表を再計測。
- codex review P1 対応2（同日）: 語句の列挙を足し続けず、「Owner/本人/オーナー/user の後、同じ行60字以内に英語の決定・承認・制約語（approve/decide/request/reject/must/never/do not/only/scope/limit/require/allow/permit/deny/confirm/accept/grant 等）」という構造で判定するよう変更（`Owner approved deployment`・`Owner requested no external transmission` 等）。runner の `owner 8d1dd655` のような記録は対象外。上表は再計測値（保護が増えた分 prompt は 428 で約28KB 増。保護優先の設計どおり）。
- 428・476 が 40KB を超えるのは、本人決定などの保護エントリを上限に関係なく全部残すため。設計どおり。
- 省略した区間には件数・KB・チケット全文の path を 1 行ずつ、`## Notes` 直後に説明を 1 行入れる。チケットファイルと停滞判定の入力は全文のまま。

## ③ 同じ PR・同じファイルの P0/P1 連続（閾値 3）

`bb tools/replay.bb streak <runner.bb> ~/.codex-task-board/runs BOXP-428 BOXP-476 BOXP-525 BOXP-501`
（過去 run の summary.edn の review gate と blocking 成果物を、runner の記録関数へ時系列に流した）

- 発火（3回目に到達）したエピソード: 19（428: 15、476: 1、501: 3、525: 0）。2回目では一度も発火しない。
- 最長の連続: 428 lolice#1091 `boxp-langfuse-observer/__init__.py` 24回、lolice#1179 同ファイル 18回、arch#14548 `langfuse_exporter.bb` 13回。
- 誤検知の確認（指摘本文を目視）:
  - 428: 伏せ漏れの別パターンが続く同根（BOXP-586 で確認済み）。
  - 476 arch#14730 `gesture.ts`（5回）: 腕の描画方式（上腕・前腕の見え方）が受入条件を満たさない同根。Owner も後に局所微調整を止める判断をしている。
  - 501 arch#14822 `notifications.ts`（4回）: 返信の永続化・再送・冪等性という同じ状態設計の穴。
  - 501 arch#14891 `task_board_events.bb`（4回）: 家配信が使えないときの fallback の別経路と、heartbeat の同期方式が混ざる**境界例**。近似なので、こうした場合は prompt で「無関係なら理由を Notes に書いて通常修正」を許している。
- 効果（token・枠の削減）はこの再生では測れない。配備後 2 週間の自然発生票で観測する。
