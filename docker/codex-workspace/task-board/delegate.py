#!/usr/bin/env python3
"""Run one subscription Codex delegation and retain only its verification evidence."""
import json
import os
from pathlib import Path
import subprocess
import signal
import sys
import tempfile
import threading

DELEGATION_TIMEOUT_SECONDS = 1800

REASONS = {'small-task', 'shared-context', 'elevated-permissions', 'final-judgment', 'full-reasoning'}

def evidence_path():
    return Path(os.environ['TASK_BOARD_DELEGATION_EVIDENCE'])

def model():
    return os.environ.get('CODEX_TASK_BOARD_MODEL') or 'gpt-6.1-terra'

def session_model(thread):
    if not isinstance(thread, str) or not __import__('re').fullmatch(r'[0-9a-fA-F-]{36}', thread):
        return None
    root = Path(os.environ.get('CODEX_HOME', str(Path.home() / '.codex'))) / 'sessions'
    matches = list(root.rglob('*' + thread + '.jsonl'))
    if len(matches) != 1:
        return None
    found_id, models, terminal = None, [], None
    with matches[0].open() as f:
        for line in f:
            try:
                event = json.loads(line)
            except ValueError:
                return None
            if event.get('type') == 'session_meta':
                found_id = event.get('payload', {}).get('id')
            if event.get('type') == 'turn_context':
                models.append(event.get('payload', {}).get('model'))
            if event.get('type') == 'event_msg' and event.get('payload', {}).get('type') in ('task_complete', 'task_aborted'):
                terminal = event['payload']['type']
    return models if found_id == thread and models and terminal == 'task_complete' else None

def write(data):
    path = evidence_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile('w', dir=path.parent, delete=False) as f:
        json.dump(data, f)
        name = f.name
    os.replace(name, path)

def verify():
    try:
        data = json.loads(evidence_path().read_text())
        if data.get('kind') == 'exempt':
            return data.get('reason') in REASONS
        return (data.get('kind') == 'delegated' and data.get('exit') == 0
                and data.get('completed') is True and data.get('model') == model()
                and all(m == model() for m in (session_model(data.get('thread')) or [None])))
    except (OSError, ValueError, KeyError, TypeError):
        return False

def main():
    args = sys.argv[1:]
    if args == ['verify']:
        return 0 if verify() else 1
    if args != ['run'] and not (len(args) == 2 and args[0] == 'exempt' and args[1] in REASONS):
        print('usage: delegate.py run | exempt <reason> | verify', file=sys.stderr)
        return 2
    # Atomically reserve the only attempt; failures cannot be replaced by exemptions.
    try:
        with evidence_path().open('x') as f:
            json.dump({'kind': 'failed'}, f)
    except FileExistsError:
        print('Delegation already attempted.', file=sys.stderr)
        return 1
    if args[0] == 'exempt':
        write({'kind': 'exempt', 'reason': args[1]})
        return 0
    env = os.environ.copy()
    for key in ('OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_ADMIN_KEY'):
        env.pop(key, None)
    env.pop('TASK_BOARD_DELEGATION_EVIDENCE', None)
    prompt = sys.stdin.read() + '\nDo not delegate recursively or invoke the Task Board delegation helper.\n'
    def heartbeat(done):
        while not done.wait(30):
            print('Delegation still running.', file=sys.stderr, flush=True)
    done = threading.Event()
    threading.Thread(target=heartbeat, args=(done,), daemon=True).start()
    child = None
    def stop_child():
        # All processes remain in the runner's group so its shutdown KILL covers
        # even a helper killed before it can forward a signal. On timeout, kill
        # the child's descendants first without killing the runner itself.
        descendants = {child.pid} if child is not None else set()
        for _ in range(10):
            before = len(descendants)
            for entry in Path('/proc').iterdir():
                if not entry.name.isdigit():
                    continue
                try:
                    status = (entry / 'status').read_text()
                    ppid = int(next(x.split()[1] for x in status.splitlines() if x.startswith('PPid:')))
                    if ppid in descendants:
                        descendants.add(int(entry.name))
                except (OSError, StopIteration, ValueError):
                    continue
            if len(descendants) == before:
                break
        for pid in sorted(descendants, reverse=True):
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    try:
        permissions = (['--dangerously-bypass-approvals-and-sandbox']
                       if env.get('CODEX_TASK_BOARD_BYPASS_APPROVALS', 'true') == 'true'
                       else ['--sandbox', env.get('CODEX_TASK_BOARD_SANDBOX', 'workspace-write')])
        child = subprocess.Popen(['codex', 'exec', '--json', '--model', model(),
                                  '-c', 'forced_login_method="chatgpt"', '-c', 'model_provider="openai"',
                                  *permissions, '--skip-git-repo-check', '-'],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, env=env)
        stdout, stderr = child.communicate(input=prompt, timeout=DELEGATION_TIMEOUT_SECONDS)
    except (OSError, subprocess.TimeoutExpired):
        stop_child()
        if child is not None:
            child.communicate()
        print('Delegation unavailable or timed out.', file=sys.stderr)
        return 1
    finally:
        done.set()
    thread, completed, failed = None, False, False
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get('type') == 'thread.started':
            thread = event.get('thread_id')
        if event.get('type') == 'turn.completed':
            completed = True
        if event.get('type') in ('turn.failed', 'error'):
            failed = True
    data = {'kind': 'delegated', 'thread': thread, 'exit': child.returncode,
            'completed': completed and not failed, 'model': model()}
    write(data)
    # Child output is delivered to the parent, but is never included in evidence.
    sys.stdout.write(stdout)
    sys.stderr.write(stderr)
    if not verify():
        print('Delegation verification failed.', file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
