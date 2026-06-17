# BOXP-17: Even G2 WARP private hostname

## Goal

`boxp/even-g2-lab` の main branch app を、Cloudflare WARP 接続中の端末からだけ到達できる hostname として公開する。

## Design

- ECR repository: `even-g2-client-main`
- GitHub Actions role: `even-g2-lab-main-gha-role`
- Private hostname: `even-g2-main.b0xp.io`
- Cloudflare target: `terraform/cloudflare/b0xp.io/even-g2-lab`
- Cloudflare route: `cloudflare_zero_trust_network_hostname_route`
- Cloudflare Tunnel: dedicated `even-g2-lab` cloudflared tunnel
- Tunnel ingress: same hostname forwards to `http://even-g2-main.even-g2-lab.svc.cluster.local:80`
- Tunnel token: stored in SSM Parameter Store as `even-g2-lab-tunnel-token`

## Tasks

- [x] Add ECR repository and lifecycle policy.
- [x] Add GitHub Actions OIDC role scoped to `boxp/even-g2-lab` main.
- [x] Add a separate Cloudflare working directory for Even G2.
- [x] Add Cloudflare Zero Trust private hostname route in the Even G2 target.
- [x] Add a dedicated Cloudflare Tunnel and SSM token parameter.
- [x] Add tunnel ingress rule for the private hostname to the Kubernetes service DNS name.
- [ ] Run terraform fmt.
- [ ] Run targeted terraform init/validate where practical.
- [ ] After apply, confirm WARP resolves `even-g2-main.b0xp.io` to a Gateway initial resolved IP.
- [ ] Confirm `https://even-g2-main.b0xp.io/` reaches the app through the `even-g2-lab` `cloudflared` connector.

## Verification Note

This workspace does not have `terraform`, `tofu`, `kubectl`, or `kustomize` installed. Terraform formatting/validation should run in the arch PR CI.
