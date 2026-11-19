#!/usr/bin/env bash
# BOXP-618: kubeadm --patches で kube-controller-manager に
# --feature-gates=NodeControllerLeaseCircuitBreaker=false を付ける経路を、
# kind (v1.36.4, control-plane 2 台) から kubeadm upgrade で 1.37.0 に上げて隔離検証する。
#
# 本番クラスタには一切触れない (kind は docker 上の使い捨てクラスタ)。
#
# 使い方:
#   KIND=/path/to/kind OUT=/path/to/output ./verify-kind-kubeadm-patches.sh
#
# 確認すること:
#   1. 1 台目だけ `kubeadm upgrade apply --patches` した混在状態で、
#      1.37 KCM には gate=false が付き、1.36 KCM には付かず、両方とも落ちないこと
#   2. 2 台目を `kubeadm upgrade node --patches` で上げると gate=false が付くこと
#   3. kubeadm-config (ClusterConfiguration) には gate が残らないこと、
#      そのため --patches なしで manifest を再生成すると gate が外れること (持続性の穴)
#
# kind node は kernel config を持たず kubeadm の SystemVerification が落ちるので、
# upgrade では preflight error を無視する (kind 固有。本番の role では使わない)。
#
# kind node から registry.k8s.io (の転送先) へ届かない環境でも動くよう、1.37 の
# control plane image は使い捨ての kind v1.37.0 cluster の containerd から export し、
# 1.36 の node へ import してから upgrade する。
set -euo pipefail

KIND="${KIND:-kind}"
OUT="${OUT:-./out}"
OLD_IMAGE="${OLD_IMAGE:-kindest/node:v1.36.4@sha256:099e049362a1526b2db71494e1947aae99bd16290d7c895f2b7ea312e3cbfaed}"
NEW_IMAGE="${NEW_IMAGE:-kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5}"
NEW_VERSION="${NEW_VERSION:-v1.37.0}"
NAME="boxp618-kubeadm"
KCTX="kind-${NAME}"
PATCH_DIR=/etc/kubernetes/boxp618-patches
mkdir -p "${OUT}"
KUBECONFIG="$(mktemp)"
export KUBECONFIG
LOG="${OUT}/${NAME}.log"
exec > >(tee "${LOG}") 2>&1

k() { kubectl --context "${KCTX}" "$@"; }
ts() { date -u +%Y-%m-%dT%H:%M:%SZ; }

cat >"${OUT}/${NAME}-config.yaml" <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
- role: control-plane
EOF

TMPBIN="$(mktemp -d)"
IMGSRC="${NAME}-img"
cleanup() {
  "${KIND}" delete cluster --name "${NAME}" >/dev/null 2>&1 || true
  "${KIND}" delete cluster --name "${IMGSRC}" >/dev/null 2>&1 || true
}
finish() {
  cleanup
  rm -rf "${KUBECONFIG}" "${TMPBIN}"
  docker rm -f "${NAME}-extract" >/dev/null 2>&1 || true
}
trap finish EXIT
cleanup

echo "[$(ts)] extract kubeadm ${NEW_VERSION} from ${NEW_IMAGE}"
docker pull -q "${NEW_IMAGE}" >/dev/null
docker create --name "${NAME}-extract" "${NEW_IMAGE}" >/dev/null
docker cp "${NAME}-extract:/usr/bin/kubeadm" "${TMPBIN}/kubeadm"
docker rm -f "${NAME}-extract" >/dev/null

echo "[$(ts)] export ${NEW_VERSION} images from a throwaway ${IMGSRC} cluster"
"${KIND}" create cluster --name "${IMGSRC}" --image "${NEW_IMAGE}" --wait 120s
docker exec "${IMGSRC}-control-plane" sh -c \
  'ctr -n k8s.io images ls -q | grep -E "^registry.k8s.io/" | grep -v "@sha256" | xargs ctr -n k8s.io images export /new-images.tar'
docker cp "${IMGSRC}-control-plane:/new-images.tar" "${TMPBIN}/new-images.tar"
"${KIND}" delete cluster --name "${IMGSRC}"

echo "[$(ts)] create cluster ${NAME} image=${OLD_IMAGE}"
"${KIND}" create cluster --name "${NAME}" --image "${OLD_IMAGE}" --config "${OUT}/${NAME}-config.yaml" --wait 180s
CP1="${NAME}-control-plane"
CP2="${NAME}-control-plane2"

for n in "${CP1}" "${CP2}"; do
  docker cp "${TMPBIN}/kubeadm" "${n}:/usr/local/bin/kubeadm-new"
  docker cp "${TMPBIN}/new-images.tar" "${n}:/new-images.tar"
  docker exec "${n}" ctr -n k8s.io images import /new-images.tar >/dev/null
  docker exec "${n}" mkdir -p "${PATCH_DIR}"
  # 既存 command 配列の末尾へ 1 要素足すだけの JSON patch。
  # strategic merge で command を書くと配列全体が置き換わるので使わない。
  docker exec -i "${n}" tee "${PATCH_DIR}/kube-controller-manager+json.json" >/dev/null <<'EOF'
[{"op": "add", "path": "/spec/containers/0/command/-", "value": "--feature-gates=NodeControllerLeaseCircuitBreaker=false"}]
EOF
done

show() { # $1 = node
  local n="$1"
  echo "--- ${n}"
  docker exec "${n}" grep -E -- '--feature-gates|image:' /etc/kubernetes/manifests/kube-controller-manager.yaml || true
}
kcm_state() {
  for n in "${CP1}" "${CP2}"; do
    k -n kube-system get pod "kube-controller-manager-${n}" \
      -o jsonpath='{.metadata.name}{" image="}{.spec.containers[0].image}{" ready="}{.status.containerStatuses[0].ready}{" restarts="}{.status.containerStatuses[0].restartCount}{"\n"}'
  done
}
wait_kcm() { # $1 = node, $2 = expected image tag
  local n="$1" want="$2" deadline=$(($(date +%s) + 300))
  while :; do
    local img ready
    img=$(k -n kube-system get pod "kube-controller-manager-${n}" -o jsonpath='{.spec.containers[0].image}' 2>/dev/null || true)
    ready=$(k -n kube-system get pod "kube-controller-manager-${n}" -o jsonpath='{.status.containerStatuses[0].ready}' 2>/dev/null || true)
    if [[ "${img}" == *":${want}" && "${ready}" == "true" ]]; then
      echo "[$(ts)] ${n} KCM ${img} ready"
      return 0
    fi
    [ "$(date +%s)" -gt "${deadline}" ] && {
      echo "[$(ts)] timeout waiting ${n} KCM ${want}: img=${img} ready=${ready}"
      return 1
    }
    sleep 5
  done
}

echo "[$(ts)] before upgrade"
show "${CP1}"
show "${CP2}"
kcm_state

echo "[$(ts)] CP1: kubeadm upgrade apply ${NEW_VERSION} --patches"
docker exec "${CP1}" /usr/local/bin/kubeadm-new upgrade apply "${NEW_VERSION}" --yes \
  --etcd-upgrade=false --patches "${PATCH_DIR}" --ignore-preflight-errors=all 2>&1 | tail -25
wait_kcm "${CP1}" "${NEW_VERSION}" || true
sleep 60
echo "[$(ts)] mixed state (CP1=1.37 + patch, CP2=1.36 untouched)"
show "${CP1}"
show "${CP2}"
kcm_state

echo "[$(ts)] CP2: kubeadm upgrade node --patches"
docker exec "${CP2}" /usr/local/bin/kubeadm-new upgrade node \
  --etcd-upgrade=false --patches "${PATCH_DIR}" --ignore-preflight-errors=all 2>&1 | tail -15
wait_kcm "${CP2}" "${NEW_VERSION}" || true
sleep 60
echo "[$(ts)] both upgraded"
show "${CP1}"
show "${CP2}"
kcm_state

echo "[$(ts)] kubeadm-config ClusterConfiguration controllerManager"
k -n kube-system get cm kubeadm-config -o jsonpath='{.data.ClusterConfiguration}' | sed -n '/controllerManager/,/^[a-z]/p'

echo "[$(ts)] persistence gap: CP2 kubeadm upgrade node WITHOUT --patches"
docker exec "${CP2}" /usr/local/bin/kubeadm-new upgrade node --etcd-upgrade=false --ignore-preflight-errors=all 2>&1 | tail -5
sleep 30
show "${CP2}"

echo "[$(ts)] feature metric on CP1 KCM"
k create sa metrics-reader -n kube-system >/dev/null
k create clusterrole metrics-reader --verb=get --non-resource-url=/metrics >/dev/null
k create clusterrolebinding metrics-reader --clusterrole=metrics-reader --serviceaccount=kube-system:metrics-reader >/dev/null
TOKEN=$(k create token metrics-reader -n kube-system)
docker exec "${CP1}" curl -sk -H "Authorization: Bearer ${TOKEN}" https://127.0.0.1:10257/metrics |
  grep -E 'kubernetes_feature_enabled\{name="NodeControllerLeaseCircuitBreaker"' || echo "metric 取得失敗"
echo "[$(ts)] RESULT"
kcm_state
