"""Safety gates for BOXP-267's Longhorn-only multipath exclusion."""
import importlib.util
from pathlib import Path
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_multipath", ROOT / "files/verify_longhorn_multipath.py")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)
DROPIN = (ROOT / "files/longhorn-multipath.conf").read_text()
DEFAULTS = 'defaults {\n user_friendly_names "yes"\n find_multipaths "on"\n config_dir "/etc/multipath/conf.d"\n}\n'
DISTRO_BLACKLIST = 'blacklist {\n devnode "!^(sd[a-z]|dasd[a-z]|nvme[0-9])"\n device {\n  vendor "SGI"\n  product "Universal Xport"\n }\n}\n'
PROPERTY_EXCEPTION = 'blacklist_exceptions {\n property "(SCSI_IDENT_|ID_WWN)"\n}\n'


class DropInTest(unittest.TestCase):
    def test_dropin_only_excludes_longhorn_tgt_disks(self):
        rules, blocks = VERIFY.parse(DROPIN)
        self.assertEqual([r for r in rules if r[0] == ("blacklist",)], [])
        self.assertEqual(blocks, [{"scope": ("blacklist",), "vendor": "^IET$", "product": "^VIRTUAL-DISK$"}])
        self.assertEqual([r for r in rules if r[1] in ("devnode", "wwid", "property", "protocol")], [])
        self.assertNotIn("blacklist_exceptions", DROPIN)


class EffectiveMultipathConfigTest(unittest.TestCase):
    def test_effective_config_with_distro_defaults_is_accepted(self):
        VERIFY.verify(DEFAULTS + DISTRO_BLACKLIST + DROPIN + PROPERTY_EXCEPTION, require_blacklist=True)

    def test_missing_dropin_is_only_allowed_during_preflight(self):
        VERIFY.verify(DEFAULTS + DISTRO_BLACKLIST + PROPERTY_EXCEPTION)
        with self.assertRaises(ValueError):
            VERIFY.verify(DEFAULTS + DISTRO_BLACKLIST + PROPERTY_EXCEPTION, require_blacklist=True)

    def test_unanchored_or_partial_device_rule_is_rejected(self):
        for vendor, product in (("IET", "VIRTUAL-DISK"), ("^IET$", "^VIRTUAL$"), ("^IET$", None)):
            block = 'blacklist {\n device {\n  vendor "' + vendor + '"\n'
            if product:
                block += '  product "' + product + '"\n'
            block += " }\n}\n"
            with self.subTest(vendor=vendor, product=product), self.assertRaises(ValueError):
                VERIFY.verify(DEFAULTS + block, require_blacklist=True)

    def test_rule_outside_blacklist_does_not_count(self):
        devices = 'devices {\n device {\n  vendor "^IET$"\n  product "^VIRTUAL-DISK$"\n }\n}\n'
        with self.assertRaises(ValueError):
            VERIFY.verify(DEFAULTS + devices, require_blacklist=True)

    def test_exceptions_fail_closed(self):
        for exception in (
            'blacklist_exceptions {\n wwid ".*"\n}\n',
            'blacklist_exceptions {\n device {\n  vendor "IET"\n  product ".*"\n }\n}\n',
        ):
            with self.subTest(exception=exception), self.assertRaises(ValueError):
                VERIFY.verify(DEFAULTS + DROPIN + exception, require_blacklist=True)

    def test_nonstandard_directory_fails_closed(self):
        with self.assertRaises(ValueError):
            VERIFY.verify('defaults {\n config_dir "/custom"\n}\n' + DROPIN, True)

    def test_malformed_config_is_rejected(self):
        for value in ("blacklist {", "}", 'wwid "a" unexpected', "foo bar {\n}"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                VERIFY.verify(value)


class WorkerImageWiringTest(unittest.TestCase):
    def test_worker_image_installs_dropin_and_never_restarts_multipathd(self):
        play = yaml.safe_load((ROOT / "playbooks/worker-image.yml").read_text())[0]
        copy_tasks = [t for t in play["tasks"] if t.get("ansible.builtin.copy", {}).get("dest") == "/etc/multipath/conf.d/90-longhorn.conf"]
        self.assertEqual(len(copy_tasks), 1)
        self.assertIn("longhorn-multipath.conf", copy_tasks[0]["ansible.builtin.copy"]["content"])
        self.assertEqual(copy_tasks[0]["notify"], "Reconfigure multipathd")
        handlers = {h["name"]: h for h in play["handlers"]}
        handler = handlers["Reconfigure multipathd"]
        self.assertNotIn("ansible.builtin.systemd", handler)
        self.assertIn("multipathd reconfigure", handler["ansible.builtin.shell"])
        self.assertIn("No devices found", handler["ansible.builtin.shell"])
        self.assertIn("is_chroot", handler["when"])


if __name__ == "__main__":
    unittest.main()
