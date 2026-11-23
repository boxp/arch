"""Check which hosts run the isolated APT preflight for each pre-check scope.

Runs the whole roles/kubernetes_upgrade/tasks/pre_checks.yml over a local
connection with mock apt-get/apt-cache/gpg/kubelet/kubectl; no cluster, APT
repository or sudo access is used. One test runs the real
playbooks/upgrade-k8s.yml with `--tags pre_checks`, exactly as the
Pre-upgrade Validation job does, to cover the play and tag wiring.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ANSIBLE_DIR = Path(__file__).resolve().parents[1]
READY_FIXTURE_DIR = ANSIBLE_DIR / 'tests/fixtures/pre_check_ready'
FIXTURE_DIR = ANSIBLE_DIR / 'tests/fixtures/pre_check_scope'
ALL_HOSTS = {'cp-a', 'cp-b', 'cp-c', 'worker-a'}
CONTROL_PLANES = {'cp-a', 'cp-b', 'cp-c'}
APT_TASK = 'Update isolated APT lists from target repositories'
ETCD_TASK = 'Verify etcd cluster health'
READY_TASK = 'Verify all nodes are Ready'


class PreCheckScopeTest(unittest.TestCase):
    def setUp(self):
        self.state_dir = Path(tempfile.mkdtemp(prefix='pre-check-scope-'))
        self.addCleanup(shutil.rmtree, self.state_dir, True)

    def run_pre_checks(self, target_hosts=None, real_playbook=False, **overrides):
        env = {
            **os.environ,
            'PATH': f"{FIXTURE_DIR}:{READY_FIXTURE_DIR}:{os.environ['PATH']}",
            'PRE_CHECK_MOCK_MODE': 'ready',
            'PRE_CHECK_MOCK_STATE_DIR': str(self.state_dir),
            'ANSIBLE_STDOUT_CALLBACK': 'json',
            'ANSIBLE_LOCALHOST_WARNING': 'false',
            'ANSIBLE_DEPRECATION_WARNINGS': 'false',
        }
        # get_url accepts file:// URLs, so the signing keys need no network access.
        key_file = self.state_dir / 'Release.key'
        key_file.write_text('mock signing key\n')
        key_url = key_file.as_uri()
        extra = {
            'pre_check_fixture_dir': str(READY_FIXTURE_DIR),
            'kubernetes_upgrade_version': '1.37.1',
            'kubernetes_upgrade_package': '1.37.1-1.1',
            'crio_upgrade_version': '1.37.1',
            'crio_upgrade_package': '1.37.1-3.1',
            'kubernetes_upgrade_apt_preflight_temp_root': str(self.state_dir),
            'kubernetes_upgrade_apt_preflight_kubernetes_key_url': key_url,
            'kubernetes_upgrade_apt_preflight_crio_key_url': key_url,
        }
        extra.update(overrides)
        if target_hosts is not None:
            extra['kubernetes_upgrade_pre_check_target_hosts'] = target_hosts
        playbook = ([str(ANSIBLE_DIR / 'playbooks/upgrade-k8s.yml'), '--tags', 'pre_checks']
                    if real_playbook else [str(FIXTURE_DIR / 'playbook.yml')])
        proc = subprocess.run(
            ['ansible-playbook', '-i', str(READY_FIXTURE_DIR / 'inventory.yml'),
             *playbook, '-e', json.dumps(extra)],
            cwd=ANSIBLE_DIR, env=env, capture_output=True, text=True)
        # profile_tasks (ansible.cfg) prints timing after the JSON document; parse only the first object.
        output, _ = json.JSONDecoder().raw_decode(proc.stdout[proc.stdout.index('{'):])
        return proc, [task for play in output['plays'] for task in play['tasks']]

    @staticmethod
    def ran(tasks, name):
        """Hosts on which the named task really executed (not skipped, not failed)."""
        hosts = set()
        for task in tasks:
            if task['task']['name'].endswith(name):
                hosts |= {h for h, r in task['hosts'].items()
                          if not r.get('skipped', False) and not r.get('failed', False)}
        return hosts

    def assert_cluster_wide_gates(self, tasks):
        self.assertEqual(self.ran(tasks, ETCD_TASK), CONTROL_PLANES)
        self.assertEqual(self.ran(tasks, READY_TASK), ALL_HOSTS)

    def test_default_scope_runs_apt_preflight_on_every_host(self):
        proc, tasks = self.run_pre_checks()
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertEqual(self.ran(tasks, APT_TASK), ALL_HOSTS)
        self.assert_cluster_wide_gates(tasks)

    def test_empty_list_is_the_same_as_default(self):
        proc, tasks = self.run_pre_checks([])
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertEqual(self.ran(tasks, APT_TASK), ALL_HOSTS)
        self.assert_cluster_wide_gates(tasks)

    def test_worker_target_keeps_cluster_wide_gates(self):
        proc, tasks = self.run_pre_checks(['worker-a'])
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertEqual(self.ran(tasks, APT_TASK), {'worker-a'})
        self.assert_cluster_wide_gates(tasks)

    def test_control_plane_target_keeps_cluster_wide_gates(self):
        proc, tasks = self.run_pre_checks(['cp-b'])
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertEqual(self.ran(tasks, APT_TASK), {'cp-b'})
        self.assert_cluster_wide_gates(tasks)

    def test_real_upgrade_playbook_scopes_apt_preflight_to_the_target(self):
        # The workflow runs this playbook with --tags pre_checks and no --limit:
        # the role's pre-checks run from the upgrade plays on every host.
        proc, tasks = self.run_pre_checks(['worker-a'], real_playbook=True)
        self.assertEqual(proc.returncode, 0, proc.stdout)
        self.assertEqual(self.ran(tasks, APT_TASK), {'worker-a'})
        self.assert_cluster_wide_gates(tasks)

    def test_target_still_rejects_an_unavailable_revision(self):
        # The mock repository does not carry this CRI-O revision.
        proc, tasks = self.run_pre_checks(['worker-a'], crio_upgrade_package='1.37.1-9.9')
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.ran(tasks, APT_TASK), {'worker-a'})
        self.assertEqual(self.ran(tasks, 'Resolve exact revisions from isolated APT lists'), set())
        self.assertNotIn('worker-a', self.ran(tasks, READY_TASK))

    def test_unknown_target_host_fails_closed(self):
        proc, tasks = self.run_pre_checks(['golyat-9'])
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.ran(tasks, APT_TASK), set())
        self.assertEqual(self.ran(tasks, READY_TASK), set())

    def test_non_list_target_fails_closed(self):
        proc, tasks = self.run_pre_checks('worker-a')
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.ran(tasks, READY_TASK), set())


if __name__ == '__main__':
    unittest.main()
