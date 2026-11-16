# BOXP-330: lolice member の WARP 到達範囲をゲームサーバーに限定する

## 目的

lolice member（ゲームサーバー参加者）が WARP 経由で到達できる宛先を、公開済みのゲームサーバーの socket だけにする。
Owner/admin と workload（service token 端末）の到達範囲は変えない。

## 変更前の live 状態（#14171 の一時 data source で読み取り、email は伏せ字）

| 項目 | 状態 |
|---|---|
| device profile | default 1 件だけ（custom profile は無し）。Include mode で 192.168.10.* の /32 を 17 件、10.104.181.159/32、kohako-g2.b0xp.io、boxp.cloudflareaccess.com を Include。全トラフィックを WARP に流す設定ではない |
| Gateway proxy | TCP/UDP とも有効（network policy が効く） |
| tunnel route | boxp-home: 192.168.10.0/24、k8s tunnel: 192.168.10.98/32・10.111.250.7/32、even-g2-lab tunnel: 10.104.181.159/32（すべて default vnet） |
| Gateway policy | DNS override 1 件だけ。network policy は無し（暗黙で全許可） |
| WARP enrollment | Access policy「mail addresses」(email 10 件、Owner を含む)と codex-workspace の service token policy |

そのため設定上は member も Include 済みの管理 host（Grafana .88、llama .95、Dashboard .96、codex-workspace .98、k8s API VIP .99、node .100-.108）へ到達できた。実測はしていない。

## ゲームの data plane（稼働 Service と公開済み参加手順で照合）

| ゲーム | socket | 根拠 |
|---|---|---|
| PalWorld 1 | 192.168.10.97:8211/UDP | Service が稼働中、ガイドに掲載 |
| PalWorld 2 | 192.168.10.108:8211/UDP | Service が稼働中、ガイドに掲載 |
| ARK: SA | 192.168.10.29:7777/UDP | Service が稼働中、ガイドに掲載 |
| Minecraft | 192.168.10.30:25565/TCP | ガイドに掲載。現在は replicas 0 |

対象外にしたもの: RCON（ARK 27020/TCP、Minecraft 25575/TCP）、ガイドに載っていない ARK 7778・27015/UDP、StarRupture（.31。未配備で、ガイドにも無い）。

## 変更（段階 1: 認可）

- Gateway EMAIL list `lolice-members` を作る。初期値は enrollment policy の email から Owner を除いたもの（items は sensitive）。作成後は `ignore_changes = [items]` とし、Worker を唯一の writer にする。enrollment policy の member が list から漏れていたら、check block が件数だけを出して警告する。
- Gateway network policy（どちらも `identity.email in $lolice-members`）:
  1. precedence 2000: ゲーム socket 宛てを allow
  2. precedence 2010: 10/8・172.16/12・192.168/16・100.64/10・fc00::/7・fe80::/10 宛てを block（deny-by-default）
- lolice-member-portal Worker: 承認時に、Access policy より先に Gateway list へ追加する。list 更新に失敗したら 502 を返し、enrollment は行わない（fail closed）。Owner（ADMIN_EMAIL）は追加しない。

Owner 兼 member の場合: Owner の email は list に入らないので、Owner の扱いが優先される。service token 端末には user email が無いので、list に一致しない。

## 段階 2（本 PR の続き。別 PR）: member 用 device profile

`identity.email in $lolice-members` に一致する custom profile を作り、Include をゲーム /32 と team domain（boxp.cloudflareaccess.com。BOXP-328 の再認証ループ対策）だけにする。目的は、一般のインターネット通信と非ゲーム宛ての通信を WARP に載せないこと（routing の話であり、認可は段階 1 の Gateway で担保する）。

## 試験表

| # | 主体 | 宛先 | 期待 | 確認方法 |
|---|---|---|---|---|
| 1 | member | 4 つのゲーム socket | 到達可 | 参加者端末での実測が必要（未確認） |
| 2 | member | .88:80 / .96:443 / .98:22 / .99:6443 | Gateway block | 参加者端末での実測、または Gateway log（未確認） |
| 3 | member | 一般 Internet | WARP 外へ直接出る | 段階 2 の後に実測（未確認） |
| 4 | member | WARP 再認証（team domain） | 成功 | 段階 2 でも team domain を Include に残す。実測は未確認 |
| 5 | Owner | 既存の全宛先 | 変化なし | list に含まれないことを設計と check で確認。端末実測は未確認 |
| 6 | codex-workspace | 既存の route | 変化なし | user email が無いので list に一致しない |
| 7 | IPv6 | fc00::/7・fe80::/10 | member は block | ゲームは IPv4 だけ |

## Rollback

1. 通常: 2 つの Gateway policy を `enabled = false` にする PR、または本 PR の revert（list は残してよい）。
2. 緊急: Zero Trust dashboard で 2 つの policy を disable し、24 時間以内に Terraform 側を追従させる。
3. 権限を広げる方向の rollback（list の削除や member の一括除外）は、原因を特定してから行う。

## 適用記録

- 段階 1: boxp/arch#14171 を merge（9efe6e4）。apply run 40460861082 が成功（k8s 3 add/1 change、portal Worker を更新）。post-apply の check 警告は無し（enrollment policy の member は全員 list に入っている）。
- 段階 2: member 用 custom profile（precedence 100、match `identity.email in $lolice-members`、Include はゲーム /32 ×4 と team domain）。client 挙動の設定は default profile から引き継ぐ。Rollback は `enabled = false` にするか revert する（member は default profile に戻るが、認可は Gateway で維持される）。
- 段階 2 の apply（run 40462555897）は失敗した。device profile の match 式では Gateway list を参照できない（API error 2073 "list uuids not supported"）。custom profile は作成されず、default profile は computed な policy_id の更新だけだった。
- 段階 2 修正: match を enrollment policy 由来のインライン email 集合（`identity.email in {...}`）に変え、`sensitive()` で plan から隠す。member が 0 人なら profile を作らない。Worker が apply 後に承認した member は、次の apply または drift 実行までは default profile のままになる（認可は Gateway list で効く）。
