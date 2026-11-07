#!/bin/bash
# usage: run.sh <model> <scenario> <dev>  → /tmp/b441v/out/<model>-<scenario>-<dev>
set -euo pipefail
m=$1; s=$2; dv=${3:-pc}; name="$m-$s-$dv"
script_dir=$(cd "$(dirname "$0")" && pwd)
mkdir -p /tmp/b441v
# 認証トークンは失敗時も含め必ず削除する
cleanup() {
  rm -f /tmp/b441v/.tok
  docker exec b441pw rm -f /work/.tok >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker cp "$script_dir/rec.mjs" b441pw:/work/rec.mjs
if [ "$s" = studio ]; then
  ( umask 077; ssh -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -p 2222 boxp@127.0.0.1 'cat /var/run/secrets/kohako-bff-verifier/token' > /tmp/b441v/.tok )
  docker cp /tmp/b441v/.tok b441pw:/work/.tok; rm -f /tmp/b441v/.tok
fi
docker exec -w /work -e TOKEN_FILE=/work/.tok -e H="${H:-http://kohako-studio.kohako-studio.svc.cluster.local}" -e OVERRIDE_P2LRT="${OVERRIDE_P2LRT:-}" -e DSF="${DSF:-1}" b441pw sh -c "rm -rf out/$name; node rec.mjs $m $s out/$name $dv"
cleanup
rm -rf "/tmp/b441v/out/$name"; mkdir -p /tmp/b441v/out; docker cp "b441pw:/work/out/$name" "/tmp/b441v/out/$name"
