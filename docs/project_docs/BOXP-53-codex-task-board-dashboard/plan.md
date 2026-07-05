# BOXP-53 codex-task-board dashboard Cloudflare plan

## Scope

`boxp/lolice` 側で追加する codex-workspace Task Board Dashboard を、既存の k8s Cloudflare tunnel 経由で公開する。Dashboard は読み取り専用で、Cloudflare Access の GitHub login を必須にする。

## Resources

- DNS: `codex-task-board.b0xp.io`
- Tunnel: existing `cloudflare_zero_trust_tunnel_cloudflared.k8s_tunnel`
- Service target: `http://codex-task-board-dashboard.codex-workspace.svc.cluster.local:8080`
- Access application: `codex-task-board.b0xp.io`
- Access policy: GitHub identity provider login method

## Validation

- `terraform fmt -check` で formatting を確認する。
- `terraform validate` は backend/provider 初期化が必要なため、可能なら `terraform -chdir=terraform/cloudflare/b0xp.io/k8s init -backend=false` 後に実行する。
