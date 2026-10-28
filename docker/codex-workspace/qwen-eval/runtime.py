#!/usr/bin/env python3
"""Durable runtime phase controller; transport and privileges are deliberately external.

The backend must enforce resourceVersion/UID preconditions on each write, bound every
I/O operation, and read back the gate and both deployments. No cluster transport
or RBAC is installed here. An ambiguous write is never replayed.
"""
import json
import sqlite3
import time
import uuid
from pathlib import Path

from live import LiveAdapter, PHASES


class RecoveryRequired(RuntimeError):
    pass


class RuntimeController:
    """Serialize one fenced window and persist each intended transition first.

    backend.snapshot() -> (gemma replicas, qwen replicas, gate string).
    backend.compare_and_set(expected, desired, deadline): check the complete
    snapshot under the node lease; apply conditional writes or raise on uncertainty.
    backend.wait(desired, deadline): confirm desired state *and* convergence.
    backend.assert_lease(): verify the node-wide lease and durable marker.
    A real backend must additionally fence competing writers across the multi-
    resource operation; Kubernetes offers no multi-object transaction by itself.
    """
    def __init__(self, root, token, backend, *, timeout=120, max_window=1800,
                 max_batch=2, clock=time.monotonic, wall=time.time):
        if timeout <= 0 or not 0 < max_window <= 1800 or not 1 <= max_batch <= 2:
            raise ValueError('invalid runtime limits')
        self.token, self.backend = token, backend
        self.timeout, self.max_window, self.max_batch = timeout, max_window, max_batch
        self.clock, self.wall = clock, wall
        self.cancelled = False
        self.verified = False
        self.db = sqlite3.connect(str(Path(root) / 'runtime.sqlite'), timeout=30)
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS transitions (id INTEGER PRIMARY KEY, phase TEXT NOT NULL, intended_at REAL NOT NULL, settled_at REAL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS dispatches (id INTEGER PRIMARY KEY AUTOINCREMENT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS window (id INTEGER PRIMARY KEY CHECK(id=1), token TEXT NOT NULL, started REAL NOT NULL, phase TEXT NOT NULL, pending TEXT, expected TEXT, desired TEXT)')
        with self.db:
            row = self.db.execute('SELECT token FROM window WHERE id=1').fetchone()
            if row is None:
                self.db.execute('INSERT INTO window VALUES (1,?,?,?,NULL,NULL,NULL)', (token, wall(), 'initial'))
            elif row[0] != token:
                raise RecoveryRequired('window belongs to another token')

    def cancel(self):
        self.cancelled = True

    def _guard(self, *, restoring=False):
        self.backend.assert_lease()
        row = self.db.execute('SELECT started FROM window WHERE id=1').fetchone()
        elapsed = self.wall() - row[0]
        if elapsed < 0:
            raise RecoveryRequired('clock moved backwards')
        if not restoring and (self.cancelled or elapsed >= self.max_window):
            raise RecoveryRequired('cancelled or window deadline exceeded; restore required')

    def check_batch(self, count):
        if not 1 <= count <= self.max_batch:
            raise ValueError('batch limit exceeded')
        self._guard()

    def reserve_dispatch(self):
        self._guard()
        if self.db.execute('SELECT phase,pending FROM window WHERE id=1').fetchone() != ('start-qwen', None):
            raise RecoveryRequired('Qwen start must be settled before dispatch')
        if list(self.backend.snapshot()) != [0, 1, 'closed:' + self.token]:
            raise RecoveryRequired('Qwen ownership drift before dispatch')
        count = self.db.execute('SELECT count(*) FROM dispatches').fetchone()[0]
        self.check_batch(count + 1)
        with self.db:
            self.db.execute('INSERT INTO dispatches DEFAULT VALUES')

    def mark_verified(self):
        self._guard(restoring=True)
        if self.db.execute('SELECT phase,pending FROM window WHERE id=1').fetchone() != ('restore-gemma', None):
            raise RecoveryRequired('restore is not settled')
        self.verified = True

    def phase(self, name):
        if name not in PHASES:
            raise ValueError('unknown phase')
        if name == 'reopen' and not self.verified:
            raise RecoveryRequired('fresh restore probe required')
        restoring = name in ('stop-qwen', 'restore-gemma', 'reopen')
        self._guard(restoring=restoring)
        row = self.db.execute('SELECT phase,pending FROM window WHERE id=1').fetchone()
        if row[1] is not None:
            raise RecoveryRequired('pending transition requires observation, never replay')
        previous = {'fence':'initial', 'stop-gemma':'fence', 'start-qwen':'stop-gemma',
                    'stop-qwen':'start-qwen', 'restore-gemma':'stop-qwen', 'reopen':'restore-gemma'}
        # A failed start may leave the system safely stopped. The caller must
        # explicitly reconcile it; do not infer a phase from replica counts.
        if row[0] != previous[name] and not (name == 'restore-gemma' and row[0] in ('fence', 'stop-gemma')):
            raise RecoveryRequired('unexpected phase order')
        before, after, mode = PHASES[name]
        if name == 'restore-gemma' and row[0] == 'fence':
            before = (1, 0)  # Cancel before stopping Gemma: verify it in place.
        snapshot = self.backend.snapshot()
        if tuple(snapshot[:2]) != before:
            raise RecoveryRequired('unexpected replica state')
        gate = snapshot[2]
        if name == 'fence':
            if not isinstance(gate, str) or not gate.startswith('open:'):
                raise RecoveryRequired('gate already owned or unknown')
        elif gate != ('verify:' if name == 'reopen' else 'closed:') + self.token:
            raise RecoveryRequired('gate ownership changed')
        desired = [*after, mode + ':' + self.token]
        expected = list(snapshot)
        with self.db:
            self.db.execute('INSERT INTO transitions(phase,intended_at) VALUES (?,?)', (name, self.wall()))
            self.db.execute('UPDATE window SET pending=?,expected=?,desired=? WHERE id=1',
                            (name, json.dumps(expected), json.dumps(desired)))
        deadline = self.clock() + self.timeout
        self.backend.compare_and_set(expected, desired, deadline)
        self.backend.wait(desired, deadline)
        self._finish(name, desired, deadline)

    def _finish(self, name, desired, deadline):
        self.backend.assert_lease()
        if self.clock() >= deadline or list(self.backend.snapshot()) != desired:
            raise RecoveryRequired('transition timeout or readback mismatch')
        with self.db:
            self.db.execute('UPDATE transitions SET settled_at=? WHERE id=(SELECT max(id) FROM transitions WHERE phase=? AND settled_at IS NULL)', (self.wall(), name))
            self.db.execute('UPDATE window SET phase=?,pending=NULL,expected=NULL,desired=NULL WHERE id=1 AND pending=?', (name, name))

    def reconcile(self):
        """Observe an interrupted write; never perform or retry a mutation.

        Even when desired values are present, wait must prove convergence and
        ownership. All other outcomes remain pending for operator investigation.
        """
        self.backend.assert_lease()
        row = self.db.execute('SELECT pending,desired FROM window WHERE id=1').fetchone()
        if row[0] is None:
            return 'settled'
        desired = json.loads(row[1])
        if list(self.backend.snapshot()) != desired:
            raise RecoveryRequired('ambiguous transition; explicit recovery required')
        deadline = self.clock() + self.timeout
        self.backend.wait(desired, deadline)
        self._finish(row[0], desired, deadline)
        return row[0]


class RuntimeAdapter(LiveAdapter):
    """Reuse the existing drain, GPU, queue and restore probes with runtime phases.

    kubernetes_runtime supplies an explicit-credential transport. Argo ownership,
    convergence callbacks and the node lease must be deployed and verified first.
    This is not a standalone CLI or an enabled normal-Board integration.
    """
    def __init__(self, root, lolice, token, backend, **limits):
        self.evidence_directory = 'runtime-evidence/' + uuid.uuid4().hex
        super().__init__(root, lolice, token)
        self.controller = RuntimeController(root, token, backend, **limits)

    def record(self, name, value):
        # A fresh probe after interruption must preserve the previous proof.
        super().record(name + '-' + uuid.uuid4().hex, value)

    def can_restore_without_handover(self):
        # Harness may recover a completed drain cancelled before Gemma stops.
        # An incomplete/ambiguous drain deliberately remains fail closed.
        try:
            self.assert_lease()
            return (self.pod_uid is not None and self.controller.db.execute(
                'SELECT phase,pending FROM window WHERE id=1').fetchone() == ('fence', None)
                and list(self.controller.backend.snapshot()) == [1, 0, 'closed:' + self.token])
        except Exception:
            return False

    def phase(self, phase):
        self.assert_lease()
        self.controller.phase(phase)

    def mark_window_completed(self, images):
        self.assert_lease()
        if self.controller.db.execute('SELECT phase,pending FROM window WHERE id=1').fetchone() != ('reopen', None):
            raise RecoveryRequired('window is not restored')
        if list(self.controller.backend.snapshot()) != [1, 0, 'open:' + self.token]:
            raise RecoveryRequired('window final state changed')
        self.ssh("""
import json,os,time
from pathlib import Path
j=json.loads(payload);w=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work');p=w/'boxp344-window.json'
old=json.loads(p.read_text());assert old['token']==j['token']
old.update(state='completed',images=j['images'],completed_at=time.time(),regeneration_allowed=False)
t=w/(j['token']+'.complete.tmp')
with t.open('x') as f: json.dump(old,f);f.flush();os.fsync(f.fileno())
os.replace(t,p)
f=os.open(w,os.O_RDONLY|os.O_DIRECTORY);os.fsync(f);os.close(f)
print('completed')
""", {'token':self.token,'images':images})

    def generate(self, contract):
        self.controller.reserve_dispatch()
        return super().generate(contract)

    def stop_qwen_and_prove_gpu_free(self):
        phase, pending = self.controller.db.execute(
            'SELECT phase,pending FROM window WHERE id=1').fetchone()
        if pending is not None:
            raise RecoveryRequired('unsettled runtime write prevents restore')
        if phase == 'fence':
            # No GPU handover occurred. Do not require Gemma to disappear just
            # to verify the same model and reopen after a cancelled window.
            self.assert_lease()
            self.require_gate('closed')
            if tuple(self.controller.backend.snapshot()[:2]) != (1, 0):
                raise RecoveryRequired('unexpected pre-handover state')
            pids = self.gpu_pids()
            if not pids or set(pids.values()) != {'llama-server'}:
                raise RecoveryRequired('unexpected GPU owner before restore')
            return
        return super().stop_qwen_and_prove_gpu_free()

    def restore_gemma_verify(self):
        row = self.controller.db.execute('SELECT phase,pending FROM window WHERE id=1').fetchone()
        if row == ('restore-gemma', None):
            self.assert_lease()
            if list(self.controller.backend.snapshot()) != [1, 0, 'verify:' + self.token]:
                raise RecoveryRequired('restore state drift before fresh probe')
            self.verify_gemma_ready()
        else:
            super().restore_gemma_verify()
        self.controller.mark_verified()
