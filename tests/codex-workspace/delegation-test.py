#!/usr/bin/env python3
import json
import os
from pathlib import Path
import subprocess
import signal
import time
import tempfile
import unittest

HELPER = Path(__file__).resolve().parents[2] / 'docker/codex-workspace/task-board/delegate.py'
THREAD = '11111111-1111-4111-8111-111111111111'

class Contract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        (root / 'bin').mkdir()
        (root / 'home/sessions').mkdir(parents=True)
        self.env = dict(os.environ, PATH=str(root / 'bin') + ':' + os.environ['PATH'],
                        CODEX_HOME=str(root / 'home'), TASK_BOARD_DELEGATION_EVIDENCE=str(root / 'evidence.json'))
        self.env.pop('CODEX_TASK_BOARD_MODEL', None)
        self.fake = root / 'bin/codex'
        self.fake.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
assert not os.environ.get("OPENAI_API_KEY")
model = sys.argv[sys.argv.index("--model") + 1]
id = "11111111-1111-4111-8111-111111111111"
path = pathlib.Path(os.environ["CODEX_HOME"]) / "sessions" / ("rollout-" + id + ".jsonl")
path.write_text(json.dumps({"type":"session_meta", "payload":{"id":id}})+"\\n"+json.dumps({"type":"turn_context", "payload":{"model":os.environ.get("ACTUAL_MODEL", model)}})+"\\n"+json.dumps({"type":"event_msg", "payload":{"type":"task_complete"}})+"\\n")
print(json.dumps({"type":"thread.started", "thread_id":id}))
if os.environ.get("COMPLETE", "yes") == "yes": print(json.dumps({"type":"turn.completed"}))
sys.exit(int(os.environ.get("CHILD_EXIT", "0")))
''')
        self.fake.chmod(0o755)
        self.env['OPENAI_API_KEY'] = 'secret'

    def tearDown(self): self.tmp.cleanup()
    def call(self, *args):
        return subprocess.run(['python3', str(HELPER), *args], input='work', text=True, env=self.env, capture_output=True).returncode
    def test_success_and_model_override(self):
        self.env['CODEX_TASK_BOARD_MODEL'] = 'custom-model'
        self.assertEqual(self.call('run'), 0)
        self.assertEqual(self.call('verify'), 0)
        self.env['CODEX_TASK_BOARD_MODEL'] = 'another-model'
        self.assertNotEqual(self.call('verify'), 0)
    def test_failure_modes(self):
        self.assertNotEqual(self.call('verify'), 0)
        for key, value in [('CHILD_EXIT', '1'), ('COMPLETE', 'no'), ('ACTUAL_MODEL', 'wrong')]:
            self.env[key] = value
            self.assertNotEqual(self.call('run'), 0)
            self.assertNotEqual(self.call('verify'), 0)
            self.assertNotEqual(self.call('exempt', 'small-task'), 0)
            self.assertNotEqual(self.call('run'), 0)
            del self.env[key]
            Path(self.env['TASK_BOARD_DELEGATION_EVIDENCE']).unlink()
        self.fake.write_text('#!/bin/sh\nexit 127\n')
        self.assertNotEqual(self.call('run'), 0)
        self.assertNotEqual(self.call('verify'), 0)
    def process_fixture(self):
        self.pid_file = Path(self.tmp.name) / 'pids'
        self.env['TEST_PID_FILE'] = str(self.pid_file)
        self.fake.write_text("""#!/usr/bin/env python3
import os, pathlib, subprocess, sys, time
child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
pathlib.Path(os.environ['TEST_PID_FILE']).write_text(str(os.getpid()) + ' ' + str(child.pid))
time.sleep(60)
""")

    def wait_for_pids(self):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            if self.pid_file.exists():
                return [int(x) for x in self.pid_file.read_text().split()]
            time.sleep(0.02)
        self.fail('child and grandchild did not start')

    def assert_processes_stopped(self, pids):
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            running = []
            for pid in pids:
                try:
                    status = Path(f'/proc/{pid}/status').read_text()
                    if not any(line.startswith('State:') and 'Z' in line.split()[1] for line in status.splitlines()):
                        running.append(pid)
                except FileNotFoundError:
                    pass
            if not running:
                return
            time.sleep(0.02)
        self.fail(f'processes still running: {running}')

    def test_timeout_stops_child_and_grandchild(self):
        self.process_fixture()
        harness = ('import importlib.util, sys; '
                   'spec = importlib.util.spec_from_file_location("delegate", sys.argv[1]); '
                   'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); '
                   'm.DELEGATION_TIMEOUT_SECONDS = 1; sys.argv = [sys.argv[1], "run"]; sys.exit(m.main())')
        proc = subprocess.Popen(['python3', '-c', harness, str(HELPER)], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=self.env)
        try:
            proc.stdin.write('work')
            proc.stdin.close()
            pids = self.wait_for_pids()
            self.assertNotEqual(proc.wait(timeout=5), 0)
            self.assert_processes_stopped(pids)
            self.assertEqual(json.loads(Path(self.env['TASK_BOARD_DELEGATION_EVIDENCE']).read_text())['kind'], 'failed')
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
            proc.stdout.close()
            proc.stderr.close()

    def test_runner_group_shutdown_stops_child_and_grandchild(self):
        self.process_fixture()
        proc = subprocess.Popen(['python3', str(HELPER), 'run'], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                env=self.env, start_new_session=True)
        try:
            proc.stdin.write('work')
            proc.stdin.close()
            pids = self.wait_for_pids()
            os.killpg(proc.pid, signal.SIGTERM)
            self.assertNotEqual(proc.wait(timeout=5), 0)
            self.assert_processes_stopped(pids)
        finally:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
            proc.stdout.close()
            proc.stderr.close()

    def test_exemption(self):
        self.assertNotEqual(self.call('exempt', 'unavailable'), 0)
        self.assertEqual(self.call('exempt', 'small-task'), 0)
        self.assertEqual(self.call('verify'), 0)

if __name__ == '__main__': unittest.main()
