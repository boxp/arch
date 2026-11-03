"""Render the worker image's actual APT argument without contacting a host."""
from pathlib import Path
import unittest

from ansible.parsing.dataloader import DataLoader
from ansible.template import Templar, trust_as_template

PLAYBOOK = Path(__file__).resolve().parents[1] / 'playbooks/worker-image.yml'


class WorkerImagePackagesTest(unittest.TestCase):
    def test_generic_kernel_package_names(self):
        loader = DataLoader()
        play = loader.load_from_file(str(PLAYBOOK))[0]
        task = next(task for task in play['pre_tasks']
                    if task['name'] == 'Install extra modules for installed generic kernels')
        for kernels in [[], ['6.8.0-71-generic'], ['6.8.0-71-generic', '6.8.0-72-generic']]:
            with self.subTest(kernels=kernels):
                templar = Templar(loader=loader, variables={
                    'worker_generic_kernel_modules': {
                        'files': [{'path': f'/lib/modules/{kernel}'} for kernel in kernels]
                    }
                })
                self.assertEqual(
                    templar.template(trust_as_template(task['ansible.builtin.apt']['name'])),
                    [f'linux-modules-extra-{kernel}' for kernel in kernels],
                )


if __name__ == '__main__':
    unittest.main()
