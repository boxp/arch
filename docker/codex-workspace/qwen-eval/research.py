"""One explicitly requested local research image attached to a newly created note.

No content is logged. The local manifest is not a cloud agent prompt. It names
one note, one optional reference, and a new output bundle inside the same vault.
"""
import hashlib
import json
import os
from pathlib import Path
import re

from harness import Harness, validate_image_reference


def local_path(root, relative, *, exists=True):
    root = Path(root).resolve(strict=True)
    path = Path(relative)
    if path.is_absolute() or not path.parts or '..' in path.parts:
        raise ValueError('invalid research path')
    current = root
    for component in path.parts:
        current = current / component
        if current.is_symlink(): raise ValueError('research symlink')
    result = current.resolve(strict=exists)
    if not result.is_relative_to(root): raise ValueError('research path outside vault')
    return result


class ResearchHarness(Harness):
    def __init__(self, root, vault, manifest, *, board_root=None):
        super().__init__(root, profile='turbo')
        self.vault = Path(vault).resolve(strict=True)
        if set(manifest) != {'ticket', 'run', 'note', 'note_sha256', 'output', 'job'}:
            raise ValueError('research manifest keys')
        if not re.fullmatch(r'BOXP-\d+', manifest['ticket']): raise ValueError('research ticket')
        if board_root is None: raise ValueError('normal Board provenance is required')
        from board_audit import creation
        audit = creation(board_root, manifest['ticket'], manifest['run'])
        applied = audit['applied'][0]
        if applied['path'] != manifest['note'] or applied['after-sha256'] != manifest['note_sha256']:
            raise ValueError('manifest does not match the normal Board creation audit')
        note = local_path(self.vault, manifest['note'])
        if note.suffix != '.md' or not manifest['note'].startswith('ひとはこさんバース/'):
            raise ValueError('research note must be in the canon folder')
        data = note.read_bytes()
        if hashlib.sha256(data).hexdigest() != manifest['note_sha256']:
            raise ValueError('research note changed')
        # Prove this is the new note created by the normal localllm ticket,
        # never append to an existing character selected by arbitrary path.
        frontmatter = data.decode().split('---', 2)
        if len(frontmatter) != 3 or not re.search(r'(?m)^ticket:\s*["\']?' + re.escape(manifest['ticket']) + r'["\']?\s*$', frontmatter[1]):
            raise ValueError('note does not belong to the requested creation ticket')
        output = local_path(self.vault, manifest['output'], exists=False)
        if not manifest['output'].startswith('ひとはこさんバース/') or output.exists() or not output.parent.is_dir():
            raise ValueError('research output must be a new bundle in an existing canon directory')
        job = manifest['job']
        required = {'id', 'prompt', 'seed', 'width', 'height', 'model_revision', 'reference', 'purpose', 'steps'}
        if set(job) != required or job['id'] != manifest['ticket']:
            raise ValueError('research image contract')
        if job['purpose'] != 'closed personal research evaluation' or job['model_revision'] != 'Qwen/Qwen-Image-2.1-Turbo@fc13ba1986fcb905854dc8de2f52eee395f49b5b':
            raise ValueError('research scope or model revision')
        if job['steps'] != 8 or (job['width'], job['height']) != (896, 1184) or type(job['seed']) is not int or not 0 <= job['seed'] < 2**32:
            raise ValueError('research image parameters')
        if not isinstance(job['prompt'], str) or not 1 <= len(job['prompt']) <= 8000:
            raise ValueError('research prompt budget')
        if job['reference'] is not None:
            validate_image_reference(self.vault, job['reference'])
        self.manifest = manifest
        self.inputs = {job['id']: None}
        contract = json.dumps(job, sort_keys=True)
        with self.lock():
            old = self.db.execute('SELECT contract FROM jobs WHERE board=?', (job['id'],)).fetchone()
            if old and old[0] != contract: raise ValueError('conflicting research job')
            if not old:
                with self.db:
                    self.db.execute('INSERT INTO jobs VALUES (?,?,?,?)', (job['id'], contract, 'queued', ''))

    def publish(self, board):
        m = self.manifest
        note = local_path(self.vault, m['note'])
        if hashlib.sha256(note.read_bytes()).hexdigest() != m['note_sha256']:
            raise ValueError('new character note changed before image publication')
        stage = self.root / 'staging' / board
        output = local_path(self.vault, m['output'], exists=False)
        # A hardlink does not cross filesystems; copy into a temporary sibling
        # then use the existing no-replace rename primitive for the whole bundle.
        temporary = output.parent / ('.' + board + '-image-staging')
        temporary.mkdir()
        for name in ('image.png', 'metadata.json'):
            self.write_new(temporary / name, (stage / name).read_bytes())
        self.write_new(temporary / 'provenance.json', json.dumps(m, ensure_ascii=False, indent=2).encode())
        note_link = Path(os.path.relpath(note, output)).as_posix()
        self.write_new(temporary / 'reference.md',
                       ('# 新キャラの研究評価画像資料\n\n[設定ノート](<' + note_link + '>)\n\n'
                        '![画像資料](image.png)\n\n[生成metadata](metadata.json)\n\n'
                        '閉じた個人研究評価の1枚。内容の最終評価はOwner。\n').encode())
        fd = os.open(temporary, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
        from harness import ctypes
        libc = ctypes.CDLL(None, use_errno=True)
        if libc.renameat2(-100, os.fsencode(temporary), -100, os.fsencode(output), 1):
            raise OSError(ctypes.get_errno(), 'research bundle publication failed')
        fd = os.open(output.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(fd)
        finally: os.close(fd)
        # The original character note remains byte-for-byte intact. A new
        # companion note links the setting, image and provenance together;
        # non-cooperating Obsidian edits cannot be overwritten by publication.
