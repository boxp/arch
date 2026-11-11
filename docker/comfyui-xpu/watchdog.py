#!/usr/bin/env python3
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time
from urllib.request import urlopen


def log(message):
    print(f"comfyui-watchdog: {message}", file=sys.stderr, flush=True)


def settings(env):
    values = []
    for name, default in (("POLL_SECONDS", "30"), ("MIN_GPU_MS", "200"),
                          ("STALL_SECONDS", "900")):
        key = "COMFYUI_WATCHDOG_" + name
        try:
            value = float(env.get(key, default))
            if not math.isfinite(value) or value < 0 or (name == "POLL_SECONDS" and value == 0):
                raise ValueError
        except ValueError:
            raise ValueError(f"{key} must be a finite non-negative number" +
                             (" greater than zero" if name == "POLL_SECONDS" else "")) from None
        values.append(value)
    return values


def gpu_time(pid, proc=Path('/proc')):
    clients = {}
    try:
        paths = (proc / str(pid) / 'fdinfo').iterdir()
        for path in paths:
            try:
                lines = path.read_text().splitlines()
                client = None
                times = []
                for line in lines:
                    key, sep, value = line.partition(':')
                    if not sep:
                        continue
                    if key == 'drm-client-id':
                        client = value.strip()
                    elif key.startswith('drm-engine-') and not key.startswith('drm-engine-capacity-'):
                        parts = value.split()
                        if len(parts) == 2 and parts[1] == 'ns' and parts[0].isdigit():
                            times.append(int(parts[0]))
                if client is not None and times:
                    clients[client] = max(clients.get(client, 0), sum(times))
            except (OSError, UnicodeError):
                continue
    except OSError:
        return None
    return sum(clients.values()) if clients else None


def cpu_time(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return (int(stat[11]) + int(stat[12])) * 1000 / os.sysconf('SC_CLK_TCK')
    except (OSError, ValueError, IndexError):
        return None


class StallDetector:
    def __init__(self, stall_seconds, min_gpu_ms):
        self.stall = stall_seconds
        self.minimum = min_gpu_ms * 1_000_000
        self.prompt = None
        self.since = None
        self.baseline = None
        self.ever_read = False
        self.warned = False
        self.last_log = None
        self.log_gpu = None
        self.log_cpu = None

    def tick(self, now, queue, gpu, cpu):
        if gpu is not None:
            self.ever_read = True
        if queue is None:
            return False
        if not queue:
            self.prompt = None
            return False
        prompt = queue[0][1]
        if prompt != self.prompt:
            self.prompt, self.since, self.baseline = prompt, now, gpu
            self.last_log = None
            self.log_gpu, self.log_cpu = gpu, cpu
        if self.baseline is None and gpu is not None:
            self.baseline, self.since = gpu, now
        elif gpu is not None and self.baseline is not None:
            if gpu < self.baseline or gpu - self.baseline >= self.minimum and gpu > self.baseline:
                self.baseline, self.since = gpu, now
        if not self.ever_read and not self.warned:
            log(f'warning: no GPU engine time readable for prompt {prompt}')
            self.warned = True
        elapsed = now - self.since
        gpu_delta = (gpu - self.log_gpu) / 1_000_000 if gpu is not None and self.log_gpu is not None else None
        cpu_delta = cpu - self.log_cpu if cpu is not None and self.log_cpu is not None else None
        def fmt(value):
            return 'unknown' if value is None else f'{value:.0f}'
        if self.stall and elapsed >= self.stall and gpu is not None and self.baseline is not None:
            log(f'stalled prompt {prompt}: {elapsed:.1f}s without GPU progress; GPU {fmt(gpu_delta)} ms, CPU {fmt(cpu_delta)} ms since previous log')
            return True
        if self.last_log is None or now - self.last_log >= 60:
            log(f'prompt {prompt}: {elapsed:.1f}s since GPU progress; GPU {fmt(gpu_delta)} ms, CPU {fmt(cpu_delta)} ms since previous log')
            self.last_log, self.log_gpu, self.log_cpu = now, gpu, cpu
        return False


def queue_running():
    try:
        with urlopen('http://127.0.0.1:8188/queue', timeout=10) as response:
            queue = json.load(response)['queue_running']
        if not isinstance(queue, list) or any(not isinstance(item, list) or len(item) < 2 or not isinstance(item[1], str) for item in queue):
            return None
        return queue
    except (OSError, ValueError, KeyError, TypeError):
        return None


def main():
    try:
        poll, minimum, stall = settings(os.environ)
    except ValueError as exc:
        log(str(exc))
        return 2
    if len(sys.argv) < 3 or sys.argv[1] != '--':
        log('usage: comfyui-watchdog -- command [args ...]')
        return 2
    child = subprocess.Popen(sys.argv[2:])
    def forward(signum, _frame):
        try:
            child.send_signal(signum)
        except ProcessLookupError:
            pass
    signal.signal(signal.SIGTERM, forward)
    signal.signal(signal.SIGINT, forward)
    detector = StallDetector(stall, minimum)
    while True:
        try:
            status = child.wait(timeout=poll)
            return status if status >= 0 else 128 - status
        except subprocess.TimeoutExpired:
            pass
        result = []
        thread = threading.Thread(target=lambda: result.append(queue_running()), daemon=True)
        thread.start()
        while thread.is_alive():
            try:
                status = child.wait(timeout=0.1)
                return status if status >= 0 else 128 - status
            except subprocess.TimeoutExpired:
                pass
        queue = result[0]
        if child.poll() is not None:
            continue
        if detector.tick(time.monotonic(), queue, gpu_time(child.pid), cpu_time(child.pid)):
            forward(signal.SIGTERM, None)
            try:
                child.wait(timeout=15)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
            return 70


if __name__ == '__main__':
    sys.exit(main())
