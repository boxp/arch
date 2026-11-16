#!/usr/bin/env bash
# BOXP-561: workspace の計画停止で session.sh の cleanup が走らなくても、node 側で gate を自動的に開け戻す dead-man。
# close 直後に arm し、正常な restore の後に disarm する。期限が来たら node 上で
#   1) relay を止め、2) rtapi と同じ file queue へ「state が closed:BOXP-561-TOKEN のときだけ open に戻す」条件付き PATCH を置く。
# uid / resourceVersion / 現在値の test を含むので、すでに誰かが gate を変えていれば何もしない（安全側）。
# usage: deadman.sh arm TOKEN SECONDS | disarm | status
set -euo pipefail
NODE=192.168.10.107
Q=/var/lib/local-llm/models/boxp340-qwen-image-21/work/runtime-api
op=${1:-}
case $op in
arm)
  tok=${2:?TOKEN}; sec=${3:?SECONDS}
  [[ $tok =~ ^[A-Za-z0-9-]+$ && $sec =~ ^[0-9]+$ ]] || { echo "bad args" >&2; exit 2; }
  obj=$(kubectl get cm -n local-llm llama-server-admission -o json)
  cur=$(jq -r .data.state <<<"$obj")
  # DEADMAN_SELFTEST=1: 現在の gate に対し必ず失敗する rv で発火させ、queue の経路だけを確かめる（gate は変わらない）
  [[ ${DEADMAN_SELFTEST:-0} == 1 || $cur == "closed:BOXP-561-$tok" ]] || { echo "gate is $cur, not closed:BOXP-561-$tok" >&2; exit 1; }
  uid=$(jq -r .metadata.uid <<<"$obj"); rv=$(jq -r .metadata.resourceVersion <<<"$obj")
  [[ ${DEADMAN_SELFTEST:-0} == 1 ]] && rv=0
  body=$(jq -cn --arg uid "$uid" --arg rv "$rv" --arg cur "$cur" --arg new "open:BOXP-561-$tok-deadman" \
    '[{op:"test",path:"/metadata/uid",value:$uid},{op:"test",path:"/metadata/resourceVersion",value:$rv},{op:"test",path:"/data/state",value:$cur},{op:"replace",path:"/data/state",value:$new}]')
  ssh -o BatchMode=yes $NODE "pkill -f '^bash /tmp/boxp561-deadman.sh' || true"
  # node 側 script: 期限まで sleep し、relay を止めてから期限 60 秒の要求を queue へ置く
  ssh -o BatchMode=yes $NODE "cat > /tmp/boxp561-deadman.sh" <<NODE
sleep $sec
sudo -n pkill -f '^python3 -I /tmp/boxp561-relay.py ' || true
id=\$(python3 -c 'import uuid;print(uuid.uuid4().hex)'); exp=\$(python3 -c 'import time;print(time.time()+60)')
req=\$(jq -cn --arg p /api/v1/namespaces/local-llm/configmaps/llama-server-admission --argjson b '$body' --argjson e "\$exp" '{method:"PATCH",path:\$p,body:\$b,expires:\$e}')
cd $Q; printf '%s' "\$req" > .\$id.tmp; sync .\$id.tmp; ln .\$id.tmp requests/\$id.json; rm .\$id.tmp
for i in \$(seq 60); do [ -f responses/\$id.json ] && break; sleep 1; done
echo "\$(date -u +%FT%TZ) fired id=\$id resp=\$(jq -c "{status,state:.object.data.state}" responses/\$id.json 2>/dev/null)" >> /tmp/boxp561-deadman.log
NODE
  ssh -o BatchMode=yes $NODE "setsid nohup bash /tmp/boxp561-deadman.sh >> /tmp/boxp561-deadman.log 2>&1 < /dev/null & echo \"\$(date -u +%FT%TZ) armed tok=$tok sec=$sec pid=\$!\" >> /tmp/boxp561-deadman.log; tail -1 /tmp/boxp561-deadman.log";;
disarm)
  ssh -o BatchMode=yes $NODE "pkill -f '^bash /tmp/boxp561-deadman.sh' && echo \"\$(date -u +%FT%TZ) disarmed\" >> /tmp/boxp561-deadman.log; tail -1 /tmp/boxp561-deadman.log";;
status)
  ssh -o BatchMode=yes $NODE "pgrep -af '^bash /tmp/boxp561-deadman.sh' || echo 'not armed'; tail -3 /tmp/boxp561-deadman.log 2>/dev/null || true";;
*) echo "usage: deadman.sh arm TOKEN SECONDS | disarm | status" >&2; exit 2;;
esac
