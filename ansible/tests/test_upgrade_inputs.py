"""Run the workflow's pre-credential input gate without contacting any host."""
import os
from pathlib import Path
import subprocess
import unittest
import yaml

WORKFLOW = Path(__file__).resolve().parents[2] / '.github/workflows/upgrade-k8s.yml'
SCRIPT = yaml.safe_load(WORKFLOW.read_text())['jobs']['pre-check']['steps'][0]['run']
VALID = dict(K8S_VERSION='1.37.1', K8S_PACKAGE='1.37.1-1.1', CRIO_VERSION='1.37.1',
             CRIO_PACKAGE='1.37.1-3.1', EXECUTION_ID='BOXP-191-20261001T000000Z', TARGET_NODE='shanghai-1')


class UpgradeInputTest(unittest.TestCase):
    def gate(self, **values):
        return subprocess.run(['bash', '-c', SCRIPT], env={**os.environ, **VALID, **values},
                              capture_output=True, text=True).returncode

    def test_all_seven_individual_nodes(self):
        for node in ['shanghai-1', 'shanghai-2', 'shanghai-3', 'golyat-1', 'golyat-2', 'golyat-3', 'golyat-4']:
            self.assertEqual(self.gate(TARGET_NODE=node), 0)

    def test_invalid_selection_versions_and_identifiers_fail(self):
        for values in [dict(TARGET_NODE='all'), dict(TARGET_NODE='golyat-5'),
                       dict(K8S_VERSION='1.37'), dict(K8S_PACKAGE='1.36.1-1.1'),
                       dict(CRIO_PACKAGE='1.37.1*'), dict(CRIO_PACKAGE=''),
                       dict(CRIO_VERSION='1.36.1', CRIO_PACKAGE='1.36.1-3.1'),
                       dict(EXECUTION_ID=''), dict(EXECUTION_ID='$(exit 0)'),
                       dict(TARGET_NODE='shanghai-1; exit 0')]:
            with self.subTest(values=values):
                self.assertNotEqual(self.gate(**values), 0)

    def test_different_patch_same_minor_is_valid(self):
        self.assertEqual(self.gate(CRIO_VERSION='1.37.2', CRIO_PACKAGE='1.37.2-3.1'), 0)


if __name__ == '__main__':
    unittest.main()
