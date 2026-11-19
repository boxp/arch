# BOXP-630: Antigravity CLI を Task Board runner の担当候補へ追加する

## 目的

Owner 方針「antigravity cli を追加する」に従い、Google 個人サブスクリプション（本人の公式ログイン）で
公式 Antigravity CLI (`agy`) を Task Board の担当 `antigravity` として選べるようにする。
既存担当（Claude / Codex / localllm 系）の挙動は変えない。

## 利用条件の照合（2026-11-19 再照合）

前回 run は「runner に組み込むこと自体が FAQ の『アプリへの wrap』に当たる」と一律に不適合と判断した。
Owner の再開指示（本人専用 codex-workspace での作業支援、他 CLI と同様との見解）を受け、具体方式へ照合し直した。

| 公式記述 | 出典 | 本方式 |
| --- | --- | --- |
| headless mode (`agy -p`) is intended for direct scripting and CI workflows | FAQ | runner は Owner 自身の bb スクリプトで、公式バイナリを `agy -p` で直接起動する |
| Run Antigravity CLI non-interactively to script agent tasks, integrate with CI pipelines（例: bash で JSON `status` を判定） | docs/cli/headless | runner も stream-json の `result.status` を判定するだけ |
| changelog: headless runs in CI, eval harnesses, and scripts can consume the CLI's output programmatically | agy 1.5.12 同梱 changelog | 同上 |
| third-party software (such as Claude Code, OpenClaw, or OpenCode) with my Antigravity login は Terms 違反 / Terms 6: e.g. using OpenClaw with Antigravity OAuth | FAQ / Terms | runner は Antigravity の OAuth トークンを読まない・使わない。サービスへアクセスするのは公式 CLI だけ |
| Wrapping `agy` inside third-party coding agents or applications, or automating account rotation は consumer plan 非対応 | FAQ | Claude / Codex 等の第三者 agent から `agy` を呼ばせない（runner 直起動のみ、prompt でも禁止）。単一の本人アカウントのみ、ローテーションなし |

結論: 「本人の自作 runner スクリプトが公式 CLI を headless で直接起動する」方式は、公式文書が想定する
direct scripting / CI と同じ形であり、名指しされた禁止形（第三者ソフトによる OAuth 流用・第三者 agent 内での wrap・
アカウントローテーション）には当たらないと判断する。

留保: 公式文書は "application" / "direct scripting" を定義しておらず、Google から個別の許諾を得たわけではない。
本判断は Owner 見解を前提とした解釈であり、アカウント停止リスクは Owner が負う。Google が方針を明確化した場合は
担当の利用を止めて再評価する。

## 守る線（実装で強制するもの）

- runner が `agy` を直接起動する。他の coding agent CLI や delegate.py から `agy` を呼ばない（prompt で禁止、`antigravity` は委譲 route ではない）。
- 認証は Owner が一度だけ対話 `agy` で公式ログインする。runner は資格情報を読まない・コピーしない・出力しない。
  未ログイン時は stdin を空にして起動するため、prompt が認可コードとして読まれることはなく、run は Blocked になる。
- 新課金なし: `GEMINI_API_KEY` / `GOOGLE_API_KEY` / `AGY_ADC_AUTH` / `GOOGLE_APPLICATION_CREDENTIALS` / gateway / paygo 系の環境変数を `agy` の環境から除去する。
- AI Credits を使わない: セッション限定設定 `--settings '{"useG1Credits":false}'` を毎回渡す。
- 枠切れ時: `agy` が非 0 終了 → run は Blocked。runner が「quota exhausted、API 課金・AI Credits・他担当へ fallback しない」旨を
  last-message に残す。自動再試行はしない（Owner が枠回復後に担当を戻す）。

## 実装

- `docker/codex-workspace/Dockerfile`: agy 1.5.12 を公式 release (storage.googleapis.com) から取得し、manifest の sha512 で検証して
  `/opt/antigravity-cli/antigravity` → `/usr/local/bin/agy` に配置。認証設定は一切入れない。
  バージョンは manifest の version / build / sha512 を 3 つ同時に手動更新する（Renovate 追従は対象外。root 所有なので自己更新もしない）。
- `task_board_runner.bb`:
  - 担当 `antigravity`（runtime `antigravity-cli`）を `supported-assignee?` に追加。TODO 契約・PR gate・停止/再開・idle watchdog は既存の汎用経路を使う。
  - 起動: `agy --print <prompt.md を読めという短い指示> --output-format stream-json --settings {"useG1Credits":false} --disable-slash-commands --add-dir <vault> --add-dir <run dir> --add-dir <worktrees> [--model $CODEX_TASK_BOARD_ANTIGRAVITY_MODEL] [--dangerously-skip-permissions]`、cwd は run workspace。
    prompt.md は p95 で約 370KB あり 1 引数上限 (128KiB) を超えるため、本文はファイル参照で渡す。
  - stream-json を events.jsonl に逐次保存（idle watchdog が進捗を見られる）。終端 `result` event の `response` を last-message.md にし、既存の marker 解析へ流す。
  - summary.edn に `:model`（既定は `agy-default`）、`:antigravity {:status :failure :finished-reason :usage}` を記録。
  - prompt に Antigravity 用 routing policy（他 CLI 起動禁止、資格情報・API 鍵・AI Credits 禁止、枠切れは blocked）を追加。
- `ai_ops_ledger.bb` / `ai_ops_sli.bb`: enum に agent `antigravity` / runtime `antigravity-cli` を追加。

## 検証

- runner self test に antigravity の route / 引数 / 環境除去 / result 解析 / quota・auth 判定を追加（全件 PASS）。
- fake `agy` を使った `run-agent!` 実行で、cwd・stdin 空・`GEMINI_API_KEY` / `AGY_ADC_AUTH` が子に渡らないこと、
  成功時 `done` marker の取得、枠切れ (RESOURCE_EXHAUSTED, exit 3) で marker なし非 0 → Blocked 経路になることを確認。
- 実バイナリ 1.5.12 で未ログイン時の挙動（ログイン URL を出し 60 秒待機後 `{"event":"result","result":{"status":"ERROR",...}}`、exit 1）を確認。
  D-Bus のないコンテナでは keyring を迂回してファイル保存する（同梱 changelog）。`/home/boxp` は PVC で永続。

## 配備後の手順（Owner 操作が必要な部分）

1. PR merge → codex-workspace image build → lolice の image 更新で Pod に `agy` が入る。
2. Owner が codex-workspace で一度 `agy` を対話起動し、表示 URL をブラウザで開いて公式ログインし、表示された認可コードを貼り付ける。
   `/config` で「Use AI Credits」が off であることも確認する（runner は毎回 off を強制する）。
3. 小さな実チケットを `assignee: antigravity` で実行し、PR / テスト / Notes / 停止再開を確認する。
