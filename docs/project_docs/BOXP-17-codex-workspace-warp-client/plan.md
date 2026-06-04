# BOXP-17: Codex workspace WARP client

Codex workspace から `even-g2-main.b0xp.io` を、クラスタ内 Service 直通ではなく Cloudflare WARP 利用者と同じ private hostname route で確認できるようにする。

## Scope

- `docker/codex-workspace` image に Cloudflare WARP client を追加する。
- workspace entrypoint で MDM 設定を生成し、Service Token による headless enrollment を行う。
- Cloudflare Terraform で WARP enrollment 用の Service Token / device enrollment policy を作成する。
- WARP enrollment 用の `auth_client_id` / `auth_client_secret` / organization を Terraform から AWS SSM Parameter Store に保存し、workspace に渡せるようにする。
- `even-g2-main.even-g2-lab.svc.cluster.local` への直接NetworkPolicy例外は追加しない。
- 既存の Cloudflare One Client Access application を Terraform に import し、Codex workspace 用 service token policy を device enrollment permissions に追加する。

## Notes

- Service Token の `client_secret` は Terraform state に残る。既存の Cloudflare tunnel token / Access service token と同じ運用前提で扱う。
- WARP Access application は account 内で既に存在するため、新規作成ではなく既存の Cloudflare One Client application を `b0xp.cloudflareaccess.com/warp` domain の data source + import block で state 管理に寄せる。
- Cloudflare Zero Trust team name の初期値は `b0xp` とする。実際の team name が異なる場合は `cloudflare_zero_trust_team_name` を上書きする。
- Pod の network namespace に WARP route を作るため、lolice 側で workspace container に `NET_ADMIN` と `/dev/net/tun` 相当の権限を付与する。
- WARP 接続が壊れても workspace 自体を落とさないため、初期値は `CLOUDFLARE_WARP_REQUIRED=false` とする。
- 2026-06-04: rollout 後の workspace で `warp-cli` と MDM env は入っていたが、registration が `Does not exist in API` / `ApiMismatch` で無効化され、`https://even-g2-main.b0xp.io/` は DNS 解決できなかった。原因は service token policy を作成しただけで Cloudflare One Client の device enrollment permissions に紐付けていなかったこと。Cloudflare 公式 docs では service token enrollment policy を Cloudflare One Client application に追加する必要がある。
- 2026-06-04: entrypoint は `connect` 前に `registration show` / `registration new <organization>` を明示し、失敗内容を `/tmp/cloudflare-warp-registration` に残すようにする。
