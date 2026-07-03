# BOXP-37 codex-workspace kubectl image

## 目的

Codex workspace image に `kubectl` / `kustomize` を含め、lolice 側の Pod manifest では CLI binary を init container で差し込まない構成にする。

## 実装

- `docker/codex-workspace/Dockerfile` に `KUBECTL_VERSION=1.36.1` と `KUSTOMIZE_VERSION=5.8.1` を追加する。
- `kubectl` は `dl.k8s.io` の公式 linux/amd64 binary を `/usr/local/bin/kubectl` に install する。
- `kustomize` は `kubernetes-sigs/kustomize` の release archive から `/usr/local/bin/kustomize` に install する。
- `docker/codex-workspace/entrypoint.sh` で `KUBECONFIG` を SSH / Even Terminal セッションへ引き継ぐ。

## 検証

実行済み:

```bash
bash -n docker/codex-workspace/entrypoint.sh
docker build -t codex-workspace:boxp-37 docker/codex-workspace
docker run --rm --entrypoint /bin/bash codex-workspace:boxp-37 -lc 'kubectl version --client=true --output=yaml && kustomize version'
docker run --rm -e KUBECONFIG=/var/run/secrets/codex-workspace/kubeconfig/config codex-workspace:boxp-37 /bin/bash -lc 'grep KUBECONFIG /run/codex-workspace/session-env'
```

結果:

- `bash -n docker/codex-workspace/entrypoint.sh` は成功。
- `DOCKER_BUILDKIT=0 docker build -t codex-workspace:boxp-37 docker/codex-workspace` は成功。
- BuildKit ありの `docker build` は、この worker の Docker buildx component が壊れていたため開始前に失敗した。
- `kubectl version --client=true --output=yaml` は `v1.36.1` / bundled `kustomizeVersion: v5.8.1` を返した。
- `kustomize version` は `v5.8.1` を返した。
- `kubectl kustomize --help` は成功した。
- entrypoint 起動後の `/run/codex-workspace/session-env` に `export KUBECONFIG=/var/run/secrets/codex-workspace/kubeconfig/config` が書き出されることを確認した。

## 制限事項

- cluster 接続用の ServiceAccount / RBAC / projected token / kubeconfig mount は `boxp/lolice` 側の BOXP-37 manifest で管理する。
- 実 cluster への `kubectl auth can-i` は image build だけでは検証できないため、lolice 側 Pod rollout 後に確認する。
