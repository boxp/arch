# BOXP-205: even-terminal 0.10 系対応と再発防止

## 背景

- Renovate PR #12979 で `@evenrealities/even-terminal` が 0.8.1 → 0.10.5 に automerge された。
- image build が直る (#13032) と同時に 0.10.5 入り image が配布され、codex-workspace の `workspace` コンテナが crash loop した。
- #13066 で 0.8.1 へ revert 済み（暫定復旧）。

## 原因

引数の非互換ではなく、0.10 系で入った次の 2 点。

1. `~/.even-terminal/config.json` が無いと初回セットアップウィザードを起動し、TTY が無いと
   `error: Setup requires an interactive terminal.` で exit 1 する。entrypoint は
   `exec even-terminal` なのでコンテナごと落ちる。`even-terminal config <key> <value>` も
   config が無いと失敗するため、CLI だけでは非対話ブートストラップできない。
2. bind 先が RFC1918 の private IPv4 のみになり、見つからないと `127.0.0.1` のみで listen する。
   Pod IP は private 範囲外のため、1 だけ直しても Service 経由 (:3456) で到達できない。

## 対応

| 対象 | 変更 |
| --- | --- |
| `docker/codex-workspace/Dockerfile` | `EVEN_TERMINAL_VERSION` を 0.10.5 へ更新 |
| `docker/codex-workspace/entrypoint.sh` | `~/.even-terminal/config.json` が無い場合のみ `jq` で最小 config を生成（`boxp` 権限で `mktemp` → `mv`、mode 0600。dir は `boxp` 書き込み可のため root では書かない）。既存 config は上書きしない |
| `docker/codex-workspace/entrypoint.sh` | 起動引数に `--interface "${EVEN_TERMINAL_INTERFACE:-eth0}"` を追加 |
| `tests/codex-workspace/even-terminal-smoke-test.sh` | build 済み image を TTY なし・空の HOME で起動し、eth0 アドレス:3456 の応答を確認する smoke test |
| `.github/workflows/build-codex-workspace-image.yml` | push 前に image を load して smoke test を実行（PR / main push / dispatch 共通） |
| `renovate.json5` | `@evenrealities/even-terminal` の automerge を無効化 |

### config.json の扱い

- 既定パスに無ければ生成し、既存のものは尊重する。`EVEN_TERMINAL_PORT` / `EVEN_TERMINAL_CWD` /
  `EVEN_TERMINAL_PROVIDER` / `EVEN_TERMINAL_NAME` / `EVEN_TERMINAL_TOKEN` は従来どおり CLI flag で渡す。
  優先順位は「CLI flag > 環境変数 > config file」なので env 由来の値が常に勝つ。
- token は `EVEN_TERMINAL_TOKEN`（SSM 由来の固定 token）をそのまま使うため、Even Realities App の
  再ペアリングは不要。未設定時のみランダム値を生成する。
- token は `jq` の `$ENV` 経由で渡し、entrypoint からはログに出さない。
  （even-terminal 自身の起動バナーが token を表示するのは 0.8.1 から変わらない upstream の挙動。）

### smoke test

- docker network を RFC1918 外の subnet（`203.0.113.0/24`）で作り、Pod と同じ
  「private IP が無い」状態を再現する。docker 既定の `172.17.0.0/16` だと 0.10 系の LAN 自動検出が
  通ってしまい、`--interface` 抜けを検知できないため。
- 確認内容: コンテナが生存 / eth0 アドレス:3456 の `/api/metrics` が token なしで 401・token ありで 200 /
  `config.json` が `boxp:boxp` `600`。

### Renovate

- even-terminal は 0.x で minor 更新が破壊的になり得るが、`major: {automerge: false}` では止まらない。
- image build は required check ではなく、check が失敗していても automerge される。
  そのため even-terminal は automerge 自体を無効化し、smoke test 成功を確認して手動 merge する。

## 範囲外

- image build check を ruleset の required check に入れること（path filter 付き workflow のため集約 job が必要）。
- codex-workspace の他の npm 0.x 系（`@openai/codex` など）の automerge 見直し。
- lolice 側 probe の変更（even-terminal の :3456 を probe 対象にするかどうか）。

## 検証

- ローカル: 0.10.5 + 旧 entrypoint の image では smoke test が fail、修正後の image では pass することを確認する。
- CI: `Build Codex Workspace Image` の smoke test step が成功すること。
- deploy 後: `kubectl -n codex-workspace get pod` で restart 0 のまま Running、
  `kubectl logs` に setup エラーや `listening on 127.0.0.1` 警告が無いこと、
  SSH (:2222) と Even Terminal (:3456) に WARP 経由で接続できること。

## Rollback

この PR を revert して main に merge する（#13066 と同じ手順）。`Build Codex Workspace Image` が
0.8.1 の image を再 build する。PVC に残る `config.json` は 0.8.1 では参照されないため無害。
