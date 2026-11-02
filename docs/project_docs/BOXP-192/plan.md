# BOXP-192: Task Board の Claude Code モデル選択

## 目的と対応表

Task Board runner は次の Claude 担当を受け付ける。新担当は対応する完全なモデル ID を必ず `claude --model` に渡すため、CLI の短縮名やアカウント既定値に依存しない。

| 担当名 | CLI 引数 | 必要な Claude Code 版 |
| --- | --- | --- |
| `claude-fable` | `--model claude-fable-5-1` | 2.1.257 以上 |
| `claude-opus` | `--model claude-opus-5-5` | 2.1.280 以上 |
| `claude-sonnet` | `--model claude-sonnet-5-5` | 2.1.284 以上 |
| `fable` | CLI 既定、または `CODEX_TASK_BOARD_FABLE_MODEL` | 既存互換 |

`fable` は互換用の既存経路である。`CODEX_TASK_BOARD_FABLE_MODEL`、`CODEX_TASK_BOARD_FABLE_AGENT`、`CODEX_TASK_BOARD_FABLE_EXTRA_ARGS` は `fable` にのみ適用する。`claude-fable`、`claude-opus`、`claude-sonnet` はこれらを読まず、上表のモデル ID を優先する。全 Claude 担当は Claude 用 prompt、`~/.claude` の Task Board helper、stdout の `last-message.md` 保存、exit code と result marker の既存処理を使う。

モデル ID と必要 CLI 版は [Claude models overview](https://platform.claude.com/docs/en/models/overview) と [Claude Code model configuration](https://code.claude.com/docs/en/model-config) を 2026-09-29 に確認した。

Codex 担当とレーン、lock、PR review gate の挙動は変更しない。不正な Claude 担当名や `claude-*-<reasoning>` は対象外として拒否する。

## image と起動経路

image の `CLAUDE_CODE_VERSION` は 2.1.284 とする。Dockerfile は `CODEX_TASK_BOARD_CLAUDE_BIN=/usr/bin/claude` を設定し、image 内の runner は Claude 担当の起動にこの変数を用いる。これは PVC 上の `/home/boxp/.local/bin/claude` が `PATH` の先頭にあっても、image 同梱の CLI を選ぶためである。Docker `ENV` がない単体 runner は、既存互換のため未設定時に `claude` を `PATH` から解決する。

環境で `CODEX_TASK_BOARD_CLAUDE_BIN` を上書きする場合も、上表に必要な版を満たす絶対パスだけを指定する。認証情報や home の既存 CLI は削除しない。

## 実装・検証

- fake Claude による runner test で、3 新担当の `--model`、旧 `fable` の既定と環境変数、環境変数の適用範囲、不正担当、成功・失敗・marker 処理を検証する。
- runner 内蔵テスト、`tests/codex-workspace/task-board-runner-test.sh`、既存 CI を実行し、Codex routing と lock/レーン/PR gate の回帰を確認する。
- `model-smoke-results.json` は、既存認証環境で 2026-09-29 に実行した最小非対話 smoke の秘匿済み記録である。`claude-fable-5-1`、`claude-opus-5-5`、`claude-sonnet-5-5` はいずれも exit 0、`OK`、構造化結果の requested/canonical model 一致を確認した。この結果は image build・deployment 前の CLI 検証であり、展開済み Pod の確認を意味しない。

  ```sh
  claude --print --model "$MODEL" --output-format json --tools '' \
    --strict-mcp-config --setting-sources '' \
    --settings '{"disableAllHooks":true}' --no-session-persistence \
    'Reply with exactly OK.'
  ```
- 更新イメージの build、PATH shadow 検証、内蔵テスト、3モデルの実行も成功した。`image-model-smoke-results.json` と `validation.md` を参照する。本番 rollout は未実施。
- `boxp/lolice` の read-only dashboard は run summary の `:agent` を API と UI に表示する。旧 summary に `:agent` がなければ `-` として表示する。

## 展開手順

1. arch PR を merge し、image build workflow で生成された digest を確認する。2.1.284 未満の image は配布しない。
2. lolice の dashboard PR を merge して ConfigMap を同期する。image digest を Deployment に pin または更新する必要があれば、それは image build 完了後の別の GitOps 変更として用意する。single replica / `Recreate` の既存方針を維持し、Task Board card を手動で動かさない。
3. rollout 前に active lock と run を確認する。実行中 run があれば完了を待つか、既存 `preStop` の `prepare-shutdown` により中断を記録することを確認してから rollout する。

   ```sh
   kubectl -n codex-workspace get pods -l app=codex-workspace
   kubectl -n codex-workspace exec deploy/codex-workspace -c task-board-runner -- \
     sh -lc 'find /home/boxp/.codex-task-board/locks -maxdepth 1 -type f -name "*.edn" -print'
   kubectl -n codex-workspace rollout status deploy/codex-workspace --timeout=10m
   ```

4. 新 Pod で実行バイナリと版を記録する。`command -v claude` は参考値であり、runner が使用するのは `CODEX_TASK_BOARD_CLAUDE_BIN` である。

   ```sh
   kubectl -n codex-workspace exec deploy/codex-workspace -c task-board-runner -- sh -lc '
     printf "%s\\n" "$CODEX_TASK_BOARD_CLAUDE_BIN"
     "$CODEX_TASK_BOARD_CLAUDE_BIN" --version
     command -v claude
     claude --version
   '
   ```

5. 既存認証環境で各新担当を一つずつ最小非対話で実行し、構造化結果の requested/canonical model を run artifact と ticket Notes に記録する。利用不可の場合はその担当を「検証未了」と記録し、他モデルの成功で代用しない。secret を表示する `env`、`set -x`、token を含むログは使わない。
6. dashboard の `/api/runs` と画面で `agent: claude-fable` 等を表示できることを確認する。dashboard は read-only のままとする。

## 復旧

rollout 後に CLI 版、runner 起動、または Claude 実行に問題があれば、直前の image digest と lolice revision に戻し、`rollout status` と lock/retry 状態を確認する。停止前の lock は runner の既存 shutdown/stale-lock recovery に任せ、手動削除は既存の運用手順で必要条件を満たす場合だけ行う。`CODEX_TASK_BOARD_CLAUDE_BIN` を home CLI へ戻して回避しない。
