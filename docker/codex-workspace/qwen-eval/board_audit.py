"""Read only non-body provenance from the existing local Task Board audit."""
import json
from pathlib import Path
import re
import subprocess


PROGRAM = '''(require '[clojure.edn :as e] '[cheshire.core :as j])
(println (j/generate-string
 (mapv (fn [p] (let [a (e/read-string (slurp p))]
  (assoc (select-keys a [:ticket-id :run-id :status :mode :action :docs-kind :model :sources])
   :applied (mapv #(select-keys % [:path :created? :before-sha256 :after-sha256]) (:applied a)))))
 *command-line-args*)))'''


def creation(root, ticket, run):
    if not re.fullmatch(r'BOXP-\d+', ticket) or not re.fullmatch(r'\d{8}T\d{6}Z-[0-9a-f-]+', run):
        raise ValueError('invalid Board run identity')
    root = Path(root).absolute()
    for item in (root, *root.parents):
        if item.is_symlink(): raise ValueError('audit root symlink')
    directory = root.resolve(strict=True) / 'runs' / ticket
    target = directory / run / 'localllm-audit.edn'
    paths = sorted(directory.glob('*/localllm-audit.edn'))
    if target not in paths: raise ValueError('Board creation audit unavailable')
    if target != paths[-1]: raise ValueError('latest Board audit must be selected')
    for path in paths:
        for item in (path, *path.parents):
            if item.is_symlink(): raise ValueError('audit symlink')
    # Never print model summaries, facts, note text or private source bodies.
    result = subprocess.run(['bb', '-e', PROGRAM, *map(str, paths)], capture_output=True, text=True, timeout=20)
    if result.returncode: raise ValueError('Board creation audit unavailable')
    audits = json.loads(result.stdout)
    audit = audits[-1]
    if audit.get('ticket-id') != ticket or audit.get('run-id') != run:
        raise ValueError('Board audit identity mismatch')
    if audit.get('status') != 'review' or audit.get('mode') != 'create' or audit.get('docs-kind') != 'character' or len(audit.get('applied', [])) != 1:
        raise ValueError('Board audit is not a completed character creation')
    target_note = audit['applied'][0]
    head, origin = None, None
    for item in audits:
        if item.get('ticket-id') != ticket or item.get('status') != 'review' or item.get('mode') != 'create' or item.get('docs-kind') != 'character':
            if item.get('applied') or origin is not None:
                raise ValueError('non-lineage audit interrupts character creation')
            continue
        if len(item.get('applied', [])) != 1: raise ValueError('one character note per run is required')
        note = item['applied'][0]
        if note['path'] != target_note['path']:
            raise ValueError('creation lineage cannot change the note path')
        if origin is None:
            if item.get('action') != 'edit' or note.get('created?') is not True or note.get('before-sha256') is not None:
                raise ValueError('Board audit changed an existing note')
            origin = item['run-id']
        elif item.get('action') != 'revise' or note.get('created?') is not False or note.get('before-sha256') != head:
            raise ValueError('Board revision lineage changed outside the new note')
        head = note['after-sha256']
    if origin is None or head != target_note['after-sha256']:
        raise ValueError('Board creation lineage unavailable')
    audit['creation-origin'] = origin
    return audit
