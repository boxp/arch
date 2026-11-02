#!/usr/bin/env python3
"""Node-local exclusive lease; a restart may reclaim only its own stale marker."""
import fcntl
import json
import os
from pathlib import Path
import sys
import time
import re


def acquire(directory, token, recover=False):
    directory = Path(directory)
    if not re.fullmatch(r'BOXP-(?:344|349)-[A-Za-z0-9_-]+', token):
        raise ValueError('invalid lease token')
    lock = open(directory / 'boxp344-window.lock', 'a+b')
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    marker = directory / 'boxp344-window.json'
    if (directory / 'completed-windows' / (token + '.json')).exists():
        raise RuntimeError('completed token cannot be reused')
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    if marker.exists():
        old = json.loads(marker.read_text())
        completed = old.get('state') == 'completed' and old.get('regeneration_allowed') is False
        if recover and completed:
            raise RuntimeError('completed window is immutable; no recovery needed')
        if not recover and completed:
            if old.get('token') == token or time.time() - old.get('completed_at', time.time()) < 120:
                raise RuntimeError('duplicate token or text service cooldown')
            archive = directory / 'completed-windows'
            archive.mkdir(exist_ok=True)
            # Preserve the completed marker permanently; never unlink a lock.
            if not re.fullmatch(r'BOXP-(?:344|349)-[A-Za-z0-9_-]+', old.get('token', '')):
                raise RuntimeError('invalid completed marker token')
            destination = archive / (old['token'] + '.json')
            try: os.link(marker, destination)
            except FileExistsError:
                if destination.read_bytes() != marker.read_bytes():
                    raise RuntimeError('completed archive conflict')
            fd = os.open(archive, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(fd)
            finally: os.close(fd)
        elif not recover or old.get('token') != token or old.get('boot') != boot:
            raise RuntimeError('marker requires explicit investigation')
        try:
            start = Path('/proc/%d/stat' % old['pid']).read_text().split()[21]
        except FileNotFoundError:
            start = None
        if start == old.get('start'):
            raise RuntimeError('previous owner still exists')
    elif recover:
        raise RuntimeError('recovery marker missing')
    data = {'token': token, 'state': 'active-or-recovery-needed', 'pid': os.getpid(),
            'start': Path('/proc/self/stat').read_text().split()[21], 'boot': boot}
    # Lock serializes writers; durable replace leaves either old or new marker.
    temp = directory / ('boxp344-window.%d.tmp' % os.getpid())
    with temp.open('x') as f:
        json.dump(data, f); f.flush(); os.fsync(f.fileno())
    os.replace(temp, marker)
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
    return lock


if __name__ == '__main__':
    token = sys.stdin.readline().strip()
    lock = acquire(sys.argv[1], token, sys.argv[2] == 'recover')
    print('LEASED', flush=True)
    sys.stdin.read()
