#!/usr/bin/env python3
"""Black-box sanctioned repair fixtures; no production vault access."""
import fcntl
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
        self.env = dict(os.environ, TASK_BOARD_VAULT_WRITER_LOCK_DIR=str(self.writer))
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
        self.call(*self.args(plan))
        self.assertEqual(self.board.read_text(), self.before.replace(STALE + '\n', '', 1))
        self.assertEqual(self.ticket.read_bytes(), original_ticket)
        self.assertEqual(digest(self.board), plan['after-board-sha256'])
        audit = (self.vault / '.task-board-repair-audit.edn').read_bytes()
        self.assertTrue(self.call(*self.args(plan))['noop'])
        self.assertEqual((self.vault / '.task-board-repair-audit.edn').read_bytes(), audit)

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
        self.call('--dry-run', ok=False)
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
