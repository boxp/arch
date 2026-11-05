#!/usr/bin/env bash
# live のメタデータを読み取り、指定の JSON へ出す。get と Prometheus の読取クエリのみ。exec / Secret / ConfigMap / env は扱わない。
# どれか 1 つでも失敗したら何も出さない(権限拒否を資源の削除と読まないため)。
# usage: collect-live.sh OUT.json
set -euo pipefail
out=${1:?usage: collect-live.sh OUT.json}
ds=${PROM_DS_UID:-P1809F7CD0C75ACF3}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
q(){ curl -fsS -m 30 -G -H "Authorization: Bearer $GRAFANA_SERVICE_ACCOUNT_TOKEN" "$GRAFANA_URL/api/datasources/proxy/uid/$ds/api/v1/query" --data-urlencode "query=$1"; }
kj(){ kubectl get --request-timeout=60s "$@" -o json; }
get(){ local name=$1 filter=$2; shift 2; kj "$@" | jq "$filter" > "$tmp/$name.json"; }
prom(){ local name=$1 query=$2; q "$query" | jq '[.data.result[]|{k:(.metric|to_entries[0].value),v:.value[1]}]' > "$tmp/$name.json"; }

get apps '[.items[]|{name:.metadata.name,sync:.status.sync.status,health:.status.health.status}]' applications.argoproj.io -A
get appsets '[.items[]|.metadata.name]' applicationsets.argoproj.io -A
get ns '[.items[].metadata.name]' ns
get wl '[.items[]|{kind:.kind,ns:.metadata.namespace,name:.metadata.name,replicas:(.spec.replicas//null)}]' deploy,sts,ds,cronjob -A
get svc '[.items[]|{ns:.metadata.namespace,name:.metadata.name,type:.spec.type,lb:(.status.loadBalancer.ingress[0].ip//null)}]' svc -A
get nodes '[.items[]|{name:.metadata.name,arch:.status.nodeInfo.architecture,cpu:.status.capacity.cpu,version:.status.nodeInfo.kubeletVersion,cp:(.metadata.labels|has("node-role.kubernetes.io/control-plane")),gpuWorker:(.metadata.labels["lolice.io/gpu-worker"]//null)}]' nodes
get pvc '[.items[]|{ns:.metadata.namespace,name:.metadata.name,sc:.spec.storageClassName,size:.spec.resources.requests.storage}]' pvc -A
get es '[.items[]|{ns:.metadata.namespace,name:.metadata.name,store:.spec.secretStoreRef.name}]' externalsecrets -A
get sm '[.items[]|{kind:.kind,ns:.metadata.namespace,name:.metadata.name}]' servicemonitors,podmonitors,prometheusrules -A
get rj '[.items[]|{name:.metadata.name,task:.spec.task,retain:.spec.retain}]' recurringjobs.longhorn.io -A
get bt '[.items[]|{name:.metadata.name,available:.status.available}]' backuptargets.longhorn.io -A
get vols '[.items[]|{pvc:((.status.kubernetesStatus.namespace//"?")+"/"+(.status.kubernetesStatus.pvcName//"?")),jobs:(.metadata.labels|to_entries|map(select(.key|startswith("recurring-job.longhorn.io/"))|.key|sub("recurring-job\\.longhorn\\.io/";"")))}]' volumes.longhorn.io -n longhorn-system
get place '[.items[]|select(.status.phase=="Running")|{ns:.metadata.namespace,kind:(.metadata.ownerReferences[0].kind//"Pod"),o:(.metadata.ownerReferences[0].name//.metadata.name),node:.spec.nodeName}|select(.kind!="DaemonSet")|.w=(if .kind=="ReplicaSet" then (.o|sub("-[a-z0-9]{6,10}$";"")) else .o end)|{key:(.ns+"/"+.w),node}]|group_by(.key)|map({key:.[0].key,value:(map(.node)|unique)})|from_entries' pods -A
prom up 'count by (job)(up==1)'
prom tun 'count by (namespace)(cloudflared_tunnel_ha_connections>0)'

jq -n --arg at "$(date -u +%FT%TZ)" \
  --slurpfile apps "$tmp/apps.json" --slurpfile appsets "$tmp/appsets.json" --slurpfile ns "$tmp/ns.json" \
  --slurpfile wl "$tmp/wl.json" --slurpfile svc "$tmp/svc.json" --slurpfile nodes "$tmp/nodes.json" \
  --slurpfile pvc "$tmp/pvc.json" --slurpfile es "$tmp/es.json" --slurpfile sm "$tmp/sm.json" \
  --slurpfile rj "$tmp/rj.json" --slurpfile bt "$tmp/bt.json" --slurpfile vols "$tmp/vols.json" \
  --slurpfile place "$tmp/place.json" --slurpfile up "$tmp/up.json" --slurpfile tun "$tmp/tun.json" \
  '{observed_at:$at,applications:$apps[0],applicationsets:$appsets[0],namespaces:$ns[0],workloads:$wl[0],services:$svc[0],nodes:$nodes[0],pvcs:$pvc[0],externalsecrets:$es[0],monitors:$sm[0],recurringjobs:$rj[0],backuptargets:$bt[0],longhorn_volumes:$vols[0],placement:$place[0],prometheus:{up:$up[0],tunnels:$tun[0]}}' > "$out.tmp"
mv "$out.tmp" "$out"
