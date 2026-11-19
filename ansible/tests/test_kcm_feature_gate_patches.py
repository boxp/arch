"""BOXP-618: kube-controller-manager feature gates via kubeadm --patches.

Renders roles/kubernetes_upgrade/templates/kube-controller-manager+json.json.j2 and
runs validate_controller_manager_feature_gates.yml on localhost. The gate must
only be added as one extra KCM command element, never be enabled by default,
and be refused for target minors that were not evaluated (KCM 1.36 exits on
the unknown NodeControllerLeaseCircuitBreaker gate).
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ANSIBLE_DIR = Path(__file__).resolve().parents[1]
FIXTURE = ANSIBLE_DIR / 'tests/fixtures/kcm_feature_gates/playbook.yml'


class KcmFeatureGatePatchesTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='kcm-gates-'))
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def run_fixture(self, version, gates=None, minors=None):
        out = self.tmp / 'out.json'
        extra = {'kubernetes_upgrade_version': version, 'fixture_out': str(out)}
        if gates is not None:
            extra['kubernetes_upgrade_controller_manager_feature_gates'] = gates
        if minors is not None:
            extra['kubernetes_upgrade_controller_manager_feature_gates_minors'] = minors
        env = {
            **os.environ,
            'ANSIBLE_GATHERING': 'explicit',
            'ANSIBLE_LOCALHOST_WARNING': 'false',
            'ANSIBLE_INVENTORY_UNPARSED_WARNING': 'false',
            'ANSIBLE_DEPRECATION_WARNINGS': 'false',
        }
        proc = subprocess.run(
            ['ansible-playbook', '-i', 'localhost,', str(FIXTURE), '-e', json.dumps(extra)],
            cwd=ANSIBLE_DIR, env=env, capture_output=True, text=True)
        result = json.loads(out.read_text()) if out.exists() else None
        return proc, result

    def test_default_is_noop(self):
        proc, result = self.run_fixture('1.36.6')
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(result, {'patch': None, 'arg': ''})

    def test_gate_off_for_137_appends_single_command_element(self):
        proc, result = self.run_fixture('1.37.2', {'NodeControllerLeaseCircuitBreaker': False})
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(result['patch'], [{
            'op': 'add',
            'path': '/spec/containers/0/command/-',
            'value': '--feature-gates=NodeControllerLeaseCircuitBreaker=false',
        }])
        self.assertEqual(result['arg'], '--patches=/etc/kubernetes/kubeadm-upgrade-patches')

    def test_multiple_gates_are_sorted_into_one_flag(self):
        proc, result = self.run_fixture('1.37.2', {'ZetaGate': True, 'AlphaGate': False})
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(result['patch'][0]['value'], '--feature-gates=AlphaGate=false,ZetaGate=true')

    def test_gate_refused_for_136_target(self):
        proc, result = self.run_fixture('1.36.6', {'NodeControllerLeaseCircuitBreaker': False})
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn('BOXP-618', proc.stdout)
        self.assertIsNone(result)

    def test_gate_refused_for_unevaluated_138_target(self):
        proc, _ = self.run_fixture('1.38.0', {'NodeControllerLeaseCircuitBreaker': False})
        self.assertNotEqual(proc.returncode, 0)

    def test_non_boolean_value_refused(self):
        proc, _ = self.run_fixture('1.37.2', {'NodeControllerLeaseCircuitBreaker': 'false'})
        self.assertNotEqual(proc.returncode, 0)

    def test_malformed_gate_name_refused(self):
        proc, _ = self.run_fixture('1.37.2', {'Bad,Gate=true,X': False})
        self.assertNotEqual(proc.returncode, 0)


INVENTORY = ANSIBLE_DIR / 'inventories/production/hosts.yml'


class ProductionInventoryKcmFeatureGatesTest(unittest.TestCase):
    """BOXP-191: production enables NodeControllerLeaseCircuitBreaker=false only
    when the upgrade target is 1.37, so 1.36 patch upgrades stay untouched."""

    def resolve(self, host, version):
        env = {**os.environ, 'ANSIBLE_LOCALHOST_WARNING': 'false',
               'ANSIBLE_DEPRECATION_WARNINGS': 'false', 'ANSIBLE_NOCOLOR': 'true'}
        msg = ('{{ (kubernetes_upgrade_controller_manager_feature_gates | default({})) | to_json }}')
        proc = subprocess.run(
            ['ansible', host, '-i', str(INVENTORY), '-m', 'ansible.builtin.debug',
             '-a', json.dumps({'msg': msg}),
             '-e', json.dumps({'kubernetes_upgrade_version': version})],
            cwd=ANSIBLE_DIR, env=env, capture_output=True, text=True)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        # ad-hoc default output: "<host> | SUCCESS => {...}"
        head, sep, body = proc.stdout.partition('=>')
        self.assertTrue(sep and head.strip().startswith(host + ' | SUCCESS'), proc.stdout)
        return json.loads(json.loads(body)['msg'])

    def test_control_planes_disable_gate_only_for_137(self):
        for host in ('shanghai-1', 'shanghai-2', 'shanghai-3'):
            for version in ('1.37.0', '1.37.2', '1.37.10'):
                self.assertEqual(self.resolve(host, version),
                                 {'NodeControllerLeaseCircuitBreaker': False}, (host, version))
            for version in ('1.36.5', '1.36.9', '1.38.0', ''):
                self.assertEqual(self.resolve(host, version), {}, (host, version))

    def test_workers_never_get_gate(self):
        for host in ('golyat-1', 'golyat-4'):
            self.assertEqual(self.resolve(host, '1.37.2'), {})

    def test_resolved_137_value_passes_role_validation_and_renders_patch(self):
        gates = self.resolve('shanghai-1', '1.37.2')
        proc, result = KcmFeatureGatePatchesTest.run_fixture(self, '1.37.2', gates)
        self.assertEqual(proc.returncode, 0, proc.stdout + proc.stderr)
        self.assertEqual(result['patch'][0]['value'],
                         '--feature-gates=NodeControllerLeaseCircuitBreaker=false')

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix='kcm-inv-'))
        self.addCleanup(shutil.rmtree, self.tmp, True)


if __name__ == '__main__':
    unittest.main()
