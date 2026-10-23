"""Exercise the bounded readiness retry and VIP targeting of the pre-check task.

Runs only "Verify all nodes are Ready" from roles/kubernetes_upgrade/tasks/pre_checks.yml
against a mock kubectl over a local connection; no cluster, APT or sudo access is used.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ANSIBLE_DIR = Path(__file__).resolve().parents[1]
FIXTURE_DIR = ANSIBLE_DIR / 'tests/fixtures/pre_check_ready'
TASK_NAME = 'Verify all nodes are Ready'


class PreCheckReadyRetryTest(unittest.TestCase):
    def setUp(self):
        self.state_dir = Path(tempfile.mkdtemp(prefix='pre-check-mock-'))
        self.addCleanup(shutil.rmtree, self.state_dir, True)

    def run_pre_check(self, mode, hosts='cp-a', node_role='control_plane', refusals=2):
        env = {
            **os.environ,
            'PATH': f"{FIXTURE_DIR}:{os.environ['PATH']}",
            'PRE_CHECK_MOCK_MODE': mode,
            'PRE_CHECK_MOCK_REFUSALS': str(refusals),
            'PRE_CHECK_MOCK_STATE_DIR': str(self.state_dir),
            'ANSIBLE_STDOUT_CALLBACK': 'json',
            'ANSIBLE_GATHERING': 'explicit',
            'ANSIBLE_LOCALHOST_WARNING': 'false',
            'ANSIBLE_DEPRECATION_WARNINGS': 'false',
        }
        proc = subprocess.run(
            ['ansible-playbook', '-i', str(FIXTURE_DIR / 'inventory.yml'),
             str(FIXTURE_DIR / 'playbook.yml'),
             '--start-at-task', TASK_NAME,
             '-e', f'pre_check_fixture_dir={FIXTURE_DIR}',
             '-e', f'pre_check_fixture_hosts={hosts}',
             '-e', f'pre_check_fixture_node_role={node_role}'],
            cwd=ANSIBLE_DIR, env=env, capture_output=True, text=True)
        # profile_tasks (ansible.cfg) prints timing after the JSON document; parse only the first object.
        output, _ = json.JSONDecoder().raw_decode(proc.stdout[proc.stdout.index('{'):])
        tasks = [t for t in output['plays'][0]['tasks'] if t['task']['name'].endswith(TASK_NAME)]
        self.assertEqual(len(tasks), 1, proc.stdout)
        return proc.returncode, tasks[0]['hosts'][hosts]

    def calls(self):
        log = self.state_dir / 'calls.log'
        return log.read_text().splitlines() if log.exists() else []

    def test_control_plane_success_uses_its_direct_endpoint(self):
        rc, result = self.run_pre_check('ready')
        self.assertEqual(rc, 0)
        self.assertFalse(result.get('failed', False))
        self.assertEqual(len(self.calls()), 1)
        self.assertIn('--server=https://10.0.0.2:6443', self.calls()[0])

    def test_worker_targets_cluster_vip_via_second_control_plane(self):
        rc, result = self.run_pre_check('ready', hosts='worker-a', node_role='worker')
        self.assertEqual(rc, 0)
        self.assertFalse(result.get('failed', False))
        self.assertEqual(len(self.calls()), 1)
        self.assertIn('--server=https://10.0.0.99:6443', self.calls()[0])
        self.assertNotIn('10.0.0.3', self.calls()[0])

    def test_short_connection_refused_recovers_within_retries(self):
        rc, result = self.run_pre_check('refused_then_ready', hosts='worker-a', node_role='worker', refusals=2)
        self.assertEqual(rc, 0, result)
        self.assertFalse(result.get('failed', False))
        self.assertEqual(result['attempts'], 3)
        self.assertEqual(len(self.calls()), 3)

    def test_persistent_api_failure_fails_after_bounded_retries(self):
        rc, result = self.run_pre_check('refused_always')
        self.assertNotEqual(rc, 0)
        self.assertTrue(result['failed'])
        self.assertEqual(result['attempts'], 3)
        # Ansible runs the first attempt plus `retries` retries, then stops.
        self.assertEqual(len(self.calls()), 4)

    def test_persistent_not_ready_node_fails_after_bounded_retries(self):
        rc, result = self.run_pre_check('not_ready', hosts='worker-a', node_role='worker')
        self.assertNotEqual(rc, 0)
        self.assertTrue(result['failed'])
        self.assertEqual(result['attempts'], 3)
        self.assertEqual(len(self.calls()), 4)
        self.assertIn('NotReady', result['stdout'])


if __name__ == '__main__':
    unittest.main()
