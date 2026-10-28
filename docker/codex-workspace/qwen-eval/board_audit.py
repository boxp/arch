"""Read only non-body provenance from the existing local Task Board audit."""
import json
from pathlib import Path
import re
import subprocess


def creation(root, ticket, run):
    if not re.fullmatch(r'BOXP-\d+', ticket) or not re.fullmatch(r'\d{8}T\d{6}Z-[0-9a-f-]+', run):
        raise ValueError('invalid Board run identity')
    path = Path(root).resolve(strict=True) / 'runs' / ticket / run / 'localllm-audit.edn'
    for item in (path, *path.parents):
        if item.is_symlink(): raise ValueError('audit symlink')
    # Never print the audit body, model summary, facts, or private source text.
    program = '''(require '[clojure.edn :as e] '[cheshire.core :as j])
(let [a (e/read-string (slurp (first *command-line-args*)))]
 (println (j/generate-string
  (assoc (select-keys a [:ticket-id :run-id :status :mode :action :docs-kind :model :sources])
   :applied (mapv #(select-keys % [:path :created? :before-sha256 :after-sha256]) (:applied a))))))'''
    result = subprocess.run(['bb', '-e', program, str(path)], capture_output=True, text=True, timeout=20)
    if result.returncode: raise ValueError('Board creation audit unavailable')
    audit = json.loads(result.stdout)
    if audit.get('ticket-id') != ticket or audit.get('run-id') != run or audit.get('status') != 'review' or audit.get('mode') != 'create' or audit.get('action') != 'edit' or audit.get('docs-kind') != 'character':
        raise ValueError('Board audit is not a completed character creation')
    if len(audit.get('applied', [])) != 1:
        raise ValueError('one newly created note is required')
    note = audit['applied'][0]
    if note.get('created?') is not True or note.get('before-sha256') is not None:
        raise ValueError('Board audit changed an existing note')
    return audit
