# BOXP-582: 通知 channel 試作の撤去（arch 側）

- plugin 正本は boxp/lolice `argoproj/hermes-agent/plugins/boxp-notify/`。`prototypes/hermes-notify-channel/plugin/` はその byte 同一の複製で、どの build・配備にも使われていなかった。
- 隔離試験（`lab/`）は lolice へ正式な回帰試験として移した:
  - 単体: `argoproj/hermes-agent/plugins/boxp-notify/test_boxp_notify.py`（lolice の Manifest Validation で毎 PR 実行）
  - 統合: `tests/hermes-agent/notify-lab/`（本番 image＋lolice manifest＋本 repo の無改変 dispatcher `docker/codex-workspace/task-board/task_board_events.bb`、`--network none`）と `.github/workflows/hermes-notify-lab.yaml`
- このため arch の `prototypes/hermes-notify-channel/` を削除する。上流 Hermes 更新（Renovate、`docker/hermes-agent/Dockerfile`）の検証は lolice の notify-lab で行う（renovate.json5 の BOXP-313 rule にも記載）。
- 本番配備経路（`docker/hermes-agent/` の image build、lolice の manifest）は変更しない。
