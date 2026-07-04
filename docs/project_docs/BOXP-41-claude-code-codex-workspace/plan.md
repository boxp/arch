# BOXP-41 codex-workspace Claude Code CLI

## 目的

`ghcr.io/boxp/arch/codex-workspace` image に Claude Code CLI を含め、Task Board worker の実行環境から必要時に `claude` コマンドを呼び出せる状態にする。

## 公式情報確認

2026-07-04 時点で Claude Code 公式ドキュメントを確認した。

- 対応 OS は Ubuntu 20.04+ / Debian 10+、x64 または ARM64、ネットワーク接続必須。
- `claude --version` がインストール確認コマンド。
- npm global install は引き続きサポートされ、`@anthropic-ai/claude-code` は Node.js 22+ を要求する。
- npm package は platform optional dependency 経由で native binary を導入し、インストール後の `claude` 自体は Node.js を起動しない。
- Claude Code は初回起動時に browser login を要求するが、container/SSH では login URL/code の手動処理が必要になる場合がある。
- 非対話実行 `-p` では `ANTHROPIC_API_KEY` が設定されていれば利用される。
- CI や script では `claude setup-token` で生成した `CLAUDE_CODE_OAUTH_TOKEN` を利用できる。

参照:

- https://code.claude.com/docs/en/setup
- https://code.claude.com/docs/en/authentication
- https://www.npmjs.com/package/@anthropic-ai/claude-code

## 実装

- `docker/codex-workspace/Dockerfile`
  - `CLAUDE_CODE_VERSION=2.1.201` を追加する。
  - 既存の NodeSource `NODE_MAJOR=24` を利用する。Claude Code npm package の Node.js 22+ 要件を満たす。
  - 既存の npm global install block に `@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}` を追加する。
  - npm cache は既存通り install 後に削除する。
  - npm global binary の install 先は既存 Node.js 環境の `/usr/bin` 配下で、image の `PATH=/home/boxp/.local/bin:/home/boxp/go/bin:/usr/local/bin:/usr/bin:/bin` から解決できる。
- `docker/codex-workspace/entrypoint.sh`
  - 実行時に注入された Claude Code 認証関連 env を `/run/codex-workspace/session-env` と `runuser --whitelist-environment` で SSH / Even Terminal session に引き継ぐ。
  - 対象 env は `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_OAUTH_TOKEN`, `CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_USE_VERTEX`, `CLAUDE_CODE_USE_FOUNDRY`。
  - `/run/codex-workspace/session-env` は container runtime 内の一時ファイルで、Docker image layer / repository / build log には含めない。
- `renovate.json5`
  - `CLAUDE_CODE_VERSION` を npm datasource の custom manager 対象に追加する。

## 認証運用

- Docker build 時に Claude Code の認証情報は要求しない。
- Dockerfile, repository, ticket, CI log, worker log に個人 token / session 情報 / credential を保存しない。
- 認証情報は実行時に Kubernetes Secret / ExternalSecret / secret mount / 環境変数など既存の安全な注入機構で渡す。
- API key を使う場合は `ANTHROPIC_API_KEY` を実行時 env として注入する。
- subscription OAuth token を使う場合は、利用者が別環境で `claude setup-token` を実行し、得られた token を `CLAUDE_CODE_OAUTH_TOKEN` として安全な secret store に登録する。
- container 内で login flow を実行する場合は、`~/.claude` や `~/.claude.json` が persistent home volume に残る可能性がある。自動 worker では token env 注入を優先する。

## Task Board worker からの呼び出し想定

現行の Task Board runner は Codex を主実行系として維持し、Claude Code は個別タスク内で必要時に補助的に呼び出す。

- 呼び出し場所: Codex が起動した ticket run workspace 内、または repo ごとの per-run worktree。
- 作業ディレクトリ: `docker/codex-workspace/task-board/task_board_runner.bb` が prompt に記録する `Ticket run workspace` または `Repository worktrees for this run` の対象 path。
- 環境変数: worker Pod/container 起動時に secret から Claude Code env を注入し、entrypoint が SSH / Even Terminal session へ引き継ぐ。明示的に subprocess へ渡す場合は `env ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" ... claude -p ...` の形にする。
- タイムアウト: 自動処理では `timeout 600s claude -p '...'` を初期値とし、長い調査・実装委譲では task ごとに延長する。
- 失敗時の扱い: `claude` の exit code、stderr、最後の要約だけを残し、secret 値は出力しない。認証エラー、rate limit、timeout、network error はチケット Notes に原因区分だけ記録する。
- Codex へのフォールバック: Claude Code が未認証、timeout、非 0 exit、または利用制限で失敗した場合、Task Board worker の主処理は Codex 側で継続する。Claude Code の失敗だけで ticket runner 全体を失敗させない。

最小の非対話検証例:

```bash
timeout 120s claude -p "Reply with OK only."
```

secret をログに出さないため、検証時は `env | grep` や shell trace (`set -x`) を使わない。

## 検証結果

実行済み:

```bash
bash -n docker/codex-workspace/entrypoint.sh
npx --yes --package renovate renovate-config-validator renovate.json5
DOCKER_BUILDKIT=0 docker build -t codex-workspace:boxp-41 docker/codex-workspace
docker run --rm --entrypoint /bin/bash codex-workspace:boxp-41 -lc 'claude --version && codex --version'
docker run --rm --entrypoint /bin/bash codex-workspace:boxp-41 -lc 'test -z "${ANTHROPIC_API_KEY:-}" && codex --version'
docker run --rm -e ANTHROPIC_API_KEY=redacted --entrypoint /bin/bash codex-workspace:boxp-41 -lc '/usr/local/bin/codex-workspace-entrypoint >/tmp/entrypoint.log 2>&1 & pid=$!; for i in $(seq 1 30); do [ -r /run/codex-workspace/session-env ] && break; sleep 1; done; grep -q "ANTHROPIC_API_KEY" /run/codex-workspace/session-env; kill $pid; wait $pid 2>/dev/null || true'
tests/codex-workspace/task-board-runner-test.sh
```

結果:

- `bash -n docker/codex-workspace/entrypoint.sh` は成功。
- `npx --yes --package renovate renovate-config-validator renovate.json5` は `Config validated successfully against 1 file(s)` で成功。
- BuildKit ありの `docker build -t codex-workspace:boxp-41 docker/codex-workspace` は、この worker の Docker buildx component が壊れているため開始前に失敗した。
- `DOCKER_BUILDKIT=0 docker build -t codex-workspace:boxp-41 docker/codex-workspace` は成功。
- container 内で `/usr/bin/claude` が解決され、`claude --version` は `2.1.201 (Claude Code)` を返した。
- container 内で `/usr/bin/codex` が解決され、`codex --version` は `codex-cli 0.142.5` を返した。
- 認証情報未設定の container でも `codex --version` と `claude --version` は成功した。
- `ANTHROPIC_API_KEY=redacted` を runtime env として渡した container で、entrypoint が `/run/codex-workspace/session-env` に `ANTHROPIC_API_KEY` の export 行を作ることを確認した。実 secret は使っていない。
- `tests/codex-workspace/task-board-runner-test.sh` は `task-board-runner tests passed` で成功。Claude 認証情報未設定でも既存の Task Board worker ロジックは壊れていない。
- 2026-07-04 の再開 run で `npm view @anthropic-ai/claude-code version` を再確認し、`2.1.201` が npm latest と一致することを確認した。
- PR conflict は、main 側で先行 merge された `@openai/codex` `0.142.5` 更新に対して branch 側を追従させて解消した。

認証情報を使った最小非対話検証は、安全な検証環境で次を実行する。結果ログには secret 値を含めない。

```bash
timeout 120s claude -p "Reply with OK only."
```

この Task Board worker には `ANTHROPIC_API_KEY` / `CLAUDE_CODE_OAUTH_TOKEN` が設定されていなかったため、認証付き smoke test は未実施。review 後、secret 注入済みの検証環境で上記コマンドを実行する。

## 制限事項

- この変更は Claude Code CLI を image に含めるだけで、Task Board runner の主実行系は Codex のままにする。
- Claude Code の個人 token / session / OAuth token の発行と登録はスコープ外。
- 認証情報が未設定の場合、`claude --version` は成功するが、実モデル呼び出しは認証エラーになる。
- Docker image build はネットワーク越しに npm registry と各 upstream release を参照するため、registry 障害時は再実行する。
