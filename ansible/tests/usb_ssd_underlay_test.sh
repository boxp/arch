#!/usr/bin/env bash
set -euo pipefail
[[ $(id -u) == 0 ]] || { echo 'Requires root' >&2; exit 1; }
script=$(realpath "$(dirname "$0")/../files/usb-ssd-underlay.sh")
T=$(mktemp -d)
root_loop= ssd_loop=
cleanup() {
  set +e
  if mountpoint -q "$T/root/var/lib/longhorn-usb"; then umount "$T/root/var/lib/longhorn-usb"; fi
  chattr -i "$T/root/var/lib/longhorn-usb" "$T/root/fresh" 2>/dev/null
  umount "$T/root" 2>/dev/null
  [[ -z $ssd_loop ]] || losetup -d "$ssd_loop"
  [[ -z $root_loop ]] || losetup -d "$root_loop"
  rm -r "$T"
}
trap cleanup EXIT
truncate -s 128M "$T/root.img" "$T/ssd.img"
root_loop=$(losetup --find --show "$T/root.img")
ssd_loop=$(losetup --find --show "$T/ssd.img")
mkfs.ext4 -q "$root_loop"
mkfs.ext4 -q "$ssd_loop"
mkdir "$T/root"
mount "$root_loop" "$T/root"
P=$T/root/var/lib/longhorn-usb
mkdir -p "$P"
mount "$ssd_loop" "$P"
uuid=$(blkid -s UUID -o value "$ssd_loop")
count=$(wc -l < /proc/self/mountinfo)
run() {
  local output
  output=$(bash "$script" --path "$P" --uuid "$uuid" --mode "$1") || { [[ $(wc -l < /proc/self/mountinfo) == "$count" ]]; return 1; }
  [[ $(wc -l < /proc/self/mountinfo) == "$count" ]]
  printf '%s\n' "$output"
}
[[ $(run apply) == *'immutable=yes changed=true' ]]
[[ $(run apply) == *'immutable=yes changed=false' ]]
[[ $(run check) == *'immutable=yes changed=false' ]]
[[ $(lsattr -d "$P" | cut -d" " -f1) != *i* ]]
mkdir "$P/replicas"
# Inspect the protected underlay and test that writes fail in an isolated namespace.
mkdir "$T/view"
unshare -m --propagation private bash -c 'mount --bind "$1" "$2"; lsattr -d "$2/var/lib/longhorn-usb" | cut -d" " -f1 | grep -q i; ! mkdir "$2/var/lib/longhorn-usb/blocked"' _ "$T/root" "$T/view"
if bash "$script" --path "$P" --uuid wrong --mode apply; then exit 1; fi
[[ $(wc -l < /proc/self/mountinfo) == "$count" ]]
umount "$P"
count=$(wc -l < /proc/self/mountinfo)
if mkdir "$P/blocked"; then exit 1; fi
chattr -i "$P"
mkdir "$P/hidden"
mount "$ssd_loop" "$P"
count=$(wc -l < /proc/self/mountinfo)
if run apply; then exit 1; fi
umount "$P"
count=$(wc -l < /proc/self/mountinfo)
[[ -d $P/hidden ]]
rmdir "$P/hidden"
[[ $(run check) == *'immutable=no changed=true' ]]
[[ $(lsattr -d "$P" | cut -d" " -f1) != *i* ]]
[[ $(run apply) == *'immutable=yes changed=true' ]]
if mkdir "$P/replicas"; then exit 1; fi
[[ $(wc -l < /proc/self/mountinfo) == "$count" ]]
echo 'USB SSD underlay regression passed'
