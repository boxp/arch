#!/usr/bin/env python3
"""Black-box sanctioned repair fixtures; no production vault access."""
import fcntl
import shutil
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

HELPER = Path(__file__).resolve().parents[2] / 'docker/hermes-agent/skills/obsidian-task-board/bin/task-board.bb'
RUN = '20261105T135333Z-c1642584-907a-4d56-b559-cbdb87873658'
DONE = '- [x] [[Tickets/BOXP-433|BOXP-433: title]] #ticket status::done priority::high assignee::boxp repo::boxp/lolice rev::test-rev done::2026-11-05'
STALE = '- [ ] [[Tickets/BOXP-433|BOXP-433: title]] #ticket status::in-progress priority::high assignee::claude-opus repo::boxp/lolice rev::test-rev'
FOREIGN = '- [ ] [[Tickets/BOXP-432|BOXP-432: title]] #ticket status::in-progress priority::high assignee::claude-opus'


def exchange_supported():
    with tempfile.TemporaryDirectory() as d:
        a, b = Path(d, 'a'), Path(d, 'b')
        a.write_text('a')
        b.write_text('b')
        p = subprocess.run(['mv', '--exchange', '--no-target-directory', '--', str(a), str(b)], capture_output=True)
        return p.returncode == 0 and a.read_text() == 'b'


EXCHANGE = exchange_supported()


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


@unittest.skipIf(os.getuid() == 0, 'run fixtures as a non-root user')
class RepairTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.vault = self.base / 'vault'
        self.root = self.base / 'source'
        self.writer = self.base / 'writer'
        for p in (self.vault / 'Boards', self.vault / 'Tickets', self.root / 'lock-guards',
                  self.root / 'runs/BOXP-433' / RUN, self.root / 'locks', self.writer):
            p.mkdir(parents=True)
        (self.root / 'lock-guards/BOXP-433.lock').touch()
        (self.writer / 'vault-writer.lock').touch()
        self.summary = self.root / 'runs/BOXP-433' / RUN / 'summary.edn'
        self.summary.write_text('{:ticket "BOXP-433" :run-id "' + RUN + '" :status :succeeded :result "done" :finished-at "2026-11-05T14:29:00Z"}\n')
        self.ticket = self.vault / 'Tickets/BOXP-433.md'
        self.ticket.write_text('---\nid: BOXP-433\nstatus: done\nassignee: boxp\npriority: high\nrepo: boxp/lolice\nboard_rev: test-rev\nclosed: 2026-11-05\n---\n\n# BOXP-433: title\n\n## Notes\n\n履歴保持\n')
        self.board = self.vault / 'Boards/Task Board.md'
        self.before = '---\nkanban-plugin: board\n---\n\n## In Progress\n\n' + STALE + '\n' + FOREIGN + '\n\n## Done\n\n' + DONE + '\n\n## Notes\n\n' + STALE + '\n\n'
        self.board.write_text(self.before)
        self.env = dict(os.environ, TASK_BOARD_VAULT_WRITER_LOCK_DIR=str(self.writer),
                        CODEX_TASK_BOARD_RECONCILE_SETTLE_MS='0',
                        CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS='5000')
        self.cmd = ['bb', str(HELPER), 'reconcile-done', 'BOXP-433', '--vault', str(self.vault), '--source-root', str(self.root), '--json']

    def call(self, *args, ok=True):
        p = subprocess.run(self.cmd + list(args), env=self.env, capture_output=True, text=True, timeout=10)
        if ok:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        self.assertNotEqual(p.returncode, 0, p.stdout)
        return p.stderr

    def plan(self):
        return self.call('--dry-run')

    def args(self, plan):
        args = ['--confirm']
        for k in ('rev', 'ticket-sha256', 'board-sha256', 'after-board-sha256', 'source-sha256', 'helper-sha256'):
            args += ['--expected-' + k, plan[k]]
        return args

    def unchanged(self):
        self.assertEqual(self.board.read_text(), self.before)

    def test_exact_apply_and_retry(self):
        original_ticket = self.ticket.read_bytes()
        plan = self.plan()
        self.unchanged()
        self.assertFalse((self.vault / '.task-board-locks').exists())
        self.assertFalse((self.vault / '.task-board-repair-audit.edn').exists())
        self.assertEqual(len(plan['candidates']), 2)
        self.assertEqual(len(plan['removed']), 1)
        result = self.call(*self.args(plan))
        self.assertEqual(result['writer-lock'], 'shared')
        backup = Path(result['backup-path'])
        self.assertEqual(backup.read_text(), self.before)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.board.read_text(), self.before.replace(STALE + '\n', '', 1))
        self.assertEqual(self.ticket.read_bytes(), original_ticket)
        self.assertEqual(digest(self.board), plan['after-board-sha256'])
        audit = (self.vault / '.task-board-repair-audit.edn').read_bytes()
        self.assertTrue(self.call(*self.args(plan))['noop'])
        self.assertEqual((self.vault / '.task-board-repair-audit.edn').read_bytes(), audit)

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_without_shared_lock_and_readback_conflict(self):
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        plan = self.plan()
        result = self.call(*self.args(plan))
        self.assertEqual(result['writer-lock'], 'none')
        self.assertEqual(Path(result['backup-path']).read_text(), self.before)
        self.assertTrue(self.call(*self.args(plan))['noop'])
        self.board.write_text(self.before)
        plan = self.plan()
        self.env['CODEX_TASK_BOARD_TEST_RECONCILE_READBACK_MISMATCH'] = 'true'
        self.assertIn('post-apply readback mismatch; backup at', self.call(*self.args(plan), ok=False))
        self.assertIn(':phase :conflict', (self.vault / '.task-board-repair-audit.edn').read_text())
        self.assertTrue(list((self.root / 'repair-backups').glob('*-board.md')))

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_write_between_check_and_replace_is_restored(self):
        # P0: a writer that lands after the final comparison must not be lost.
        for shared in (False, True):
            with self.subTest(shared=shared):
                if not shared:
                    self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR', None)
                else:
                    self.env['TASK_BOARD_VAULT_WRITER_LOCK_DIR'] = str(self.writer)
                self.board.write_text(self.before)
                plan = self.plan()
                self.env['CODEX_TASK_BOARD_TEST_RECONCILE_CONCURRENT_WRITE'] = 'true'
                try:
                    err = self.call(*self.args(plan), ok=False)
                finally:
                    self.env.pop('CODEX_TASK_BOARD_TEST_RECONCILE_CONCURRENT_WRITE')
                self.assertIn('board changed concurrently; concurrent content restored', err)
                self.assertEqual(self.board.read_text(), self.before + 'concurrent writer\n')
                self.assertIn(':reason "board changed concurrently', (self.vault / '.task-board-repair-audit.edn').read_text())
                self.assertTrue(list((self.root / 'repair-backups').glob('BOXP-433-*-displaced.md')))
                self.assertFalse(list((self.vault / 'Boards').glob('.reconcile-433-*')))

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_late_write_to_displaced_inode_is_restored_immediately(self):
        # P0: a writer holding the old Board inode open writes after the settle
        # delay. The command itself must detect it, put that inode back as the
        # live Board and fail; no success while the update sits only in a retained file.
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        plan = self.plan()
        self.env['CODEX_TASK_BOARD_TEST_RECONCILE_LATE_WRITE'] = 'true'
        try:
            err = self.call(*self.args(plan), ok=False)
        finally:
            self.env.pop('CODEX_TASK_BOARD_TEST_RECONCILE_LATE_WRITE')
        self.assertIn('late write to displaced board; writer content restored', err)
        self.assertEqual(self.board.read_text(), self.before + 'late writer\n')
        self.assertTrue(list((self.root / 'repair-backups').glob('BOXP-433-*-late-displaced.md')))
        retained = list((self.vault / '.task-board-repair-retained').glob('BOXP-433-*-displaced.md'))
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].read_text(), self.before.replace(STALE + '\n', '', 1))
        self.assertFalse(list((self.vault / 'Boards').glob('.reconcile-433-*')))
        self.assertIn(':phase :conflict', (self.vault / '.task-board-repair-audit.edn').read_text())
        # Retained inode is unchanged since, so later runs see the restored board as a fresh conflict.
        self.assertEqual(self.plan()['retained-checked'], 1)

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_write_during_restore_exchange_is_preserved_and_reported(self):
        # P1: a writer that updates the Board between the pre-restore read and
        # the restoring exchange must not vanish: its content is preserved and
        # named in the conflict, and the late-writer inode stays live.
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        plan = self.plan()
        after = self.before.replace(STALE + '\n', '', 1)
        self.env['CODEX_TASK_BOARD_TEST_RECONCILE_LATE_WRITE'] = 'true'
        self.env['CODEX_TASK_BOARD_TEST_RECONCILE_RESTORE_RACE'] = 'true'
        try:
            err = self.call(*self.args(plan), ok=False)
        finally:
            self.env.pop('CODEX_TASK_BOARD_TEST_RECONCILE_LATE_WRITE')
            self.env.pop('CODEX_TASK_BOARD_TEST_RECONCILE_RESTORE_RACE')
        self.assertIn('board also changed during restore', err)
        self.assertEqual(self.board.read_text(), self.before + 'late writer\n')
        raced = list((self.root / 'repair-backups').glob('BOXP-433-*-restore-raced.md'))
        self.assertEqual(len(raced), 1)
        self.assertEqual(raced[0].read_text(), after + 'racing writer\n')
        self.assertIn(str(raced[0]), err)
        self.assertIn('restore-raced', (self.vault / '.task-board-repair-audit.edn').read_text())

    def test_helper_is_executable(self):
        # P1: SKILL.md checks -x and existing callers execute the helper directly.
        self.assertTrue(os.access(HELPER, os.X_OK))

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_open_descriptor_on_displaced_board_restores_original(self):
        # P0: a writer that still has the old Board open after the wait could
        # write later; the command must restore that inode as the Board and fail.
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        plan = self.plan()
        holder = subprocess.Popen(['sh', '-c', 'exec 3<>"$1"; sleep 30', 'sh', str(self.board)])
        self.addCleanup(holder.wait)
        self.addCleanup(holder.kill)
        for _ in range(100):
            if any(os.path.realpath(f'/proc/{holder.pid}/fd/{fd}') == str(self.board)
                   for fd in os.listdir(f'/proc/{holder.pid}/fd')):
                break
            subprocess.run(['sleep', '0.05'])
        self.env['CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS'] = '300'
        err = self.call(*self.args(plan), ok=False)
        self.assertIn('displaced board still open by pid', err)
        self.assertIn(str(holder.pid), err)
        self.assertEqual(self.board.read_text(), self.before)
        # The holder's descriptor points at the live Board again: its write is not lost.
        with open(f'/proc/{holder.pid}/fd/3', 'a') as f:
            f.write('held writer\n')
        self.assertEqual(self.board.read_text(), self.before + 'held writer\n')
        holder.kill()
        holder.wait()
        self.env.pop('CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS')
        self.assertEqual(self.plan()['retained-checked'], 1)

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_non_dumpable_writer_is_detected(self):
        # P0: a same-UID writer whose fd table /proc hides (non-dumpable) must
        # not be skipped: the kernel write lease still sees its descriptor.
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        plan = self.plan()
        ready = self.base / 'holder-ready'
        code = ('import ctypes, os, sys, time\n'
                'ctypes.CDLL(None).prctl(4, 0, 0, 0, 0)\n'
                'f = open(sys.argv[1], "r+")\n'
                'open(sys.argv[2], "w").close()\n'
                'time.sleep(30)\n')
        holder = subprocess.Popen(['python3', '-I', '-c', code, str(self.board), str(ready)])
        self.addCleanup(holder.wait)
        self.addCleanup(holder.kill)
        for _ in range(200):
            if ready.exists():
                break
            subprocess.run(['sleep', '0.05'])
        self.assertTrue(ready.exists())
        try:
            os.listdir(f'/proc/{holder.pid}/fd')
            hidden = False
        except PermissionError:
            hidden = True
        self.env['CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS'] = '300'
        err = self.call(*self.args(plan), ok=False)
        self.assertIn('displaced board still open by', err)
        if hidden:
            self.assertRegex(err, 'hidden from /proc|fd table not inspectable')
        self.assertEqual(self.board.read_text(), self.before)
        holder.kill()
        holder.wait()
        self.env.pop('CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS')

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_uninspectable_process_fails_closed_without_lease(self):
        # Without a kernel lease the /proc scan decides; a clean apply still
        # succeeds when every relevant process is inspectable, and the probe
        # result is never treated as proof of absence.
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        self.env['CODEX_TASK_BOARD_TEST_RECONCILE_NO_LEASE'] = 'true'
        self.env['CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS'] = '300'
        plan = self.plan()
        holder = subprocess.Popen(['sh', '-c', 'exec 3<>"$1"; sleep 30', 'sh', str(self.board)])
        self.addCleanup(holder.wait)
        self.addCleanup(holder.kill)
        for _ in range(100):
            if any(os.path.realpath(f'/proc/{holder.pid}/fd/{fd}') == str(self.board)
                   for fd in os.listdir(f'/proc/{holder.pid}/fd')):
                break
            subprocess.run(['sleep', '0.05'])
        err = self.call(*self.args(plan), ok=False)
        self.assertIn(str(holder.pid), err)
        self.assertEqual(self.board.read_text(), self.before)
        holder.kill()
        holder.wait()
        self.env.pop('CODEX_TASK_BOARD_TEST_RECONCILE_NO_LEASE')
        self.env.pop('CODEX_TASK_BOARD_RECONCILE_HOLDER_WAIT_MS')

    @unittest.skipUnless(EXCHANGE, 'mv --exchange unavailable')
    def test_retained_inode_checked_after_clean_apply(self):
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        plan = self.plan()
        self.call(*self.args(plan))
        retained = list((self.vault / '.task-board-repair-retained').glob('BOXP-433-*-displaced.md'))
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0].read_text(), self.before)
        self.assertEqual(self.plan()['retained-checked'], 1)
        with retained[0].open('a') as f:
            f.write('written after the run finished\n')
        self.assertIn('late concurrent write detected', self.call('--dry-run', ok=False))
        retained[0].unlink()
        self.assertIn('retained displaced board missing', self.call('--dry-run', ok=False))

    def test_without_exchange_requires_shared_lock(self):
        fake = self.base / 'nomv'
        fake.mkdir()
        mv = fake / 'mv'
        mv.write_text('#!/bin/sh\nfor a in "$@"; do [ "$a" = --exchange ] && exit 1; done\nexec ' + shutil.which('mv') + ' "$@"\n')
        mv.chmod(0o755)
        self.env['PATH'] = str(fake) + os.pathsep + self.env['PATH']
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        plan = self.plan()
        self.assertIn('unavailable and no shared writer lock', self.call(*self.args(plan), ok=False))
        self.unchanged()
        self.env['TASK_BOARD_VAULT_WRITER_LOCK_DIR'] = str(self.writer)
        self.assertEqual(self.call(*self.args(plan))['writer-lock'], 'shared')

    def test_conflicts_and_missing_confirm(self):
        plan = self.plan()
        self.call(*self.args(plan)[1:], ok=False)
        self.unchanged()
        for key in ('rev', 'ticket-sha256', 'board-sha256', 'after-board-sha256', 'source-sha256', 'helper-sha256'):
            with self.subTest(key=key):
                bad = dict(plan, **{key: '0' * 64})
                self.call(*self.args(bad), ok=False)
                self.unchanged()
        self.board.write_text(self.before + 'other writer\n')
        self.call(*self.args(plan), ok=False)
        self.assertTrue(self.board.read_text().endswith('other writer\n'))

    def test_source_active_unknown_and_changed(self):
        plan = self.plan()
        claim = self.root / 'locks/BOXP-433.edn'
        claim.write_text('{}')
        self.assertIn('claim', self.call('--dry-run', ok=False))
        claim.unlink()
        self.summary.write_text('{}')
        self.call('--dry-run', ok=False)
        self.call(*self.args(plan), ok=False)
        self.unchanged()

    def test_newer_active_run(self):
        new = self.root / 'runs/BOXP-433' / ('20261106T135333Z-' + RUN.split('-', 1)[1])
        new.mkdir()
        (new / 'summary.edn').write_text('{:status :running}')
        self.call('--dry-run', ok=False)
        self.unchanged()

    def test_malformed_semantic_and_lookalike_cards(self):
        for bad in (STALE.replace('BOXP-433: title', 'BOXP-432: title'),
                    STALE.replace('Tickets/BOXP-433|', 'Tickets/BOXP-4330|'),
                    STALE + ' #personal', STALE.replace('test-rev', 'old-rev'),
                    STALE.replace('title', 'different'), STALE.replace('in-progress', 'done'),
                    STALE.replace('- [ ]', '- [x]'), STALE.replace('boxp/lolice', 'boxp/arch'),
                    STALE + '\n  annotation that must survive'):
            with self.subTest(bad=bad):
                board = self.before.replace(STALE, bad, 1)
                self.board.write_text(board)
                self.call('--dry-run', ok=False)
                self.assertEqual(self.board.read_text(), board)

    def test_missing_and_corrupt_ticket(self):
        self.ticket.unlink()
        self.call('--dry-run', ok=False)
        self.ticket.write_text('broken')
        self.call('--dry-run', ok=False)
        self.unchanged()

    def test_unknown_writer_domain_and_symlink(self):
        self.env.pop('TASK_BOARD_VAULT_WRITER_LOCK_DIR')
        self.assertEqual(self.plan()['writer-lock'], 'none')
        self.env['TASK_BOARD_VAULT_WRITER_LOCK_DIR'] = str(self.writer)
        saved = self.base / 'saved'
        self.board.rename(saved)
        self.board.symlink_to(saved)
        self.call('--dry-run', ok=False)
        self.assertEqual(saved.read_text(), self.before)

    def test_other_id_and_normal_update_still_refuse(self):
        self.cmd[3] = 'BOXP-432'
        self.call('--dry-run', ok=False)
        self.cmd[3] = 'BOXP-433'
        self.cmd[2] = 'update'
        self.call('--dry-run', ok=False)
        self.unchanged()

    def test_root_rejected_before_lock_and_dry_run(self):
        fake = self.base / 'bin'
        fake.mkdir()
        uid = fake / 'id'
        uid.write_text('#!/bin/sh\nprintf "0\\n"\n')
        uid.chmod(0o755)
        self.env['PATH'] = str(fake) + os.pathsep + self.env['PATH']
        for args in ([], ['--dry-run']):
            self.assertIn('Root cannot run', self.call(*args, ok=False))
        self.assertFalse((self.vault / '.task-board-locks').exists())
        self.unchanged()

    def test_strict_source_and_ticket_parse(self):
        original = self.summary.read_text()
        for bad in (original + '{}', original.replace('2026-11-05T14:29:00Z', 'invalid'), '{broken'):
            self.summary.write_text(bad)
            self.call('--dry-run', ok=False)
        self.summary.write_text(original)
        self.ticket.write_text(self.ticket.read_text().replace('status: done', 'status: done\nstatus: in-progress'))
        self.call('--dry-run', ok=False)
        self.unchanged()

    def test_writer_lock_serializes_board_change(self):
        plan = self.plan()
        with (self.writer / 'vault-writer.lock').open('r+') as f:
            fcntl.lockf(f, fcntl.LOCK_EX)
            p = subprocess.Popen(self.cmd + self.args(plan), env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    p.communicate(timeout=0.3)
                self.board.write_text(self.before + 'concurrent note\n')
            finally:
                fcntl.lockf(f, fcntl.LOCK_UN)
                out, err = p.communicate(timeout=10)
            self.assertNotEqual(p.returncode, 0, (out, err))
        self.assertTrue(self.board.read_text().endswith('concurrent note\n'))

    def test_source_guard_serializes(self):
        with (self.root / 'lock-guards/BOXP-433.lock').open('r+') as f:
            fcntl.lockf(f, fcntl.LOCK_EX)
            p = subprocess.Popen(self.cmd + ['--dry-run'], env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    p.communicate(timeout=0.3)
                (self.root / 'locks/BOXP-433.edn').write_text('{}')
            finally:
                fcntl.lockf(f, fcntl.LOCK_UN)
                out, err = p.communicate(timeout=10)
            self.assertNotEqual(p.returncode, 0, (out, err))
        self.unchanged()


if __name__ == '__main__':
    unittest.main()
