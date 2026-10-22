"""Safety gates for BOXP-267's Longhorn-only multipath exclusion."""
import importlib.util
import unittest
from pathlib import Path

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
        # The distro property exception is mandatory for multipath to consider any
        # path at all and cannot override a device blacklist (only same-class
        # exceptions can; see verify() docstring), so it must stay accepted.
        VERIFY.verify(DEFAULTS + DISTRO_BLACKLIST + DROPIN + PROPERTY_EXCEPTION, require_blacklist=True)

    def test_only_same_class_exception_can_defeat_device_blacklist(self):
        VERIFY.verify(DEFAULTS + DROPIN + 'blacklist_exceptions {\n devnode "^sd[a-z]"\n}\n', require_blacklist=True)
        with self.assertRaises(ValueError):
            VERIFY.verify(DEFAULTS + DROPIN + 'blacklist_exceptions {\n device {\n  vendor "^IET$"\n  product "^VIRTUAL-DISK$"\n }\n}\n', require_blacklist=True)

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
            'blacklist_exceptions {\n device {\n  vendor "^I.*$"\n  product "^VIRTUAL-DISK$"\n }\n}\n',
            'blacklist_exceptions {\n device {\n  vendor ".*"\n  product ".*"\n }\n}\n',
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
    DROPIN_PATH = "/etc/multipath/conf.d/90-longhorn.conf"

    def setUp(self):
        self.play = yaml.safe_load((ROOT / "playbooks/worker-image.yml").read_text())[0]
        blocks = [t for t in self.play["tasks"] if "block" in t and "multipath" in t.get("tags", [])]
        self.assertEqual(len(blocks), 1)
        self.block = blocks[0]

    @staticmethod
    def _verify_tasks(tasks, require_blacklist):
        found = []
        for task in tasks:
            argv = task.get("ansible.builtin.command", {})
            argv = argv.get("argv", []) if isinstance(argv, dict) else []
            if any("verify_longhorn_multipath.py" in a for a in argv) and (("--require-blacklist" in argv) == require_blacklist):
                found.append(task)
        return found

    def test_worker_image_installs_dropin_and_never_restarts_multipathd(self):
        # The drop-in copy lives only inside the validated block, never as a bare task.
        self.assertEqual([t for t in self.play["tasks"] if t.get("ansible.builtin.copy", {}).get("dest") == self.DROPIN_PATH], [])
        copy_tasks = [t for t in self.block["block"] if t.get("ansible.builtin.copy", {}).get("dest") == self.DROPIN_PATH]
        self.assertEqual(len(copy_tasks), 1)
        self.assertIn("longhorn-multipath.conf", copy_tasks[0]["ansible.builtin.copy"]["content"])
        self.assertEqual(copy_tasks[0]["notify"], "Reconfigure multipathd")
        handlers = {h["name"]: h for h in self.play["handlers"]}
        handler = handlers["Reconfigure multipathd"]
        self.assertNotIn("ansible.builtin.systemd", handler)
        self.assertIn("multipathd reconfigure", handler["ansible.builtin.shell"])
        self.assertIn("No devices found", handler["ansible.builtin.shell"])
        self.assertIn("is_chroot", handler["when"])

    def test_worker_image_validates_candidate_fail_closed_before_handler(self):
        # Preflight (before copy): existing configuration must not be able to defeat
        # the device blacklist; runs read-only in check mode too and is fail closed.
        preflight = self._verify_tasks(self.play["tasks"], require_blacklist=False)
        self.assertEqual(len(preflight), 1)
        self.assertNotIn("failed_when", preflight[0])
        self.assertIs(preflight[0]["check_mode"], False)
        parses = [t for t in self.play["tasks"] if t.get("ansible.builtin.command") == "multipath -t"]
        self.assertEqual(len(parses), 1)
        self.assertEqual(parses[0]["register"], "longhorn_multipath_preflight")
        # Candidate (after copy, before any reload): the complete configuration must
        # contain the effective Longhorn blacklist; no failed_when: false escape hatch.
        tasks = self.block["block"]
        candidate_parse = [t for t in tasks if t.get("ansible.builtin.command") == "multipath -t"]
        self.assertEqual(len(candidate_parse), 1)
        self.assertEqual(candidate_parse[0]["register"], "longhorn_multipath_candidate")
        candidate = self._verify_tasks(tasks, require_blacklist=True)
        self.assertEqual(len(candidate), 1)
        self.assertNotIn("failed_when", candidate[0])
        self.assertNotIn("notify", candidate[0])
        self.assertEqual(candidate[0]["ansible.builtin.command"]["stdin"], "{{ longhorn_multipath_candidate.stdout }}")
        self.assertIn("not ansible_check_mode", candidate[0]["when"])
        copy_index = next(i for i, t in enumerate(tasks) if "ansible.builtin.copy" in t)
        self.assertLess(copy_index, tasks.index(candidate_parse[0]))
        self.assertLess(tasks.index(candidate_parse[0]), tasks.index(candidate[0]))

    def test_worker_image_rolls_back_dropin_when_candidate_validation_fails(self):
        rescue = self.block["rescue"]
        restores = [t for t in rescue if t.get("ansible.builtin.copy", {}).get("dest") == self.DROPIN_PATH]
        removes = [t for t in rescue if t.get("ansible.builtin.file", {}).get("state") == "absent"]
        self.assertEqual(len(restores), 1)
        self.assertEqual(restores[0]["when"], "longhorn_multipath_previous.stat.exists")
        self.assertEqual(len(removes), 1)
        self.assertEqual(removes[0]["ansible.builtin.file"]["path"], self.DROPIN_PATH)
        self.assertEqual(removes[0]["when"], "not longhorn_multipath_previous.stat.exists")
        self.assertIn("ansible.builtin.fail", rescue[-1])
        self.assertEqual([t for t in rescue if "notify" in t], [])
        self.assertNotIn("multipathd reconfigure", yaml.safe_dump(self.block))
        stats = [t for t in self.play["tasks"] if t.get("ansible.builtin.stat", {}).get("path") == self.DROPIN_PATH]
        self.assertEqual(len(stats), 1)
        self.assertEqual(stats[0]["register"], "longhorn_multipath_previous")
        self.assertLess(self.play["tasks"].index(stats[0]), self.play["tasks"].index(self.block))

    def test_worker_image_resyncs_running_daemon_when_dropin_already_present(self):
        play = self.play
        checks = [t for t in play["tasks"] if t.get("register") == "longhorn_multipath_running_check"]
        self.assertEqual(len(checks), 1)
        check = checks[0]
        self.assertEqual(check["notify"], "Reconfigure multipathd")
        self.assertIs(check["failed_when"], False)
        self.assertIn("rc != 0", check["changed_when"])
        self.assertIn("--require-blacklist", check["ansible.builtin.command"]["argv"])
        self.assertTrue(any("is_chroot" in w for w in check["when"]))
        reads = [t for t in play["tasks"] if t.get("register") == "longhorn_multipath_running_config"]
        self.assertEqual(len(reads), 1)
        self.assertIn("multipathd show config", reads[0]["ansible.builtin.shell"])
        self.assertIn("is-active", reads[0]["ansible.builtin.shell"])


class LimitedApplyPlaybookTest(unittest.TestCase):
    """Both mutation phases of longhorn-multipath.yml must roll the drop-in back on failure."""

    def setUp(self):
        self.play = yaml.safe_load((ROOT / "playbooks/longhorn-multipath.yml").read_text())[0]
        self.blocks = [t for t in self.play["tasks"] if "block" in t]

    @staticmethod
    def _commands(tasks):
        return [t.get("ansible.builtin.command") for t in tasks if isinstance(t.get("ansible.builtin.command"), str)]

    def test_candidate_and_daemon_phases_restore_previous_dropin(self):
        self.assertEqual(len(self.blocks), 2)
        for block in self.blocks:
            with self.subTest(block=block["name"]):
                self.assertIn("rescue", block)
                self.assertEqual(block["when"], "not ansible_check_mode")
                rescue = block["rescue"]
                restores = [t for t in rescue if t.get("ansible.builtin.copy", {}).get("dest") == "{{ longhorn_multipath_dropin }}"]
                removes = [t for t in rescue if t.get("ansible.builtin.file", {}).get("state") == "absent"]
                self.assertEqual(len(restores), 1)
                self.assertEqual(len(removes), 1)
                self.assertEqual(rescue[-1].keys() & {"ansible.builtin.fail"}, {"ansible.builtin.fail"})

    def test_daemon_phase_reloads_restored_config_only_after_reconfigure_ran(self):
        daemon = self.blocks[1]
        self.assertIn("multipathd reconfigure", self._commands(daemon["block"]))
        self.assertIn("multipathd show config", self._commands(daemon["block"]))
        rollback = [t for t in daemon["rescue"] if t.get("ansible.builtin.command") == "multipathd reconfigure"]
        self.assertEqual(len(rollback), 1)
        self.assertIs(rollback[0]["failed_when"], False)
        self.assertIn("longhorn_multipath_reconfigure is defined", rollback[0]["when"])
        self.assertIn("is not skipped", rollback[0]["when"])

    def test_playbook_never_stops_restarts_or_flushes(self):
        text = (ROOT / "playbooks/longhorn-multipath.yml").read_text()
        for forbidden in ("ansible.builtin.systemd", "systemctl restart", "systemctl stop", "multipath -f", "multipath -F", "dmsetup remove"):
            self.assertNotIn(forbidden, text)


if __name__ == "__main__":
    unittest.main()
