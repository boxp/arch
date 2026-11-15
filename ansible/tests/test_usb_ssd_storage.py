"""Safety and automatic-apply boundaries for USB SSD storage."""
import subprocess
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
ANSIBLE = ROOT / 'ansible'


class UsbStorageTest(unittest.TestCase):
    def test_vars_and_live_fstab(self):
        v = yaml.safe_load((ANSIBLE / 'vars/usb_ssd_storage.yml').read_text())
        nodes = {'golyat-1': 'f06fd95d-4136-46c2-ab6d-537d2670c5b0',
                 'golyat-3': 'ef52a1bb-f02d-48b4-9e23-2e4c1ac0a1d9'}
        self.assertEqual(v['usb_ssd_storage_nodes'], {k: {'uuid': u} for k, u in nodes.items()})
        self.assertEqual(v['usb_ssd_storage_options'], 'defaults,noatime,nofail,x-systemd.device-timeout=30s')
        for uuid in nodes.values():
            line = f"UUID={uuid} {v['usb_ssd_storage_mount_path']} {v['usb_ssd_storage_fstype']} {v['usb_ssd_storage_options']} {v['usb_ssd_storage_dump']} {v['usb_ssd_storage_passno']}"
            self.assertEqual(line, f'UUID={uuid} /var/lib/longhorn-usb ext4 defaults,noatime,nofail,x-systemd.device-timeout=30s 0 2')

    def test_safety_and_resolver(self):
        play = (ANSIBLE / 'playbooks/usb-ssd-storage.yml').read_text()
        script = (ANSIBLE / 'files/usb-ssd-underlay.sh').read_text()
        self.assertIn('usb_ssd_storage_confirm | default(false) | bool', play)
        self.assertIn('unshare -m --propagation private', script)
        self.assertIn('Underlay is not empty', script)
        for forbidden in ('mkfs', 'wipefs', 'parted', 'sgdisk', 'e2fsck', 'rm -rf', 'state: unmounted', 'state: absent', 'ansible.posix.mount'):
            self.assertNotIn(forbidden, play + script)
        self.assertNotIn('umount', play)
        files = ['ansible/playbooks/usb-ssd-storage.yml', 'ansible/vars/usb_ssd_storage.yml',
                 'ansible/files/usb-ssd-underlay.sh', 'ansible/tests/test_usb_ssd_storage.py']
        for file in files:
            result = subprocess.run(['.github/scripts/ansible-apply-targets.sh', '-'], input=file + '\n', text=True, capture_output=True, cwd=ROOT, check=True)
            self.assertEqual(result.stdout.strip(), '[]', file)
