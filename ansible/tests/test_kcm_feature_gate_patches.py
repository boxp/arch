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


if __name__ == '__main__':
    unittest.main()
