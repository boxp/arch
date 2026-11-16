#!/usr/bin/env bash
# BOXP-561 資源観測。30 秒ごとに TSV を追記し、中止条件で DIR/ABORT を作る。
# usage: obs.sh start|stop DIR
set -euo pipefail
here=$(cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck source=docs/project_docs/BOXP-561/tools/common.sh
source "$here/common.sh"
require_tmp
NODE=192.168.10.107
op=${1:-}
dir=${2:-}
if ! [[ $op =~ ^(start|stop)$ && -n $dir ]] || ! under_tmp "$dir"; then
  echo "usage: obs.sh start|stop DIR" >&2
  exit 2
fi
case $op in
  start)
    mkdir -p "$dir"
    [[ ! -e $dir/obs.pid ]] || {
      echo "already running" >&2
      exit 1
    }
    (
      low=0
      fail=0
      base=""
      while :; do
        line=$(ssh -o BatchMode=yes -o ConnectTimeout=10 $NODE "awk '/MemAvailable/{m=\$2} END{printf \"%s\", m}' /proc/meminfo; printf '\t'; cut -d' ' -f1 /proc/loadavg | tr -d '\n'; printf '\t'; if d=\$(sudo -n dmesg 2>/dev/null); then printf '%s\n' \"\$d\" | grep -Eic 'GPU HANG|GPU reset' || true; else echo NA; fi" 2>/dev/null || echo -e "NA\tNA\tNA")
        g=$(kubectl -n local-llm get cm llama-server-admission -o jsonpath='{.data.state}' 2>/dev/null || echo NA)
        IFS=$'\t' read -r mem load hang <<<"$line"
        printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$mem" "$load" "$hang" "$g" >>"$dir/obs.tsv"
        if [[ $mem =~ ^[0-9]+$ ]]; then if ((mem < 12 * 1024 * 1024)); then low=$((low + 1)); else low=0; fi; fi
        [[ -z $base && $hang =~ ^[0-9]+$ ]] && base=$hang
        # SSH や監視値の取得失敗が続いたら、メモリ・GPU 異常を検出できないので中止する
        if [[ $mem =~ ^[0-9]+$ && $hang =~ ^[0-9]+$ ]]; then fail=0; else fail=$((fail + 1)); fi
        if ((fail >= 2)); then echo "$(date -u +%FT%TZ) observation unavailable x2 (mem=$mem hang=$hang)" >>"$dir/ABORT"; fi
        if ((low >= 2)); then echo "$(date -u +%FT%TZ) MemAvailable<12GiB x2" >>"$dir/ABORT"; fi
        if [[ $hang =~ ^[0-9]+$ && -n $base ]] && ((hang > base)); then echo "$(date -u +%FT%TZ) GPU HANG/reset $base->$hang" >>"$dir/ABORT"; fi
        sleep 30
      done
    ) >/dev/null 2>&1 &
    echo $! >"$dir/obs.pid"
    echo "obs started pid=$(cat "$dir/obs.pid") dir=$dir"
    ;;
  stop)
    [[ -f $dir/obs.pid ]] && kill "$(cat "$dir/obs.pid")" 2>/dev/null || true
    rm -f "$dir/obs.pid"
    awk -F'\t' '$2 ~ /^[0-9]+$/ {n++; if(min==""||$2<min)min=$2; if($3>maxl)maxl=$3; if(h0=="")h0=$4; h1=$4}
    END{printf "samples=%d min_MemAvailable_GiB=%.1f max_load1=%s hang_delta=%d\n", n, min/1048576, maxl, h1-h0}' "$dir/obs.tsv"
    [[ -e $dir/ABORT ]] && {
      echo "ABORT:"
      cat "$dir/ABORT"
    } || echo "abort=none"
    ;;
esac
