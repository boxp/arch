# Hermes 配備版 plugin / hook API の read-only 調査 (2026-10-29, Codex 委譲)

## 結論

このデプロイでメタデータ専用 observer を作るには、`/opt/hermes/plugins/<plugin名>/` に `plugin.yaml` と `__init__.py` を配置し、`register(ctx)` で observer フックを登録し、永続設定の `plugins.enabled` にプラグイン名を追加する方法が使えます。コールバックは**許可した識別子・状態・時間だけを抽出してハッシュ化**してください。フックのペイロード全体は、本文やツール引数を含むため JSONL に保存できません。

通常の lifecycle フックは配送完了を呼び出し側が待ちます。ストリーム observer だけが専用キューで非同期配送されるため、通常フックの callback は短時間でメモリ内キューに投入し、JSONL 書き込みを別 worker に任せる設計が必要です。

## 発見・有効化

- バンドルディレクトリは既定で `/opt/hermes/plugins`。環境変数 `HERMES_BUNDLED_PLUGINS` による変更も可能です。ユーザーディレクトリは `get_hermes_home()/plugins`、プロジェクトの `.hermes/plugins` は `HERMES_ENABLE_PROJECT_PLUGINS` で opt-in、Python entry point は `hermes_agent.plugins` グループです。ディレクトリの探索は `<root>/<name>/plugin.yaml` または `<root>/<category>/<name>/plugin.yaml` の深さまでです。`plugin.yml` も受け付けます。（コンテナ内 `hermes_cli/plugins.py:1–7,68–74`、`plugins_discovery.py:29,134–140,189–217`）
- ディレクトリプラグインは `plugin.yaml` と `__init__.py` の `register(ctx)` を使います。通常の `standalone` は `plugins.enabled` の allow-list で有効化し、`plugins.disabled` が優先します。カテゴリ付きの場合、キーは例えば `observability/my-observer` です。（`plugins_manifest.py:347–365`、`plugins_loader.py:719–727`、`plugins_discovery.py:112–129,257–303`）
- 現在の `/opt/data/config.yaml` の `plugins` 配下で確認できたのは `enabled` の `kohako-g2-context` です。読み取りでは設定値をこれ以上展開していません。
- 既存の配置例は `/opt/data/plugins/kohako-g2-context/{plugin.yaml,__init__.py}` です。manifest の `name`, `version`, `description`, `author`, `provides_hooks` と、`register(ctx)` 内の `ctx.register_hook(...)` をテンプレートにできます。（各ファイルの `plugin.yaml:1–10`、`__init__.py:53–58`）

最小構造は次の形です。

```text
/opt/hermes/plugins/boxp-observer/
├── plugin.yaml       # name: boxp-observer、provides_hooks: [...]
└── __init__.py       # register(ctx) から ctx.register_hook(name, callback)
```

`register_hook` は未知の名前でも警告して登録するため、名前の綴りを検証してください。通常の dispatch は callback の宣言した引数名に絞って kwargs を渡し、`**kwargs` なら全て渡します。（`plugins.py:943–945`、`plugins_dispatch.py:229–254`）

## フックとペイロード

`VALID_HOOKS` の全名前は `hermes_cli/plugins.py:108–203` にあります。**`on_llm_call` や `on_approval...` という名前はなく**、以下の名前を使います。通常の plugin dispatch は、`gateway_platform_event` を除き `telemetry_schema_version` を追加します。（`plugins_dispatch.py:270–273`）

| フック | 確認できた kwargs／注意点 |
|---|---|
| `pre_llm_call` | `session_id`, `task_id`, `turn_id`, `user_message`, `conversation_history`, `is_first_turn`, `model`, `platform`, `parent_session_id`, `sender_id`。本文・履歴を含む。（`agent/turn_context.py:810–822`） |
| `post_llm_call` | `session_id`, `task_id`, `turn_id`, `user_message`, `assistant_response`, `conversation_history`, `model`, `platform`。本文を含む。（`agent/turn_finalizer.py:469–479`） |
| `on_session_end` | この呼び出し箇所では `session_id`, `task_id`, `turn_id`, `completed`, `failed`, `interrupted`, `turn_exit_reason`, `model`, `platform`。（`agent/turn_finalizer.py:797–808`） |
| `on_session_start` | `session_id`, `model` は確認。全 kwargs は未確認。（`agent/conversation_loop.py:937`） |
| `post_tool_call` | `tool_name`, `args`, `result`, `task_id`, `session_id`, `tool_call_id`, `turn_id`, `api_request_id`, `duration_ms`, `status`, `error_type`, `error_message`, `middleware_trace`。引数・結果・エラー本文を含み得る。（`model_tools.py:674–695`、`agent/inline_tool_executors.py:20–27`） |
| `pre_tool_call` | ポリシー用フック。ツール名・引数と呼び出し識別子を扱う。全 kwargs は今回未確認。タイムアウトや例外はツールをブロックするため、observer 用には特に注意が必要。 |
| `pre_approval_request`, `post_approval_response` | 共通で `command`, `description`, `pattern_key`, `pattern_keys`, `session_key`, `surface`、後者は `choice`, `decided_by` を追加。コマンドや説明を含む。（`plugins.py:143–146`） |
| `on_stream_start`, `on_stream_delta`, `on_stream_end`, `on_interim_message` | 共通で `turn_id`, `iteration`, `session_id`, `model`, `provider`, `surface`。それぞれ追加で、delta は `delta`, `kind`、end は `final_text`, `finished`, `error`、interim は `text`, `already_streamed`。正規化されたテキストであり、本文は除去されていない。（`agent/stream_delivery.py:282–296,332,362,215`） |
| `api_request_error` | `task_id`, `turn_id`, `api_request_id`, `session_id`, `platform`, `model`, `provider`, `base_url`, `api_mode`, `api_call_count`, `api_duration`, `started_at`, `ended_at`, `status_code`, `retry_count`, `max_retries`, `retryable`, `reason`, `error`, `request`。（`agent/api_request_hooks.py:176–197`） |
| `pre_api_request`, `post_api_request`, `pre_auxiliary_call`, `post_auxiliary_call` | 利用可能。auxiliary は API request と同形に `aux_task` を追加する契約。今回、全 kwargs は確認できていません。（`plugins.py:118–123`） |
| `kanban_task_claimed`, `kanban_task_completed`, `kanban_task_blocked` | 共通で `task_id`, `board`, `assignee`, `run_id`, `profile_name`。completed は `summary`、blocked は `reason` を追加。（`plugins.py:157–161`） |
| `on_kanban_worker_spawned`, `on_kanban_worker_exited`, `on_kanban_worker_stale_claim`, `on_kanban_task_updated` | 共通で `task_id`, `profile_name`, `board`, `assignee`, `run_id`。追加は順に `worker_pid`, `workspace_path`／`worker_pid`, `exit_kind`, `exit_code`, `outcome`, `retry_status`／`worker_pid`, `heartbeat_stale`, `retry_status`／`changed_fields`。（`plugins.py:162–176`） |
| `on_kanban_dispatch_tick` | `board`, `profile_name`, `dry_run`, `outcome`, `result`。`result` はタスク ID、担当者、パスを含み得る。（`plugins.py:172–187`） |
| `gateway_platform_event` | `platform`, `event_type`, `payload`。SDK オブジェクトではなくイベントごとの正規化 envelope ですが、`payload` の内容を一律にメタデータ専用とはみなせません。（`plugins.py:177–193`） |
| `pre_command` | `surface`, `command`, `alias_used`, `args_raw`, `session_key`, `platform`。`args_raw` は保存対象から除外。（`plugins.py:195–201`） |
| `agent_loop_stopped` | `session_key`, `platform`, `reason`, `invalidation_reason`。（`plugins.py:139–142`） |
| `post_compaction` | `session_id`, `old_session_id`, `kind`, `reason`, `before_tokens`, `after_tokens`, `messages_removed`。（`agent/compaction_events.py:247`） |
| `on_skill_lifecycle` | `action`, `skill_name`, `provenance`, `task_id`, `session_id`, `use_count`, `reused`, `reuse_after_patch`。（`tools/skill_usage.py:477`） |
| `subagent_stop` | `parent_session_id`, `parent_turn_id`, `child_session_id`, `child_role`, `child_summary`, `child_status`, `tool_call_history`, `duration_ms`。要約と履歴を含む。（`tools/delegate_tool_results.py:381`） |

残る登録可能な名前は `transform_terminal_output`, `transform_tool_result`, `transform_llm_output`, `pre_verify`, `transform_api_error_classification`, `on_session_finalize`, `on_session_reset`, `on_session_delete`, `subagent_start`, `pre_gateway_dispatch`, `post_gateway_admission`, `on_human_input_request`, `on_human_input_resolved`, `on_room_member_activity`, `pre_transcription` です。**それぞれの完全な kwargs とサニタイズ契約は今回未確認**です。特に `pre_gateway_dispatch` は `event`, `gateway`, `session_store` を受け、`pre_transcription` は `prompt` を含みます。`on_room_member_activity` は room/thread/member/turn/task の識別子と `kind`, `seq`, `payload`, `execution_generation` を含み、payload は client-safe、承認情報は redact 済みと記載されています。（`plugins.py:124–156`）

API request 用の sanitizer は機密キーの除去、JSON 化、サイズ制限を行いますが、request body や response content は残り得ます。**サニタイズ済みでも本文なしとは限りません。**（`agent/api_request_hooks.py:60–64,118–159`）

相関には、利用できるフックごとに `session_id`, `session_key`, `turn_id`, `task_id`, `tool_call_id`, `api_request_id`, `parent_session_id`, `run_id` をハッシュ化できます。`platform` は LLM・セッション系、`surface` はストリーム系で確認できました。フック間ですべての識別子が揃う保証はありません。

## 配送と障害

- 通常の `invoke_hook` は callback を順番に実行して結果を待ちます。一部は daemon worker と既定 30 秒の timeout を使いますが、その時間まで呼び出し側は待ち得ます。対象外は同期的に完了まで実行されます。例外は捕捉・報告されますが、`pre_tool_call` は例外・timeout 時に fail-closed でブロックします。（`plugins_dispatch.py:26–33,42–62,164–165,256–294,320–326`）
- ストリームと room activity は callback ごとの daemon worker と長さ 1024 のキューを使い、満杯時は古いイベントを落とします。callback の例外は捕捉・報告されます。したがって完全な監査台帳としての配送保証はありません。（`agent/plugin_stream_hooks.py:1–7,22,60–83,133–145`、`plugins.py:147–151`）
- `lifecycle.invoke_hook` は組み込み observer に続けて plugin hook を呼びます。safe-worker モードでは無効化されます。（`hermes_cli/lifecycle.py:11–37`）

## 配置と宣言

`/opt/data` は `hermes:hermes` 所有の group-writable ディレクトリで、宣言上は PVC `hermes-agent-data` が使われています。実際の Hermes Python プロセスは `hermes`、UID `1000` で動いていました。`kubectl exec` 自体は root なので、その `id` を agent プロセスの UID と混同しないでください。専用サブディレクトリの権限と JSONL の容量管理は実装時に設計する必要があります。（`lolice` の `deployment.yaml:26–27,333–336,484–487`）

指定された [Dockerfile](/home/boxp/.codex-task-board/workspaces/BOXP-360/20261029T055735Z-3652ef0a-df77-40e5-87fb-1105d53cbe57/ghq/github.com/boxp/arch/docker/hermes-agent/Dockerfile:6) は upstream イメージをベースにし、現在は skills と patches を COPY しています。新しいプラグインを例えば `/opt/hermes/plugins/boxp-observer/` に COPY すれば通常のバンドル探索対象です。実際の build context 内の配置は別途決める必要があります。

`lolice` の `origin/main:argoproj/hermes-agent/configmap.yaml:34–36` は初期設定の `plugins.enabled` を宣言しています。ただし `deployment.yaml:45–48` は永続 `config.yaml` が**存在しない場合だけ**初期設定をコピーします。既存 plugin については init container がファイルを `/opt/data/plugins` にコピーし、永続 YAML の allow-list に追加する移行処理を持ちます（`deployment.yaml:121–155`）。従って ConfigMap の初期値を編集するだけでは、既存 PVC 上の設定更新は保証されません。

画像内の `/opt/hermes/plugins/observability` と langfuse 名の該当ディレクトリは確認できませんでした。`plugins_discovery.py:265` には旧 `observability/langfuse` が core から移動した旨のコメントがありますが、画像内の別の observer 実装の存在は未確認です。

調査は読み取りのみで、クラスタ状態の変更や再起動は行っていません。
