#!/usr/bin/env bash
set -euo pipefail

fail() { echo "$*" >&2; exit 1; }
immutable() { local attrs; attrs=$(lsattr -d -- "$1") || fail "Cannot inspect attributes: $1"; attrs=${attrs%% *}; [[ $attrs == *i* ]]; }
protect() {
  local dir=$1 mode=$2 changed=false
  if [[ ! -e $dir && ! -L $dir ]]; then
    if [[ $mode == check ]]; then
      echo 'immutable=no changed=true'
      return
    fi
    install -d -o root -g root -m 0755 -- "$dir"
    changed=true
  fi
  [[ -d $dir && ! -L $dir ]] || fail "Underlay is not a directory: $dir"
  [[ -z $(find "$dir" -mindepth 1 -maxdepth 1 -print -quit) ]] || fail "Underlay is not empty; inspect hidden data: $dir"
  if immutable "$dir"; then
    echo "immutable=yes changed=$changed"
  elif [[ $mode == check ]]; then
    echo 'immutable=no changed=true'
  else
    chattr +i -- "$dir"
    immutable "$dir" || fail 'Failed to verify immutable attribute'
    echo 'immutable=yes changed=true'
  fi
}
if [[ ${1:-} == --internal ]]; then
  parent=$2 rel=$3 mode=$4
  tmp=$(mktemp -d)
  cleanup() { if mountpoint -q "$tmp"; then umount "$tmp"; fi; rmdir "$tmp"; }
  trap cleanup EXIT
  mount --bind "$parent" "$tmp"
  protect "$tmp/$rel" "$mode"
  exit
fi
path= uuid= mode=
while (($#)); do
  case $1 in
    --path) path=${2:?}; shift 2 ;;
    --uuid) uuid=${2:?}; shift 2 ;;
    --mode) mode=${2:?}; shift 2 ;;
    *) fail "Unknown argument: $1" ;;
  esac
done
[[ $path == /* && $path != / && -n $uuid && ( $mode == check || $mode == apply ) ]] || fail 'Expected --path absolute-path --uuid UUID --mode check|apply'
if info=$(findmnt -n -o SOURCE,UUID,FSTYPE --mountpoint "$path"); then
  read -r source actual_uuid fstype <<< "$info"
  [[ $actual_uuid == "$uuid" && $fstype == ext4 ]] || fail "Mounted filesystem UUID or type mismatch: $info"
  immutable "$path" && fail 'Mounted SSD root is immutable; manual inspection required'
  parent=$(findmnt -n -o TARGET -T "$(dirname "$path")")
  if [[ $parent == / ]]; then rel=${path#/}; else rel=${path#"$parent"/}; fi
  [[ $rel != "$path" && -n $rel ]] || fail 'Cannot determine underlay relative path'
  result=$(unshare -m --propagation private bash "$0" --internal "$parent" "$rel" "$mode")
  state=mounted
else
  result=$(protect "$path" "$mode")
  state=unmounted
fi
printf 'USB_SSD_UNDERLAY state=%s %s\n' "$state" "$result"
