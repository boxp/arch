# BOXP-17: Even G2 WARP private hostname

## Goal

`boxp/even-g2-lab` の main branch app を、Cloudflare WARP 接続中の端末からだけ到達できる hostname として公開する。

## Design

- ECR repository: `even-g2-client-main`
- GitHub Actions role: `even-g2-lab-main-gha-role`
- Private hostname: `even-g2-main.even-g2-lab.svc.cluster.local`
- Cloudflare route: `cloudflare_zero_trust_network_hostname_route`
- Cloudflare Tunnel: existing k8s tunnel with `warp_routing.enabled = true`
- Origin resolution: k8s `cloudflared` resolves the private hostname through Kubernetes DNS to the ClusterIP service.

## Tasks

- [x] Add ECR repository and lifecycle policy.
- [x] Add GitHub Actions OIDC role scoped to `boxp/even-g2-lab` main.
- [x] Add Cloudflare Zero Trust private hostname route.
- [ ] Run terraform fmt.
- [ ] Run targeted terraform init/validate where practical.
- [ ] After apply, confirm WARP resolves `even-g2-main.even-g2-lab.svc.cluster.local` to a Gateway initial resolved IP.
- [ ] Confirm `http://even-g2-main.even-g2-lab.svc.cluster.local/` reaches the app through the k8s `cloudflared` connector.

## Verification Note

This workspace does not have `terraform`, `tofu`, `kubectl`, or `kustomize` installed. Terraform formatting/validation should run in the arch PR CI.
