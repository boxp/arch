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

## 追加変更：URL を hostname に戻す（Gateway DNS override）

Owner の要望：IP を URL に直接書きたくない。k8s Service の FQDN を使えないか。

### k8s Service の FQDN（`even-g2-main.even-g2-lab.svc.cluster.local`）を端末で使う案は採らない

- default profile の Local Domain Fallback（Cloudflare 既定の 14 件）に `local` があり、`*.cluster.local` の問い合わせは Gateway に届かず端末のローカル DNS に回る。これを外すと共有 profile の全端末に影響する。Android は `.local` を mDNS で引く挙動もある。
- Gateway に届いても、`cluster.local` を cluster の CoreDNS に転送するには resolver policy（private resolver を tunnel 経由で使う機能）が必要で、Enterprise plan 限定。
- private hostname route に FQDN を登録する案は、Gateway の TCP/UDP proxy（account 全体の設定、IaC 外）と初期解決 IP の範囲の Include が前提で、上の LDF の問題も残る。
- cloudflared → origin は今も Service の FQDN（ingress の `http://even-g2-main.even-g2-lab.svc.cluster.local:80`）を使っている。

### 採る案

- `terraform/cloudflare/b0xp.io/even-g2-lab/dns_policy.tf`: Gateway DNS policy（action `override`）を 1 件追加。`dns.fqdn == "even-g2-main.b0xp.io"` だけに一致し、`10.104.181.159`（固定した ClusterIP）を返す。公開 DNS record は作らない。WARP 端末の DNS は Gateway に届くことを Owner の DNS ログで確認済み。
- 機能していなかった `cloudflare_zero_trust_network_hostname_route.even_g2_main` を削除する（override と同じ名前を二重に扱わないため）。ingress rule の hostname は同じ文字列のまま。
- CIDR route と Include の /32 はそのまま。IP は lolice の `spec.clusterIP` で固定してあるので、Service を作り直しても変わらない。IP は IaC の locals 1 か所にまとめた。
- URL は `http://even-g2-main.b0xp.io/kohako/`（TLS なし。端末から Cloudflare までは WARP、Cloudflare から cluster までは Tunnel で暗号化される）。

### 確認

- plan が policy 1 件の追加、hostname route 1 件の削除、tunnel config の in-place 更新（または差分なし）だけであること。
- apply 後、WARP 端末から `http://even-g2-main.b0xp.io/kohako/` が Kohako（build 1440397）を返すこと。開けなければ `http://10.104.181.159/kohako/` で、DNS の問題か経路の問題かを切り分ける。

### Rollback

この PR を revert して apply する（policy が消え、hostname route が戻る）。IP の URL はそのまま使える。
