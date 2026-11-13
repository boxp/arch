"""Render the worker_kubelet_image_gc role into temporary paths; never touch the host kubelet."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

import yaml


class WorkerKubeletImageGcTest(unittest.TestCase):
    def setUp(self):
        self.root = Path(__file__).resolve().parents[1]
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        shutil.copytree(self.root / 'roles' / 'worker_kubelet_image_gc',
                        self.tmp / 'roles' / 'worker_kubelet_image_gc')
        self.playbook = self.tmp / 'test.yml'
        self.playbook.write_text('''---
- hosts: localhost
  connection: local
  gather_facts: false
  roles:
    - worker_kubelet_image_gc
''')
        cfg = self.tmp / 'ansible.cfg'
        cfg.write_text('[defaults]\n')
        self.env = dict(os.environ, ANSIBLE_ROLES_PATH=str(self.tmp / 'roles'), ANSIBLE_CONFIG=str(cfg))
        self.conf_dir = self.tmp / 'kubelet.conf.d'
        self.dropin = self.tmp / '20-kubelet-config-dir.conf'
        self.base = ['-e', f'worker_kubelet_config_dir={self.conf_dir}',
                     '-e', f'worker_kubelet_config_dir_dropin={self.dropin}',
                     '-e', 'worker_kubelet_image_gc_restart=false']

    def tearDown(self):
        self._tmp.cleanup()

    def run_playbook(self, *args, success=True):
        result = subprocess.run(['ansible-playbook', '-i', 'localhost,', str(self.playbook), *self.base, *args],
                                env=self.env, text=True, capture_output=True)
        out = result.stdout + result.stderr
        if success:
            self.assertEqual(result.returncode, 0, out)
        else:
            self.assertNotEqual(result.returncode, 0, out)
        return result.stdout

    def test_renders_drop_ins_below_longhorn_limit_and_is_idempotent(self):
        self.run_playbook()
        config = yaml.safe_load((self.conf_dir / '50-image-gc.conf').read_text())
        self.assertEqual(config['apiVersion'], 'kubelet.config.k8s.io/v1beta1')
        self.assertEqual(config['kind'], 'KubeletConfiguration')
        self.assertEqual(config['imageGCHighThresholdPercent'], 70)
        self.assertEqual(config['imageGCLowThresholdPercent'], 65)
        self.assertEqual(config['imageMaximumGCAge'], '168h')
        # Longhorn DiskPressure starts at 75% usage (25% minimal available).
        self.assertLess(config['imageGCHighThresholdPercent'], 75)
        unit = self.dropin.read_text()
        self.assertIn('[Service]', unit)
        self.assertIn(f'Environment="KUBELET_CONFIG_ARGS=--config=/etc/kubernetes/kubelet-config.yaml '
                      f'--config-dir={self.conf_dir}"', unit)
        self.assertIn('changed=0', self.run_playbook())

    def test_drop_in_sorts_after_kubeadm_unit(self):
        defaults = yaml.safe_load((self.root / 'roles' / 'worker_kubelet_image_gc' / 'defaults' / 'main.yml').read_text())
        name = Path(defaults['worker_kubelet_config_dir_dropin']).name
        self.assertGreater(name, '10-kubeadm.conf')
        self.assertGreater(name, '10-resolv-conf.conf')

    def test_rejects_unsafe_settings(self):
        for extra in (['-e', 'worker_kubelet_image_gc_high_threshold_percent=80'],
                      ['-e', 'worker_kubelet_image_gc_low_threshold_percent=70'],
                      ['-e', 'worker_kubelet_image_maximum_gc_age=0h'],
                      ['-e', 'worker_kubelet_image_maximum_gc_age=forever']):
            with self.subTest(extra=extra):
                out = self.run_playbook(*extra, success=False)
                self.assertIn('kubelet image GC must satisfy', out)
                self.assertFalse((self.conf_dir / '50-image-gc.conf').exists())

    def test_check_mode_and_disabled_write_nothing(self):
        self.run_playbook('--check')
        self.assertFalse(self.dropin.exists())
        self.run_playbook('-e', 'worker_kubelet_image_gc_enabled=false')
        self.assertFalse(self.dropin.exists())
        self.assertFalse(self.conf_dir.exists())

    def test_worker_playbook_uses_role(self):
        playbook = yaml.safe_load((self.root / 'playbooks' / 'worker-image.yml').read_text())
        roles = [r['role'] if isinstance(r, dict) else r for r in playbook[0]['roles']]
        self.assertIn('worker_kubelet_image_gc', roles)
        self.assertGreater(roles.index('worker_kubelet_image_gc'), roles.index('kubernetes_components'))


if __name__ == '__main__':
    unittest.main()
