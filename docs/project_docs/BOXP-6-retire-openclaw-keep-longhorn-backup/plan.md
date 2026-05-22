# BOXP-6: OpenClaw を停止・撤去し、Longhorn backup を保持する

## Summary

OpenClaw が不要になったため、`boxp/lolice` の Kubernetes runtime resources と `boxp/arch` の周辺 infrastructure を撤去して占有リソースを解放する。
ただし Longhorn backup は復旧用データとして保持し、Longhorn backup 用の S3/IAM/SSM と Longhorn UI の入口は削除対象から外す。

## Repositories

- `boxp/lolice`: OpenClaw の ArgoCD Application、Kubernetes manifests、PVC、ImageUpdater、Grafana dashboards など runtime 側の主作業。
- `boxp/arch`: OpenClaw 用 Cloudflare tunnel/DNS/Access、SSM parameters、custom image build assets など infrastructure 側の後片付け。

## Keep

- `boxp/arch`
  - `terraform/aws/longhorn/`
    - S3 bucket `boxp-longhorn-backup`
    - Longhorn backup 用 IAM user/access key
    - `/longhorn/backup/*` SSM parameters
  - `terraform/cloudflare/b0xp.io/longhorn/`
    - `longhorn.b0xp.io` の DNS / tunnel / Access application
- `boxp/lolice`
  - `argoproj/longhorn/`
  - Longhorn backup target と既存 backup data

## Remove Or Disable

### boxp/lolice

- `argoproj/openclaw/`
  - `Application/openclaw`
  - `Namespace/openclaw`
  - `Deployment/openclaw`
    - OpenClaw gateway
    - DinD sidecar
    - board-server sidecar
    - config-manager / docker-gc sidecars
  - `Deployment/litellm`
  - `Deployment/cloudflared`
  - `PVC/openclaw-data` (`storageClassName: longhorn`, `10Gi`)
  - `ExternalSecret/openclaw-es`
  - `ExternalSecret/litellm-es`
  - Services, ConfigMaps, NetworkPolicies
- `argoproj/argocd-image-updater/imageupdaters/openclaw.yaml`
- OpenClaw 用 Grafana dashboards / dashboard mounts
  - `argoproj/prometheus-operator/grafana-dashboard-openclaw.yaml`
  - `argoproj/prometheus-operator/grafana-dashboard-openclaw-app.yaml`
  - `argoproj/prometheus-operator/overlays/grafana.yaml` の OpenClaw dashboard mount
- OpenClaw 用 cross-namespace NetworkPolicy 例外
  - Prometheus / Grafana から `openclaw` namespace を参照する policy
- OpenClaw 運用 docs
  - `docs/openclaw-image-update-ops.md`
  - `docs/renovate-openclaw-ops.md`
  - `docs/openclaw-cron-webhook-ops.md`

### boxp/arch

- `terraform/aws/openclaw/`
  - `/lolice/openclaw/*` SSM parameters
- `terraform/cloudflare/b0xp.io/openclaw/`
  - `openclaw.b0xp.io`
  - `board.b0xp.io`
  - OpenClaw tunnel
  - Cloudflare Access applications/policies
- `docker/openclaw/`
- `.github/workflows/build-openclaw-image.yml`
- `docs/openclaw-image-update-responsibility.md`

## Acceptance Criteria

- [x] `openclaw-data` volume の最新 Longhorn backup が存在することを確認する。
- [x] `openclaw-data` の PVC/PV は Retain せず、Longhorn backup のみを保持して manifests から削除する。
- [x] `boxp/lolice` で OpenClaw Application/workloads/ImageUpdater/dashboard/network policy 例外が削除される。
- [x] `boxp/arch` で OpenClaw 専用 Cloudflare resources、SSM parameters、custom image build assets が削除される。
- [x] `terraform/aws/longhorn/` と `terraform/cloudflare/b0xp.io/longhorn/` は保持され、diff に Longhorn 関連削除が含まれない。
- [x] `argoproj/longhorn/` と Longhorn backup target は保持される。
- [ ] 作業後に `openclaw` namespace の Pod/PVC が残っていない、または意図した Retain 状態だけが残っている。
- [ ] 作業後に Longhorn backup target と既存 backup を参照できる。

## Plan

- [x] 現状確認
  - `kubectl get all,pvc -n openclaw`
  - `kubectl top pod -n openclaw`
  - Longhorn UI/API で `openclaw-data` volume の latest backup を確認
- [x] backup 保持方針の確定
  - Longhorn backup を残す
  - PVC/PV は Retain せず、GitOps prune で削除して占有 storage を解放する
- [x] `boxp/lolice` 側を撤去
  - ArgoCD ImageUpdater から `openclaw` を削除
  - ArgoCD Application `openclaw` と `argoproj/openclaw/` を削除
  - Prometheus/Grafana の OpenClaw dashboard と network policy 例外を削除
  - OpenClaw 運用 docs を削除または archive
- [x] `boxp/arch` 側を撤去
  - `terraform/aws/openclaw/` を destroy plan の対象にする
  - `terraform/cloudflare/b0xp.io/openclaw/` を destroy plan の対象にする
  - `docker/openclaw/` と build workflow を削除
  - OpenClaw image update responsibility doc を削除
- [x] 検証
  - lolice: `kubectl kustomize argoproj` または既存の manifest validation
  - arch: `terraform fmt`
  - arch: OpenClaw 対象 working directory の `terraform validate`
- [ ] PR / tfaction plan
  - tfaction plan で OpenClaw destroy のみであることを確認
  - Longhorn resources が destroy 対象に入らないことを確認

## Risks

- `Application/openclaw` は `resources-finalizer.argocd.argoproj.io` を持つため、削除時に namespace 配下の resources が prune される。PVC/PV の扱いを先に決める。
- `board.b0xp.io` は OpenClaw tunnel と board-server sidecar に同居している。不要なら一緒に削除、必要なら別サービスへ移す。
- `ExternalSecret` は `deletionPolicy: Retain` なので、Kubernetes Secret が残る可能性がある。撤去後に残留 secret を確認する。
- `/lolice/openclaw/*` SSM parameters を削除すると再構築時に secrets を復元できなくなる。撤去後の再利用予定がない前提で削除する。
- Terraform working directory 自体を削除すると destroy plan を出せない場合があるため、tfaction で destroy を出す順序を確認する。

## Notes

- チケット: [[Tickets/BOXP-6]]
- Longhorn backup は OpenClaw runtime の撤去とは別責務として扱う。
- `boxp/lolice` 側の撤去が先、`boxp/arch` 側の入口・secret・image build assets の削除が後。
- 2026-05-22 の確認結果:
  - `openclaw` namespace では `cloudflared`, `litellm`, `openclaw` の3 Deployment が Running。
  - `openclaw/openclaw-data` は PV `pvc-24dd53a6-9edf-4daf-ae23-ee101dd8616c`、Longhorn 10Gi、reclaimPolicy `Delete`。
  - Longhorn backup volume `pvc-24dd53a6-9edf-4daf-ae23-ee101dd8616c-55f03aa6` が存在。
  - 最新 backup は `backup-2ccefb59484f48aa`、作成時刻 `2026-05-21T00:00:57Z`、状態 `Completed`。
  - 実使用量は `litellm` 約 942Mi、`openclaw` 約 588Mi、`cloudflared` 約 19Mi、その他 sidecar 約 72Mi。
  - 2026-05-22 の実装結果:
    - `boxp/lolice` から `argoproj/openclaw/`、OpenClaw ImageUpdater、Grafana dashboards、monitoring NetworkPolicy 例外、OpenClaw 運用 docs を削除。
    - `boxp/arch` から OpenClaw 用 Cloudflare tunnel/DNS/Access、`/lolice/openclaw/*` SSM parameters、custom image build assets を削除。
    - `terraform/aws/longhorn/`、`terraform/cloudflare/b0xp.io/longhorn/`、`argoproj/longhorn/` は変更なし。
  - 検証:
    - `kubectl kustomize argoproj`
    - `kubectl kustomize argoproj/argocd-image-updater`
    - `kubectl kustomize argoproj/prometheus-operator`
    - `jq . renovate.json`
    - `terraform -chdir=terraform/aws/openclaw fmt -check`
    - `terraform -chdir=terraform/cloudflare/b0xp.io/openclaw fmt -check`
    - `terraform -chdir=terraform/aws/openclaw validate`
    - `terraform -chdir=terraform/cloudflare/b0xp.io/openclaw validate`
