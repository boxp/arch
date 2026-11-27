#!/usr/bin/env bash
# BOXP-732: TaskRunnerLock.tla を、正しい版・実装どおりの版・意図的に壊した版のそれぞれで
# 性質ごとに TLC にかけ、結果 (ok / 違反) を expected.tsv と比べる。CI の必須 check ではない。
#
# 使い方:
#   JAVA=/path/to/java TLA2TOOLS_JAR=/path/to/tla2tools.jar ./run-tlc.sh [small|large]
#   ./run-tlc.sh --fetch DIR      # tla2tools.jar v1.7.4 を DIR に取得 (sha256 を確認)
# 出力: 1 行 = 版 性質 結果 生成状態数 (違反なら反例の手数)。expected.tsv と違えば終了コード 1。
# 反例の全文は $TLC_OUT (既定: 一時ディレクトリ) の <版>.<性質>.out に残る。
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

JAR_URL="https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar"
JAR_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"

if [[ "${1:-}" == "--fetch" ]]; then
  dir="${2:?usage: run-tlc.sh --fetch DIR}"
  mkdir -p "${dir}"
  curl -fsSL -o "${dir}/tla2tools.jar" "${JAR_URL}"
  echo "${JAR_SHA256}  ${dir}/tla2tools.jar" | sha256sum -c -
  exit 0
fi

size="${1:-small}"
case "${size}" in
  small) consts=("StaleAfter = 2" "MaxTime = 7" "MaxGrants = 3") ;;
  large) consts=("StaleAfter = 3" "MaxTime = 10" "MaxGrants = 4") ;;
  *) echo "unknown size: ${size}" >&2; exit 2 ;;
esac

JAVA="${JAVA:-java}"
: "${TLA2TOOLS_JAR:?set TLA2TOOLS_JAR (or run ./run-tlc.sh --fetch DIR)}"
echo "${JAR_SHA256}  ${TLA2TOOLS_JAR}" | sha256sum -c --quiet - || { echo "tla2tools.jar sha256 mismatch" >&2; exit 2; }

out="${TLC_OUT:-$(mktemp -d)}"
mkdir -p "${out}/tmp"

# 版: 名前 CheckOwnerOnHeartbeat CheckOwnerOnRelease RequireStale GuardedAcquire GuardedHeartbeat FenceCommit
variants=(
  "impl                  TRUE  TRUE  TRUE  TRUE  TRUE  FALSE"
  "fenced                TRUE  TRUE  TRUE  TRUE  TRUE  TRUE"
  "bad-hb-owner          FALSE TRUE  TRUE  TRUE  TRUE  FALSE"
  "bad-release-owner     TRUE  FALSE TRUE  TRUE  TRUE  FALSE"
  "bad-take-fresh        TRUE  TRUE  FALSE TRUE  TRUE  FALSE"
  "bad-acquire-unguarded TRUE  TRUE  TRUE  FALSE TRUE  FALSE"
  "bad-hb-unguarded      TRUE  TRUE  TRUE  TRUE  FALSE FALSE"
)
props=(NoForeignDisplace HeartbeatOnlyOwn AtMostOneRightfulHolder CommitOnlyByHolder SingleWorker NoProgressAfterTakeover)

actual="${out}/actual-${size}.tsv"
: >"${actual}"
for v in "${variants[@]}"; do
  read -r name hb rel stale acq hbg fence <<<"${v}"
  for p in "${props[@]}"; do
    cfg="${out}/${name}.${p}.cfg"
    {
      echo "SPECIFICATION Spec"
      echo "CONSTANTS"
      echo "  Runners = {A, B}"
      echo "  NoOwner = NoOwner"
      for c in "${consts[@]}"; do echo "  ${c}"; done
      echo "  CheckOwnerOnHeartbeat = ${hb}"
      echo "  CheckOwnerOnRelease = ${rel}"
      echo "  RequireStale = ${stale}"
      echo "  GuardedAcquire = ${acq}"
      echo "  GuardedHeartbeat = ${hbg}"
      echo "  FenceCommit = ${fence}"
      echo "INVARIANT TypeOK"
      case "${p}" in
        NoForeignDisplace|HeartbeatOnlyOwn) echo "PROPERTY ${p}" ;;
        *) echo "INVARIANT ${p}" ;;
      esac
      echo "CHECK_DEADLOCK FALSE"
    } >"${cfg}"
    log="${out}/${name}.${p}.out"
    "${JAVA}" -XX:+UseParallelGC -Djava.io.tmpdir="${out}/tmp" -cp "${TLA2TOOLS_JAR}" tlc2.TLC \
      -workers 1 -metadir "${out}/meta/${name}.${p}" -config "${cfg}" TaskRunnerLock.tla >"${log}" 2>&1 || true
    states="$(sed -n 's/^\([0-9]*\) states generated.*/\1/p' "${log}" | tail -n 1)"
    if grep -q 'Model checking completed. No error has been found.' "${log}"; then
      result=ok; detail="states=${states}"
    elif grep -Eq "(Invariant|Action property) ${p} is violated" "${log}"; then
      result=violated; detail="steps=$(grep -c '^State [0-9]*:' "${log}")"
    else
      result=error; detail="see ${log}"
    fi
    printf '%s\t%s\t%s\t%s\n' "${name}" "${p}" "${result}" "${detail}" | tee -a "${actual}"
  done
done

if diff <(cut -f1-3 expected.tsv) <(cut -f1-3 "${actual}"); then
  echo "all ${size} results match expected.tsv (logs: ${out})"
else
  echo "results differ from expected.tsv (logs: ${out})" >&2
  exit 1
fi
