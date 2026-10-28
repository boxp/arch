import copy
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'docker/codex-workspace/qwen-eval'))
from file_backend import FileQueueBackend
from harness import png
from research import ResearchHarness
from runtime import RecoveryRequired


class ResearchTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.vault=self.root/'vault';self.vault.mkdir()
        self.folder=self.vault/'ひとはこさんバース';self.folder.mkdir()
        self.note=self.folder/'new.md';self.note.write_text('---\nticket: BOXP-350\n---\n# Synthetic new character\n')
        self.manifest=dict(ticket='BOXP-350',run='20261028T113327Z-aaaa-bbbb',note='ひとはこさんバース/new.md',note_sha256=hashlib.sha256(self.note.read_bytes()).hexdigest(),
            output='ひとはこさんバース/image-BOXP-350',job=dict(id='BOXP-350',prompt='Synthetic robot',seed=349,width=896,height=1184,steps=8,
            model_revision='Qwen/Qwen-Image-2.1-Turbo@fc13ba1986fcb905854dc8de2f52eee395f49b5b',reference=None,purpose='closed personal research evaluation'))
    def harness(self, manifest=None):
        m = manifest or self.manifest
        audit={'applied':[{'path':m['note'],'after-sha256':m['note_sha256']}]}
        with patch('board_audit.creation', return_value=audit):
            h=ResearchHarness(self.root/'state',self.vault,m,board_root=self.root)
        self.addCleanup(h.db.close);return h
    def test_existing_character_and_source_change_refused(self):
        self.note.write_text('---\nticket: BOXP-100\n---\n# Existing character\n')
        self.manifest['note_sha256']=hashlib.sha256(self.note.read_bytes()).hexdigest()
        with self.assertRaisesRegex(ValueError,'does not belong'): self.harness()
        self.manifest['note_sha256']='0'*64
        with self.assertRaisesRegex(ValueError,'changed'): self.harness()
    def test_escaping_symlink_and_existing_output_refused(self):
        m=copy.deepcopy(self.manifest);m['output']='../outside'
        with self.assertRaises(ValueError): self.harness(m)
        (self.folder/'image-BOXP-350').symlink_to(self.root)
        with self.assertRaises(ValueError): self.harness()
    def test_publication_conflict_preserves_note(self):
        h=self.harness();stage=h.root/'staging'/'BOXP-350';stage.mkdir(parents=True)
        (stage/'image.png').write_bytes(png());(stage/'metadata.json').write_text('{}')
        self.note.write_text('Owner edit')
        with self.assertRaisesRegex(ValueError,'changed'): h.publish('BOXP-350')
        self.assertEqual(self.note.read_text(),'Owner edit')
        self.assertFalse((self.folder/'image-BOXP-350').exists())
    def test_publication_has_one_real_relative_link(self):
        h=self.harness();stage=h.root/'staging'/'BOXP-350';stage.mkdir(parents=True)
        (stage/'image.png').write_bytes(png());(stage/'metadata.json').write_text('{}')
        h.publish('BOXP-350')
        self.assertIn('![画像資料](image.png)',(self.folder/'image-BOXP-350/reference.md').read_text())
        self.assertEqual(hashlib.sha256(self.note.read_bytes()).hexdigest(),self.manifest['note_sha256'])
        self.assertEqual((self.folder/'image-BOXP-350/image.png').read_bytes(),png())
        with self.assertRaises((ValueError, FileExistsError)): h.publish('BOXP-350')
    def test_file_transport_does_not_accept_arbitrary_kubectl(self):
        for args in [['get','secrets'],['-n','local-llm','patch','deployment','llama-server'],['get','--raw','/api/v1/secrets','extra']]:
            with self.assertRaises(RecoveryRequired): FileQueueBackend.request(args)
        method,path,_=FileQueueBackend.request(['-n','local-llm','get','configmap','llama-server-admission','-o','json'])
        self.assertEqual(method,'GET');self.assertTrue(path.endswith('configmaps/llama-server-admission'))

if __name__=='__main__':unittest.main()
