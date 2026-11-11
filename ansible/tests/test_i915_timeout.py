"""Exercise the role against temporary files, never the host's modprobe or sysfs."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


class I915TimeoutTest(unittest.TestCase):
    def test_persistent_configuration(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            role = tmp / 'roles' / 'gpu_worker_host_tools'
            shutil.copytree(root / 'roles' / 'gpu_worker_host_tools', role)
            config = tmp / 'i915.conf'
            tasks = role / 'tasks' / 'main.yml'
            task_text = tasks.read_text()
            self.assertNotIn('/sys/module/i915', task_text)
            self.assertNotIn('/sys/kernel/debug', task_text)
            tasks.write_text(task_text.replace('/etc/modprobe.d/i915-request-timeout.conf', str(config)))
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

            def run(*args, success=True):
                result = subprocess.run(['ansible-playbook', '-i', 'localhost,', str(playbook), *args], env=env, text=True, capture_output=True)
                if success:
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertIn('i915 request timeout must be an integer of at least 20000 ms', result.stdout)
                return result.stdout

            run()
            self.assertFalse(config.exists())
            run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true', '--check')
            self.assertFalse(config.exists())
            for value in ('19999', 'not-a-number'):
                with self.subTest(value=value):
                    run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true',
                        '-e', f'gpu_worker_host_tools_i915_request_timeout_ms={value}', success=False)
                    self.assertFalse(config.exists())
            run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true')
            self.assertEqual(config.read_text(), 'options i915 request_timeout_ms=600000\n')
            output = run('-e', 'gpu_worker_host_tools_i915_timeout_enabled=true')
            self.assertIn('changed=0', output)


if __name__ == '__main__':
    unittest.main()
