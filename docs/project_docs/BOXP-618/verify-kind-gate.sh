#!/usr/bin/env bash
# BOXP-618: kube-controller-manager の NodeControllerLeaseCircuitBreaker を
# 無効化したときの node lifecycle controller の挙動を kind で隔離検証する。
#
# 本番クラスタには一切触れない (kind は docker 上の使い捨てクラスタ)。
#
# 使い方:
#   KIND=/path/to/kind OUT=/path/to/output ./verify-kind-gate.sh off   # gate=false
#   KIND=/path/to/kind OUT=/path/to/output ./verify-kind-gate.sh on    # 既定 (gate=true) の対照
#
# 確認すること:
#   1. kube-controller-manager の起動引数と kubernetes_feature_enabled メトリクス
#   2. 全ノードの kubelet を止めて zone を full disruption にし、復帰させたときに
#      kube-controller-manager が panic / 再起動しないこと
#   3. disruption 中に worker の Node object を消して再登録させても panic しないこと
#      (#141572 の「nodeHealthMap に entry が無い node」の状況に近づける)
set -euo pipefail

MODE="${1:?usage: $0 off|on}"
KIND="${KIND:-kind}"
OUT="${OUT:-./out}"
IMAGE="${IMAGE:-kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5}"
NAME="boxp618-gate-${MODE}"
KCTX="kind-${NAME}"
mkdir -p "${OUT}"
# 本番 kubeconfig と混ざらないよう、使い捨て kubeconfig だけを見る
KUBECONFIG="$(mktemp)"
export KUBECONFIG
LOG="${OUT}/${NAME}.log"
exec > >(tee "${LOG}") 2>&1

k() { kubectl --context "${KCTX}" "$@"; }
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

case "${MODE}" in
  off) GATE_PATCH='
kubeadmConfigPatches:
- |
  kind: ClusterConfiguration
  controllerManager:
    extraArgs:
    - name: feature-gates
      value: NodeControllerLeaseCircuitBreaker=false' ;;
  on) GATE_PATCH='' ;;
  *)
    echo "mode must be off|on" >&2
    exit 2
    ;;
esac

cat >"${OUT}/${NAME}-config.yaml" <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
- role: worker
- role: worker
${GATE_PATCH}
EOF

cleanup() { "${KIND}" delete cluster --name "${NAME}" >/dev/null 2>&1 || true; }
finish() {
  cleanup
  rm -f "${KUBECONFIG}"
}
trap finish EXIT
cleanup

echo "[$(ts)] create cluster ${NAME} image=${IMAGE}"
"${KIND}" create cluster --name "${NAME}" --image "${IMAGE}" --config "${OUT}/${NAME}-config.yaml" --wait 180s

CP="${NAME}-control-plane"
WORKERS=$(docker ps --format '{{.Names}}' | grep "^${NAME}-worker" | sort)
ALL="${CP} ${WORKERS}"

echo "[$(ts)] server version"
k version | tail -1
echo "[$(ts)] kube-controller-manager args"
docker exec "${CP}" grep -E -- '--feature-gates|image:' /etc/kubernetes/manifests/kube-controller-manager.yaml || echo "(feature-gates flag なし)"

# kubernetes_feature_enabled を KCM の /metrics から読む (RBAC 付きの SA token を使う)
k create sa metrics-reader -n kube-system >/dev/null
k create clusterrole metrics-reader --verb=get --non-resource-url=/metrics >/dev/null
k create clusterrolebinding metrics-reader --clusterrole=metrics-reader --serviceaccount=kube-system:metrics-reader >/dev/null
TOKEN=$(k create token metrics-reader -n kube-system)
echo "[$(ts)] feature metric"
docker exec "${CP}" curl -sk -H "Authorization: Bearer ${TOKEN}" https://127.0.0.1:10257/metrics |
  grep -E 'kubernetes_feature_enabled\{name="(NodeControllerLeaseCircuitBreaker|AtomicFIFO)"' || echo "metric 取得失敗"

kcm_restarts() { k -n kube-system get pod "kube-controller-manager-${CP}" -o jsonpath='{.status.containerStatuses[0].restartCount}'; }
echo "[$(ts)] KCM restartCount(before)=$(kcm_restarts)"

wait_nodes() { # $1 = Ready status to wait for (True|Unknown), $2 = timeout seconds
  local want="$1" deadline=$(($(date +%s) + $2))
  while :; do
    local st
    st=$(k get nodes -o jsonpath='{range .items[*]}{.status.conditions[?(@.type=="Ready")].status}{" "}{end}' 2>/dev/null || true)
    if [ -n "${st}" ] && ! echo "${st}" | tr ' ' '\n' | grep -v '^$' | grep -qv "^${want}$"; then
      echo "[$(ts)] all nodes Ready=${want}: ${st}"
      return 0
    fi
    [ "$(date +%s)" -gt "${deadline}" ] && {
      echo "[$(ts)] timeout waiting Ready=${want}: ${st}"
      return 1
    }
    sleep 5
  done
}

for round in 1 2; do
  echo "[$(ts)] round ${round}: stop kubelet on all nodes (static pods keep running)"
  for n in ${ALL}; do docker exec "${n}" systemctl stop kubelet; done
  wait_nodes Unknown 240 || true
  sleep 20
  if [ "${round}" = 2 ]; then
    W1=$(echo "${WORKERS}" | head -1)
    echo "[$(ts)] round 2: delete Node object ${W1} during full disruption (re-registers on kubelet start)"
    k delete node "${W1}" --wait=false || true
  fi
  echo "[$(ts)] round ${round}: start kubelet on all nodes"
  for n in ${ALL}; do docker exec "${n}" systemctl start kubelet; done
  wait_nodes True 300 || true
  sleep 30
  echo "[$(ts)] KCM restartCount(after round ${round})=$(kcm_restarts)"
done

echo "[$(ts)] disruption / panic related KCM log lines"
# 再起動していれば previous も含めて見る
k -n kube-system logs "kube-controller-manager-${CP}" --previous 2>/dev/null | grep -E 'disruption|panic|nil pointer' || true
k -n kube-system logs "kube-controller-manager-${CP}" | grep -E 'disruption|panic|nil pointer|Unhandled Error|short circuit|ConsistencyError' | tail -40 || true
echo "[$(ts)] nodes"
k get nodes -o wide
echo "[$(ts)] RESULT mode=${MODE} kcm_restarts=$(kcm_restarts) panic_lines=$(k -n kube-system logs "kube-controller-manager-${CP}" | grep -c -E 'panic|nil pointer' || true)"
