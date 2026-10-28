#!/usr/bin/env python3
"""Closed synthetic evaluation only. No production adapter or network integration."""
import argparse
import contextlib
import ctypes
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import struct
import time
import zlib

INPUTS = {
    'task-board': ('A fictional blue robot tending a garden.', 101),
    'novel-board': ('At dusk, a fictional red bird carries a silver seed across a quiet moon. It lands beside a dry crater and plants the seed. By dawn, one tiny white flower shines in the dust.', 202),
}
REVISION = 'synthetic-fake-only'


def png():
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b'\x00\x00\x00\x00')) + chunk(b'IEND', b''))


def validate_png(data):
    if not data.startswith(b'\x89PNG\r\n\x1a\n') or len(data) > 16_000_000:
        raise ValueError('invalid PNG')
    pos, seen, idat = 8, [], b''
    while pos < len(data):
        if pos + 12 > len(data): raise ValueError('truncated PNG')
        n = struct.unpack('>I', data[pos:pos+4])[0]
        end = pos + 12 + n
        if end > len(data): raise ValueError('truncated PNG')
        kind, body = data[pos+4:pos+8], data[pos+8:pos+8+n]
        if zlib.crc32(kind + body) != struct.unpack('>I', data[pos+8+n:end])[0]: raise ValueError('PNG CRC')
        seen.append(kind)
        if kind == b'IHDR':
            if n != 13: raise ValueError('PNG IHDR')
            width, height, depth, color, compression, filtering, interlace = struct.unpack('>IIBBBBB', body)
            if depth != 8 or color not in (2, 6) or compression or filtering or interlace:
                raise ValueError('unsupported PNG format')
            channels = 3 if color == 2 else 4
            if not (1 <= width <= 2048 and 1 <= height <= 2048): raise ValueError('PNG dimensions')
        if kind == b'IDAT': idat += body
        pos = end
        if kind == b'IEND': break
    if not seen or seen[0] != b'IHDR' or seen.count(b'IHDR') != 1 or seen[-1] != b'IEND' or pos != len(data) or not idat:
        raise ValueError('invalid PNG structure')
    # Bound decompression to avoid untrusted output expansion.
    dec = zlib.decompressobj()
    pixels = dec.decompress(idat, 32_000_001)
    if dec.unconsumed_tail or dec.unused_data or not dec.eof: raise ValueError('invalid PNG data')
    stride = 1 + width * channels
    if len(pixels) != height * stride or any(pixels[row * stride] > 4 for row in range(height)):
        raise ValueError('invalid PNG pixel buffer')
    return width, height


def reference(root, relative, expected):
    root = Path(root).absolute()
    for component in (root, *root.parents):
        if component.is_symlink(): raise ValueError('symlink reference root')
    root = root.resolve(strict=True)
    p = Path(relative)
    if p.is_absolute() or not p.parts or any(x in ('..', '.') for x in p.parts): raise ValueError('invalid reference path')
    current = root
    for part in p.parts:
        current = current / part
        if current.is_symlink(): raise ValueError('symlink reference')
    resolved = current.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file(): raise ValueError('reference outside root')
    data = resolved.read_bytes()
    if hashlib.sha256(data).hexdigest() != expected: raise ValueError('reference hash mismatch')
    validate_png(data)
    return data


class ClosedAdapter:
    """Real implementation deliberately absent; no switch can assert live safety."""
    def fence_and_drain(self): raise RuntimeError('real safety adapter unavailable')
    def stop_gemma_and_prove_gpu_free(self): raise RuntimeError('unavailable')
    def start_qwen(self): raise RuntimeError('unavailable')
    def generate(self, contract): raise RuntimeError('unavailable')
    def stop_qwen_and_prove_gpu_free(self): raise RuntimeError('unavailable')
    def restore_gemma_verify(self): raise RuntimeError('unavailable')
    def reopen(self): raise RuntimeError('unavailable')


class FakeAdapter(ClosedAdapter):
    """In-memory test double; never connects to a model, GPU, or network."""
    def __init__(self, fail=None): self.fail, self.calls = fail, []
    def step(self, name):
        self.calls.append(name)
        if self.fail == name: raise RuntimeError('fake ' + name)
    def fence_and_drain(self): self.step('fence_and_drain')
    def stop_gemma_and_prove_gpu_free(self): self.step('stop_gemma_and_prove_gpu_free')
    def start_qwen(self): self.step('start_qwen')
    def generate(self, contract): self.step('generate'); return png()
    def stop_qwen_and_prove_gpu_free(self): self.step('stop_qwen_and_prove_gpu_free')
    def restore_gemma_verify(self): self.step('restore_gemma_verify')
    def reopen(self): self.step('reopen')


class Harness:
    def __init__(self, root, profile='fake'):
        if profile not in ('fake', 'turbo'): raise ValueError('unknown evaluation profile')
        self.profile = profile
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.root / 'jobs.sqlite', timeout=30)
        self.db.execute('PRAGMA synchronous=FULL')
        self.db.execute('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
        with self.db:
            self.db.execute('INSERT OR IGNORE INTO config VALUES (?,?)', ('profile', profile))
        if self.db.execute("SELECT value FROM config WHERE key='profile'").fetchone()[0] != profile:
            raise ValueError('evaluation profile cannot change within a root')
        self.db.execute('CREATE TABLE IF NOT EXISTS jobs (board TEXT PRIMARY KEY, contract TEXT NOT NULL, state TEXT NOT NULL, error TEXT)')
        self.db.execute('CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, board TEXT, state TEXT, at REAL, detail TEXT)')
    @contextlib.contextmanager
    def lock(self):
        with open(self.root / 'arbiter.lock', 'a+b') as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            yield
    def state(self, board, state, detail=''):
        with self.db:
            self.db.execute('UPDATE jobs SET state=?, error=? WHERE board=?', (state, detail, board))
            self.db.execute('INSERT INTO events(board,state,at,detail) VALUES (?,?,?,?)', (board,state,time.time(),detail))
    def submit(self, board):
        if board not in INPUTS: raise ValueError('only two fixed synthetic inputs are permitted')
        prompt, seed = INPUTS[board]
        contract = json.dumps(dict(id=board, board=board, source=prompt, prompt='Illustrate this fictional synthetic material: ' + prompt, seed=seed,
                                   width=1 if self.profile == 'fake' else 896,
                                   height=1 if self.profile == 'fake' else 1184,
                                   model_revision=REVISION if self.profile == 'fake' else 'Qwen/Qwen-Image-2.1-Turbo@fc13ba1986fcb905854dc8de2f52eee395f49b5b', reference=None, purpose='closed synthetic evaluation'), sort_keys=True)
        with self.lock():
            row = self.db.execute('SELECT contract FROM jobs WHERE board=?', (board,)).fetchone()
            if row:
                if row[0] != contract: raise ValueError('conflicting contract')
                return
            with self.db:
                self.db.execute('INSERT INTO jobs VALUES (?,?,?,?)', (board,contract,'queued',''))
                self.db.execute('INSERT INTO events(board,state,at,detail) VALUES (?,?,?,?)', (board,'queued',time.time(),''))
    def run(self, board, adapter):
        return self.run_many([board], adapter)[board]

    def run_many(self, boards, adapter):
        if not boards or len(set(boards)) != len(boards) or any(b not in INPUTS for b in boards):
            raise ValueError('only the two unique synthetic Boards are allowed')
        if getattr(adapter, 'profile', 'fake') != self.profile:
            raise ValueError('adapter/profile mismatch')
        with self.lock():
            rows = {b: self.db.execute('SELECT contract,state FROM jobs WHERE board=?', (b,)).fetchone() for b in boards}
            if any(row is None for row in rows.values()): raise ValueError('submit first')
            pending = [b for b, row in rows.items() if row[1] == 'queued']
            interrupted = [b for b, row in rows.items() if row[1] not in ('queued','completed','failed','recovery-needed')]
            for board in interrupted:
                self.state(board, 'recovery-needed', 'interrupted operation; no automatic regeneration or reopening')
            def statuses():
                return {b: self.db.execute('SELECT state FROM jobs WHERE board=?', (b,)).fetchone()[0] for b in boards}
            if interrupted: return statuses()
            if not pending: return statuses()
            if self.db.execute("SELECT 1 FROM jobs WHERE state NOT IN ('queued','completed','failed')").fetchone():
                raise RuntimeError('arbiter recovery required')
            errors, safe, restored, persistence_ok = {}, False, False, True
            staged = set()
            current = None
            try:
                for board in pending: self.state(board, 'draining')
                adapter.fence_and_drain()
                adapter.stop_gemma_and_prove_gpu_free()
                safe = True
                for board in pending: self.state(board, 'image-ready')
                adapter.start_qwen()
                for board in pending:
                    current = board
                    contract = json.loads(rows[board][0])
                    self.state(board, 'generating')
                    data = adapter.generate(contract)
                    if validate_png(data) != (contract['width'], contract['height']):
                        raise ValueError('output dimensions differ from contract')
                    self.state(board, 'staged')
                    stage = self.root / 'staging' / board
                    stage.mkdir(parents=True, exist_ok=False)
                    self.write_new(stage / 'image.png', data)
                    metadata = dict(contract, fake=self.profile == 'fake', sha256=hashlib.sha256(data).hexdigest(),
                                    generation=getattr(adapter, 'generation_metadata', {}))
                    self.write_new(stage / 'metadata.json', json.dumps(metadata, indent=2).encode())
                    staged.add(board)
            except Exception as exc:
                reason = type(exc).__name__ + ': ' + str(exc)
                for board in pending:
                    if board not in staged:
                        errors[board] = reason if board == current or current is None else 'batch aborted: ' + reason
            finally:
                for board in pending:
                    try: self.state(board, 'restoring', errors.get(board, ''))
                    except Exception as exc:
                        persistence_ok = False
                        errors[board] = 'persistence: ' + repr(exc)
                if not safe:
                    try:
                        safe = bool(getattr(adapter, 'can_restore_without_handover', lambda: False)())
                    except Exception as exc:
                        for board in pending: errors[board] = errors.get(board, '') + '; recovery proof: ' + repr(exc)
                if safe:
                    try:
                        adapter.stop_qwen_and_prove_gpu_free()
                        adapter.restore_gemma_verify()
                        if persistence_ok:
                            adapter.reopen()
                            restored = True
                    except Exception as exc:
                        for board in pending: errors[board] = errors.get(board, '') + '; restore: ' + repr(exc)
            for board in pending:
                if not restored:
                    self.state(board, 'recovery-needed', errors.get(board, 'safety proof failed'))
                elif board in errors:
                    self.state(board, 'failed', errors[board])
                else:
                    try:
                        self.state(board, 'publishing')
                        self.publish(board)
                        self.state(board, 'completed')
                    except Exception as exc:
                        self.state(board, 'recovery-needed', 'publication: ' + repr(exc))
            return statuses()
    @staticmethod
    def write_new(path, data):
        with open(path, 'xb') as f:
            f.write(data); f.flush(); os.fsync(f.fileno())
    def publish(self, board):
        # A single no-replace rename publishes the entire bundle atomically.
        parent = self.root / 'vault' / 'qwen-synthetic-evaluation'
        parent.mkdir(parents=True, exist_ok=True)
        stage = self.root / 'staging' / board
        contract = json.loads(self.db.execute('SELECT contract FROM jobs WHERE board=?', (board,)).fetchone()[0])
        self.write_new(stage / 'note.md', ('# 合成評価: ' + board + '\n\n'
                       + contract['source'] + ('\n\n![テスト用fake画像](image.png)\n' if self.profile == 'fake' else '\n\n![合成評価画像](image.png)\n')).encode())
        fd = os.open(stage, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
        libc = ctypes.CDLL(None, use_errno=True)
        rename = libc.renameat2
        rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
        if rename(-100, os.fsencode(stage), -100, os.fsencode(parent / board), 1) != 0:
            code = ctypes.get_errno()
            raise OSError(code, os.strerror(code))
        for directory in (parent, stage.parent):
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(fd)
            finally: os.close(fd)



def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, help='private dedicated evaluation directory')
    parser.add_argument('command', choices=('submit','run','status'))
    parser.add_argument('board', choices=tuple(INPUTS))
    parser.add_argument('--fake', action='store_true', help='test double only; output is not a Qwen image')
    args = parser.parse_args()
    h = Harness(args.root)
    if args.command == 'submit': h.submit(args.board)
    elif args.command == 'run': print(h.run(args.board, FakeAdapter() if args.fake else ClosedAdapter()))
    else:
        row = h.db.execute('SELECT contract,state,error FROM jobs WHERE board=?', (args.board,)).fetchone()
        print(json.dumps(row))

if __name__ == '__main__': main()
