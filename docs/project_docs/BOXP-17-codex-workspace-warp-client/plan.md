# BOXP-17: Codex workspace WARP client

Codex workspace から `even-g2-main.b0xp.io` を、クラスタ内 Service 直通ではなく Cloudflare WARP 利用者と同じ private hostname route で確認できるようにする。

## Scope

- `docker/codex-workspace` image に Cloudflare WARP client を追加する。
- workspace entrypoint で MDM 設定を生成し、Service Token による headless enrollment を行う。
- Cloudflare Terraform で WARP enrollment 用の Service Token / device enrollment policy / WARP Access application を作成する。
- WARP enrollment 用の `auth_client_id` / `auth_client_secret` / organization を Terraform から AWS SSM Parameter Store に保存し、workspace に渡せるようにする。
- `even-g2-main.even-g2-lab.svc.cluster.local` への直接NetworkPolicy例外は追加しない。

## Notes

- Service Token の `client_secret` は Terraform state に残る。既存の Cloudflare tunnel token / Access service token と同じ運用前提で扱う。
- Cloudflare Zero Trust team name の初期値は `b0xp` とする。実際の team name が異なる場合は `cloudflare_zero_trust_team_name` を上書きする。
- Pod の network namespace に WARP route を作るため、lolice 側で workspace container に `NET_ADMIN` と `/dev/net/tun` 相当の権限を付与する。
- WARP 接続が壊れても workspace 自体を落とさないため、初期値は `CLOUDFLARE_WARP_REQUIRED=false` とする。
