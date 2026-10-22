"""Safety gates for BOXP-267's exact, node-local exclusion."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("verify_multipath", ROOT / "files/verify_longhorn_multipath.py")
VERIFY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFY)
DROPIN = (ROOT / "files/longhorn-codex-workspace.conf").read_text()


class EffectiveMultipathConfigTest(unittest.TestCase):
    def test_narrow_blacklist_and_unrelated_rules_are_preserved(self):
        config = 'defaults {\n find_multipaths "on"\n}\n' + DROPIN
        config += 'blacklist_exceptions {\n property "(SCSI_IDENT_|ID_WWN)"\n}\n'
        VERIFY.verify(config, require_blacklist=True)
        self.assertEqual(DROPIN.count('wwid "'), 1)
        self.assertIn('"^360000000000000000e00000000010001$"', DROPIN)

    def test_wrong_wwid_or_unanchored_regex_is_rejected(self):
        for value in (VERIFY.WWID, "^360000000000000000e00000000020001$", "^360.*$"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                VERIFY.verify('blacklist {\n wwid "' + value + '"\n}', True)

    def test_wwid_exception_fails_closed(self):
        for value in (VERIFY.WWID, ".*", "unrelated-wwid"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                VERIFY.verify(DROPIN + '\nblacklist_exceptions {\n wwid "' + value + '"\n}', True)

    def test_nonstandard_directory_fails_closed(self):
        with self.assertRaises(ValueError):
            VERIFY.verify('defaults {\n config_dir "/custom"\n}\n' + DROPIN, True)

    def test_missing_dropin_is_only_allowed_during_preflight(self):
        VERIFY.verify('defaults {\n config_dir "/etc/multipath/conf.d"\n}')
        with self.assertRaises(ValueError):
            VERIFY.verify('defaults {\n config_dir "/etc/multipath/conf.d"\n}', True)

    def test_malformed_config_is_rejected(self):
        for value in ('blacklist {', '}', 'wwid "a" unexpected', 'foo bar {\n}'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                VERIFY.verify(value)


if __name__ == "__main__":
    unittest.main()
