#!/usr/bin/env bash
# Fixture tests for scripts/upgrade-k8s/readyz-watch.sh (BOXP-213).
# Time is simulated: READYZ_NOW_CMD reads a clock file, READYZ_SLEEP_CMD advances it,
# READYZ_PROBE_CMD answers from a schedule fixture (tests/upgrade-k8s/fixtures/*.schedule).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WATCH="${ROOT_DIR}/scripts/upgrade-k8s/readyz-watch.sh"
FIXTURES="${ROOT_DIR}/tests/upgrade-k8s/fixtures"
WORKFLOW="${ROOT_DIR}/.github/workflows/upgrade-k8s.yml"

VIP_IP=10.0.0.99
CP1_IP=10.0.0.1
CP2_IP=10.0.0.2
CP3_IP=10.0.0.3
START_EPOCH=1700000000

fail() {
  echo "error: $*" >&2
  exit 1
}

assert_eq() {
  local actual="$1" expected="$2" msg="$3"
  [[ "$actual" == "$expected" ]] || fail "${msg}: expected '${expected}', got '${actual}'"
}

assert_file_contains() {
  grep -Eq "$2" "$1" || fail "expected $1 to match $2"
}

assert_file_not_contains() {
  if grep -Eq "$2" "$1"; then fail "expected $1 not to match $2"; fi
}

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BIN="$TMP/bin"
mkdir -p "$BIN"

cat >"$BIN/fake-now" <<'FAKE'
#!/usr/bin/env bash
cat "$FAKE_CLOCK_FILE"
FAKE

cat >"$BIN/fake-sleep" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
now="$(cat "$FAKE_CLOCK_FILE")"
echo $((now + $1)) >"$FAKE_CLOCK_FILE"
if [[ -n "${FAKE_STOP_AT:-}" && -n "${FAKE_STOP_FILE:-}" ]] && [[ $((now + $1 - FAKE_START)) -ge "$FAKE_STOP_AT" ]]; then
  touch "$FAKE_STOP_FILE"
fi
FAKE

# fake-probe <host> <ip>...  — looks up the schedule row for the current elapsed time.
cat >"$BIN/fake-probe" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
host="$1"; shift
now="$(cat "$FAKE_CLOCK_FILE")"
elapsed=$((now - FAKE_START))
row=""
while read -r from vip s1 s2 s3 down; do
  [[ -z "$from" || "$from" == \#* ]] && continue
  if [[ "$elapsed" -ge "$from" ]]; then row="$vip $s1 $s2 $s3 ${down:-}"; fi
done <"$FAKE_SCHEDULE"
[[ -n "$row" ]] || { echo "no schedule row for elapsed=$elapsed" >&2; exit 1; }
read -r vip s1 s2 s3 down <<<"$row"
printf '%s\n' "$host" >>"$FAKE_PROBE_LOG"
if [[ ",${down:-}," == *",${host},"* ]]; then
  echo "ssh: connect to host ${host}: Connection timed out" >&2
  exit 255
fi
for ip in "$@"; do
  case "$ip" in
    "$FAKE_VIP_IP") code="$vip" ;;
    "$FAKE_CP1_IP") code="$s1" ;;
    "$FAKE_CP2_IP") code="$s2" ;;
    "$FAKE_CP3_IP") code="$s3" ;;
    *) code="000" ;;
  esac
  printf '%s %s\n' "$ip" "$code"
done
FAKE
chmod +x "$BIN"/fake-*

# run_watch <case-name> <schedule> [extra args...] ; sets OUT and RC
run_watch() {
  local name="$1" schedule="$2"
  shift 2
  OUT="$TMP/$name"
  mkdir -p "$OUT"
  echo "$START_EPOCH" >"$OUT/clock"
  : >"$OUT/probe.log"
  set +e
  env FAKE_CLOCK_FILE="$OUT/clock" FAKE_START="$START_EPOCH" FAKE_SCHEDULE="$FIXTURES/$schedule" \
    FAKE_PROBE_LOG="$OUT/probe.log" FAKE_VIP_IP="$VIP_IP" FAKE_CP1_IP="$CP1_IP" FAKE_CP2_IP="$CP2_IP" FAKE_CP3_IP="$CP3_IP" \
    FAKE_STOP_FILE="$OUT/stop" \
    READYZ_NOW_CMD="$BIN/fake-now" READYZ_SLEEP_CMD="$BIN/fake-sleep" READYZ_PROBE_CMD="$BIN/fake-probe" \
    "$WATCH" --vip "vip=$VIP_IP" --cp "shanghai-1=$CP1_IP" --cp "shanghai-2=$CP2_IP" --cp "shanghai-3=$CP3_IP" \
    --out-dir "$OUT/artifact" --interval 30 --halt-after 180 "$@" >"$OUT/stdout.log" 2>&1
  RC=$?
  set -e
}

summary() { jq -r "$1" "$OUT/artifact/readyz-summary.json"; }
iso_at() { date -u -d "@$((START_EPOCH + $1))" +%FT%TZ; }

echo "== case: all ok for 5 minutes"
run_watch all-ok all-ok.schedule --duration 300 --updating-node shanghai-1
assert_eq "$RC" 0 "exit code"
assert_eq "$(summary .verdict)" ok "verdict"
assert_eq "$(summary .stop_reason)" duration "stop reason"
assert_eq "$(summary .ticks)" 10 "ticks (0..270s every 30s)"
assert_eq "$(summary .samples)" 40 "samples (4 targets x 10 ticks)"
assert_eq "$(wc -l <"$OUT/artifact/readyz-samples.jsonl")" 40 "jsonl lines"
assert_eq "$(summary .transient_episodes)" 0 "transient episodes"
[[ ! -e "$OUT/artifact/HALT" ]] || fail "HALT marker must not exist"
# every sample has the required fields
assert_eq "$(jq -c 'select((.ts|type)!="string" or (.target|type)!="string" or (.http_code|type)!="string" or (.ok|type)!="boolean")' "$OUT/artifact/readyz-samples.jsonl" | wc -l)" 0 "sample schema"
assert_eq "$(jq -r 'select(.target=="shanghai-1") | .excluded' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" true "updating node marked excluded"
assert_eq "$(jq -r 'select(.target=="vip") | .kind' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" vip "vip kind"
# the probe never runs on the updating node, and sticks to the first good host
assert_eq "$(sort -u "$OUT/probe.log" | tr '\n' ' ')" "shanghai-2 " "probe host"
assert_eq "$(summary .updating_node)" shanghai-1 "updating node in summary"

echo "== case: transient VIP failure (90s) does not halt"
run_watch transient-vip transient-vip.schedule --duration 300 --updating-node shanghai-1
assert_eq "$RC" 0 "exit code"
assert_eq "$(summary .verdict)" ok "verdict"
assert_eq "$(summary .transient_episodes)" 1 "transient episodes"
assert_eq "$(summary .longest_bad_seconds)" 60 "longest bad (ticks at 60,90,120 -> 60s span)"
assert_eq "$(jq -r 'select(.target=="vip" and .ok==false) | .http_code' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" 000 "vip failure code recorded"
assert_eq "$(jq -r 'select(.target=="vip" and .ok==false) | .tick' "$OUT/artifact/readyz-samples.jsonl" | tr '\n' ' ')" "3 4 5 " "vip failed ticks"
assert_eq "$(jq -r '.type' "$OUT/artifact/readyz-events.jsonl" | tr '\n' ' ')" "start bad_start recovered stop " "event sequence"
assert_file_contains "$OUT/artifact/readyz-events.jsonl" '"type":"bad_start","detail":"vip_readyz_failed"'
[[ ! -e "$OUT/artifact/HALT" ]] || fail "HALT marker must not exist"

echo "== case: sustained VIP failure halts after 180s"
run_watch sustained-vip sustained-vip.schedule --duration 1800 --updating-node shanghai-1
assert_eq "$RC" 2 "exit code"
assert_eq "$(summary .verdict)" halt "verdict"
assert_eq "$(summary .stop_reason)" halt "stop reason"
assert_eq "$(summary .halt_reason)" vip_readyz_failed "halt reason"
assert_eq "$(summary .bad_since)" "$(iso_at 60)" "bad since"
assert_eq "$(summary .halt_at)" "$(iso_at 240)" "halt at (60s + 180s)"
assert_eq "$(summary .ticks)" 9 "no probing after halt"
[[ -f "$OUT/artifact/HALT" ]] || fail "HALT marker expected"
assert_file_contains "$OUT/artifact/HALT" "^HALT $(iso_at 240) vip_readyz_failed$"
assert_file_contains "$OUT/stdout.log" "HALT: vip_readyz_failed sustained for 180s"
assert_eq "$(jq -r 'select(.target=="vip" and .ok==false) | .http_code' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" 503 "http code preserved"
assert_eq "$(jq -r 'select(.type=="halt") | .type' "$OUT/artifact/readyz-events.jsonl")" halt "halt event"

echo "== case: updating CP down + one other CP down is not a redundancy loss"
run_watch updating-plus-one updating-cp-plus-one.schedule --duration 600 --updating-node shanghai-1
assert_eq "$RC" 0 "exit code"
assert_eq "$(summary .verdict)" ok "verdict"
assert_eq "$(summary .transient_episodes)" 0 "no bad ticks at all"
assert_eq "$(jq -r 'select(.target=="shanghai-1") | .ok' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" false "updating node failures still recorded"
[[ ! -e "$OUT/artifact/HALT" ]] || fail "HALT marker must not exist"

echo "== case: two non-updating CPs down for 180s halts"
run_watch two-cp-sustained two-cp-sustained.schedule --duration 1800 --updating-node shanghai-1
assert_eq "$RC" 2 "exit code"
assert_eq "$(summary .verdict)" halt "verdict"
assert_eq "$(summary .halt_reason)" "cp_readyz_failed(shanghai-2 shanghai-3)" "halt reason"
assert_eq "$(summary .halt_at)" "$(iso_at 210)" "halt at (30s + 180s)"
[[ -f "$OUT/artifact/HALT" ]] || fail "HALT marker expected"

echo "== case: two CPs down for 150s then recover is transient"
run_watch two-cp-transient two-cp-transient.schedule --duration 400
assert_eq "$RC" 0 "exit code"
assert_eq "$(summary .verdict)" ok "verdict"
assert_eq "$(summary .transient_episodes)" 1 "transient episodes"
assert_eq "$(summary .longest_bad_seconds)" 120 "longest bad (ticks 30..150)"
assert_eq "$(summary .updating_node)" "" "no updating node during observation"

echo "== case: probe host failover skips an unreachable candidate"
run_watch probe-failover probe-failover.schedule --duration 120 --updating-node shanghai-1
assert_eq "$RC" 0 "exit code"
assert_eq "$(summary .verdict)" ok "verdict"
assert_eq "$(jq -r '.probe_host' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" shanghai-3 "probe host recorded"
assert_eq "$(jq -r 'select(.ok==false)' "$OUT/artifact/readyz-samples.jsonl" | wc -l)" 0 "all targets ok via failover host"
assert_file_contains "$OUT/stdout.log" "probe host shanghai-2 unreachable"

echo "== case: no reachable probe host counts as failure and halts"
run_watch probe-unreachable probe-unreachable.schedule --duration 1800 --updating-node shanghai-1
assert_eq "$RC" 2 "exit code"
assert_eq "$(summary .verdict)" halt "verdict"
assert_eq "$(summary .halt_reason)" "vip_readyz_failed+cp_readyz_failed(shanghai-2 shanghai-3)" "halt reason"
assert_eq "$(summary .halt_at)" "$(iso_at 240)" "halt at"
assert_eq "$(jq -r 'select(.tick>=3) | .error' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" probe_unreachable "probe error recorded"
assert_eq "$(jq -r 'select(.tick>=3) | .probe_host' "$OUT/artifact/readyz-samples.jsonl" | sort -u)" null "no probe host when unreachable"

echo "== case: stop file ends the watch (upgrade finished) with no halt"
# Stop at 150s while VIP has been failing since 60s (90s < 180s): must end cleanly, no halt.
OUT="$TMP/stop-file"; mkdir -p "$OUT"; echo "$START_EPOCH" >"$OUT/clock"; : >"$OUT/probe.log"
set +e
env FAKE_CLOCK_FILE="$OUT/clock" FAKE_START="$START_EPOCH" FAKE_SCHEDULE="$FIXTURES/sustained-vip.schedule" \
  FAKE_PROBE_LOG="$OUT/probe.log" FAKE_VIP_IP="$VIP_IP" FAKE_CP1_IP="$CP1_IP" FAKE_CP2_IP="$CP2_IP" FAKE_CP3_IP="$CP3_IP" \
  FAKE_STOP_FILE="$OUT/stop" FAKE_STOP_AT=150 \
  READYZ_NOW_CMD="$BIN/fake-now" READYZ_SLEEP_CMD="$BIN/fake-sleep" READYZ_PROBE_CMD="$BIN/fake-probe" \
  "$WATCH" --vip "vip=$VIP_IP" --cp "shanghai-1=$CP1_IP" --cp "shanghai-2=$CP2_IP" --cp "shanghai-3=$CP3_IP" \
  --out-dir "$OUT/artifact" --interval 30 --halt-after 180 --stop-file "$OUT/stop" --updating-node shanghai-1 >"$OUT/stdout.log" 2>&1
RC=$?
set -e
assert_eq "$RC" 0 "exit code"
assert_eq "$(summary .verdict)" ok "verdict"
assert_eq "$(summary .stop_reason)" stop_file "stop reason"
assert_eq "$(summary .ticks)" 5 "ticks before stop (0..120s)"
assert_eq "$(jq -r '.bad_since' "$OUT/artifact/readyz-summary.json")" "$(iso_at 60)" "ongoing episode kept in summary"
assert_file_contains "$OUT/artifact/readyz-events.jsonl" '"type":"stop","detail":"stop_file \(unresolved vip_readyz_failed for 90s < 180s\)"'
[[ ! -e "$OUT/artifact/HALT" ]] || fail "HALT marker must not exist"

echo "== case: artifacts contain no IPs / endpoints / credentials"
for d in all-ok sustained-vip probe-unreachable stop-file; do
  for f in readyz-samples.jsonl readyz-events.jsonl readyz-summary.json; do
    assert_file_not_contains "$TMP/$d/artifact/$f" '10\.0\.0\.|192\.168\.|bastion|b0xp\.io|CF-Access|ssh'
  done
  assert_file_not_contains "$TMP/$d/stdout.log" '10\.0\.0\.|192\.168\.|bastion|b0xp\.io|CF-Access'
done

echo "== case: usage errors"
set +e
"$WATCH" --vip "vip=$VIP_IP" --out-dir "$TMP/usage" --duration 10 >/dev/null 2>&1; rc1=$?
"$WATCH" --vip "vip=$VIP_IP" --cp "shanghai-1=$CP1_IP" --out-dir "$TMP/usage" >/dev/null 2>&1; rc2=$?
"$WATCH" --vip "vip=$VIP_IP" --cp "shanghai-1=$CP1_IP" --out-dir "$TMP/usage" --duration 10 --updating-node shanghai-1 >/dev/null 2>&1; rc3=$?
set -e
assert_eq "$rc1" 64 "missing --cp"
assert_eq "$rc2" 64 "missing --duration/--stop-file"
assert_eq "$rc3" 64 "no probe-host candidate"

echo "== case: upgrade-k8s.yml wiring (opt-in, step order, always() evaluation)"
command -v bb >/dev/null 2>&1 || fail "babashka (bb) is required for the workflow structure check"
# shellcheck disable=SC2016 # Clojure source, not shell
bb -e '
(require (quote [clj-yaml.core :as yaml]))
(let [wf (yaml/parse-string (slurp (first *command-line-args*)))
      ;; clj-yaml reads the bare `on:` key as boolean true (YAML 1.1)
      on-key (or (some #{:on} (keys wf)) true)
      inputs (get-in wf [on-key :workflow_dispatch :inputs])
      jobs (:jobs wf)
      nodes {:upgrade-cp-1 "shanghai-1" :upgrade-cp-2 "shanghai-2" :upgrade-cp-3 "shanghai-3"
             :upgrade-worker-1 "golyat-1" :upgrade-worker-2 "golyat-2" :upgrade-worker-3 "golyat-3" :upgrade-worker-4 "golyat-4"}
      errors (atom [])
      check (fn [ok? msg] (when-not ok? (swap! errors conj msg)))
      idx (fn [steps nm] (first (keep-indexed (fn [i s] (when (= (:name s) nm) i)) steps)))]
  (check (= false (get-in inputs [:readyz_watch :default])) "readyz_watch input must default to false (opt-in)")
  (check (= "boolean" (get-in inputs [:readyz_watch :type])) "readyz_watch input must be boolean")
  (check (contains? inputs :readyz_observe_minutes) "readyz_observe_minutes input missing")
  (check (<= (count inputs) 10) "workflow_dispatch allows at most 10 inputs")
  (doseq [[job node] nodes]
    (let [steps (get-in jobs [job :steps])
          i-ssh (idx steps "Setup SSH config for readyz probe hosts")
          i-start (idx steps "Start readyz watch")
          i-up (idx steps (str "Upgrade " node))
          i-stop (idx steps "Stop readyz watch and evaluate")
          i-upload (idx steps "Upload readyz watch artifact")
          up-step (when i-up (nth steps i-up))]
      (check (and i-ssh i-start i-up i-stop i-upload) (str (name job) ": readyz steps missing"))
      (when (and i-ssh i-start i-up i-stop i-upload)
        (check (< i-ssh i-start i-up i-stop i-upload) (str (name job) ": readyz steps out of order"))
        (check (= "inputs.readyz_watch" (:if (nth steps i-start))) (str (name job) ": Start readyz watch must be gated by inputs.readyz_watch"))
        (check (= "inputs.readyz_watch" (:if (nth steps i-ssh))) (str (name job) ": probe-host SSH config must be gated by inputs.readyz_watch"))
        (check (= "always() && inputs.readyz_watch" (:if (nth steps i-stop))) (str (name job) ": evaluation must run with always()"))
        (check (= "always() && inputs.readyz_watch" (:if (nth steps i-upload))) (str (name job) ": upload must run with always()"))
        (check (nil? (:if up-step)) (str (name job) ": existing Upgrade step must stay unconditional"))
        (check (re-find (re-pattern (str "--updating-node " node " ")) (:run (nth steps i-start))) (str (name job) ": watcher must exclude the updating node"))
        (check (re-find #"--halt-after 180" (:run (nth steps i-start))) (str (name job) ": halt-after must be 180s"))
        (check (re-find #"--interval 30" (:run (nth steps i-start))) (str (name job) ": interval must be 30s"))
        (check (re-find #"HALT" (:run (nth steps i-stop))) (str (name job) ": evaluation must check the HALT marker"))
        (check (re-find #"WATCH_RC" (:run (nth steps i-stop))) (str (name job) ": evaluation must check the watcher exit code"))
        (check (re-find #"echo \"\$WATCH_RC\" > \"\$READYZ_WATCH_DIR/rc\"" (:run (nth steps i-start))) (str (name job) ": watcher exit code must be recorded"))
        (check (re-find #"exit 2" (:run (nth steps i-stop))) (str (name job) ": evaluation must fail the job on HALT"))
        (check (= (str "readyz-watch-" node) (get-in (nth steps i-upload) [:with :name])) (str (name job) ": artifact name")))))
  (let [steps (get-in jobs [:post-check :steps])
        i-health (idx steps "Verify cluster health")
        i-obs (idx steps "Post-upgrade readyz observation")
        i-upload (idx steps "Upload readyz observation artifact")]
    (check (and i-health i-obs i-upload) "post-check: readyz observation steps missing")
    (when (and i-health i-obs i-upload)
      (check (< i-health i-obs i-upload) "post-check: observation must follow the health check")
      (check (= "inputs.readyz_watch" (:if (nth steps i-obs))) "post-check: observation must be gated by inputs.readyz_watch")
      (check (re-find #"--duration" (:run (nth steps i-obs))) "post-check: observation must use --duration")
      (check (not (re-find #"--updating-node" (:run (nth steps i-obs)))) "post-check: observation must not exclude any CP")
      (check (re-find #"-gt 60" (:run (nth steps i-obs))) "post-check: observation window must be capped at 60 min")
      (check (>= (get-in jobs [:post-check :timeout-minutes]) 90) "post-check: timeout must cover setup + a 60 min observation window")))
  (doseq [e @errors] (println "workflow check failed:" e))
  (System/exit (if (empty? @errors) 0 1)))
' "$WORKFLOW" || fail "workflow structure check failed"

echo "all readyz-watch tests passed"
