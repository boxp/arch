# BOXP-318: even-g2-main を WARP の private IP route で届ける

## 問題

`even-g2-main.b0xp.io`（`cloudflare_zero_trust_network_hostname_route`）は WARP 端末から名前解決できず、BOXP-17 以来一度も到達確認されていない。

## 原因の整理

- Cloudflare docs（Connect to private hostnames）では、private hostname route の通信は Gateway の初期解決 IP 経由で tunnel に入り、cloudflared が **自分のホストの resolver で hostname を引き直して同じ port に L4 で接続**する。tunnel の ingress rule（`http://even-g2-main.even-g2-lab.svc.cluster.local:80`）は使われない。
- cluster 内では `even-g2-main.b0xp.io` は解決できず、origin は 443/TLS を持たない。Gateway proxy や split tunnel の Include を直しても、この構成のままでは届かない。
- 一方、WARP → tunnel → private IP（CIDR route）は codex-workspace（`192.168.10.98/32`）で到達実績がある。

## 変更

- `terraform/cloudflare/b0xp.io/even-g2-lab/tunnel.tf`: even-g2-lab tunnel に `10.104.181.159/32`（even-g2-main Service の ClusterIP）の CIDR route を追加。
- `terraform/cloudflare/b0xp.io/k8s/split_tunnel.tf`: default profile の Include に `10.104.181.159/32` を 1 件追加。
- boxp/lolice 側で Service の `clusterIP` を同じ値に固定する（現在値と同じなので no-op）。
- hostname route、Gateway の全体設定、DNS record、Access は変更しない。新しい公開経路は作らない。

## 確認

- tfaction plan で追加が route 1 件と Include 1 件だけであること。
- apply 後、WARP 端末から `http://10.104.181.159/kohako/` が Kohako の build を返すこと、`/` が Hitohako のままであること。

## Rollback

この PR を revert して apply する（route と Include の 1 件が消える）。
