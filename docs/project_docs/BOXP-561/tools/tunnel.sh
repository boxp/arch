#!/usr/bin/env bash
# BOXP-561 直接経路: local 127.0.0.1:PORT -> ssh -L -> node 127.0.0.1:PORT -> relay.py(pod netns) -> 127.0.0.1:8081
# usage: tunnel.sh up|down|check PORT   (状態は $BOXP561_TMP/tunnel-PORT/)
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P); source "$here/common.sh"; require_tmp
NODE=192.168.10.107; op=${1:-}; port=${2:-}
[[ $op =~ ^(up|down|check)$ && $port =~ ^[0-9]{4,5}$ ]] || { echo "usage: tunnel.sh up|down|check PORT" >&2; exit 2; }
d=$BOXP561_TMP/tunnel-$port
case $op in
up)
  [[ ! -e $d ]] || { echo "tunnel state exists: $d" >&2; exit 1; }; mkdir -p "$d"
  cid=$(ssh -o BatchMode=yes $NODE "sudo -n crictl ps --name '^llama-server$' -q | head -1")
  pid=$(ssh -o BatchMode=yes $NODE "sudo -n crictl inspect $cid | jq -r .info.pid")
  [[ $pid =~ ^[0-9]+$ ]] || { echo "pod pid not found" >&2; exit 1; }
  ssh -o BatchMode=yes $NODE "cat > /tmp/boxp561-relay.py" < "$here/relay.py"
  ssh -o BatchMode=yes $NODE "sudo -n setsid nohup python3 -I /tmp/boxp561-relay.py $port $pid > /tmp/boxp561-relay-$port.log 2>&1 & echo \$! " > "$d/relay.pid"
  sleep 2
  ssh -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -N -L "127.0.0.1:$port:127.0.0.1:$port" $NODE & echo $! > "$d/ssh.pid"
  sleep 3; "$0" check "$port";;
down)
  [[ -f $d/ssh.pid ]] && kill "$(cat "$d/ssh.pid")" 2>/dev/null || true
  ssh -o BatchMode=yes $NODE "sudo -n pkill -f '^python3 -I /tmp/boxp561-relay.py $port ' || true; sudo -n rm -f /tmp/boxp561-relay.py" || true
  rm -rf "$d"; echo "tunnel $port down";;
check)
  h=$(curl -s -o /dev/null -m 10 -w '%{http_code}' "http://127.0.0.1:$port/health" || true)
  n=$(curl -s -m 10 "http://127.0.0.1:$port/v1/models" | jq '.data|length' 2>/dev/null || echo 0)
  echo "$(date -u +%FT%TZ) tunnel $port health=$h models=$n"; [[ $h == 200 ]];;
esac
