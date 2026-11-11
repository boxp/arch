"""Exercise the role against temporary files, never the host's modprobe or sysfs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class I915TimeoutTest(unittest.TestCase):
    def test_live_and_persistent_configuration(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            role = tmp / 'roles' / 'gpu_worker_host_tools'
            shutil.copytree(root / 'roles' / 'gpu_worker_host_tools', role)
            config = tmp / 'i915.conf'
            sysfs = tmp / 'request_timeout_ms'
            tasks = role / 'tasks' / 'main.yml'
            tasks.write_text(tasks.read_text().replace('/etc/modprobe.d/i915-request-timeout.conf', str(config)).replace('/sys/module/i915/parameters/request_timeout_ms', str(sysfs)))
            handler = role / 'handlers' / 'main.yml'
            handler.write_text(handler.read_text().replace('update-initramfs -u', '/bin/true'))
            playbook = tmp / 'test.yml'
            playbook.write_text('''---
- hosts: localhost
  connection: local
  gather_facts: false
  roles:
    - gpu_worker_host_tools
''')
            cfg = tmp / 'ansible.cfg'
            cfg.write_text('[defaults]\n')
            env = dict(os.environ, ANSIBLE_ROLES_PATH=str(tmp / 'roles'), ANSIBLE_CONFIG=str(cfg))

            def run(*args):
                result = subprocess.run(['ansible-playbook', '-i', 'localhost,', str(playbook), *args], env=env, text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result.stdout

            run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true', '--check')
            self.assertFalse(config.exists())
            run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true')
            self.assertEqual(config.read_text(), 'options i915 request_timeout_ms=600000\n')
            sysfs.write_text('20000\n')
            run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true', '--check')
            self.assertEqual(sysfs.read_text(), '20000\n')
            run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true')
            self.assertEqual(sysfs.read_text(), '600000\n')
            output = run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true')
            self.assertIn('changed=0', output)
            sysfs.write_text('20000\n')
            run()
            self.assertEqual(sysfs.read_text(), '20000\n')
            run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true', '-e', 'is_chroot=true')
            self.assertEqual(sysfs.read_text(), '20000\n')


if __name__ == '__main__':
    unittest.main()
