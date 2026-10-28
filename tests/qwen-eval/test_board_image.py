import contextlib
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'docker/codex-workspace/qwen-eval'))
from board_audit import creation
from harness import png
import prepare_board_image


class BoardImageTest(unittest.TestCase):
    def test_only_new_character_audit_is_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            run='20261028T113859Z-aaaa-bbbb'
            directory=Path(d)/'runs/BOXP-350'/run;directory.mkdir(parents=True)
            audit=directory/'localllm-audit.edn'
            good='{:ticket-id "BOXP-350" :run-id "'+run+'" :status :review :mode "create" :action :edit :docs-kind "character" :applied [{:path "new.md" :created? true :before-sha256 nil :after-sha256 "hash"}]}'
            audit.write_text(good)
            self.assertEqual(creation(d,'BOXP-350',run)['applied'][0]['after-sha256'],'hash')
            for bad in [good.replace(':created? true',':created? false'),good.replace(':action :edit',':action :revise'),good.replace(':status :review',':status :staged')]:
                audit.write_text(bad)
                with self.assertRaises(ValueError): creation(d,'BOXP-350',run)
    def test_revision_must_descend_from_the_same_new_note(self):
        with tempfile.TemporaryDirectory() as d:
            first='20261028T113859Z-aaaa-bbbb';second='20261028T114859Z-aaaa-bbbb'
            one=Path(d)/'runs/BOXP-350'/first;one.mkdir(parents=True)
            two=Path(d)/'runs/BOXP-350'/second;two.mkdir()
            original='{:ticket-id "BOXP-350" :run-id "'+first+'" :status :review :mode "create" :action :edit :docs-kind "character" :applied [{:path "new.md" :created? true :before-sha256 nil :after-sha256 "first"}]}'
            revised='{:ticket-id "BOXP-350" :run-id "'+second+'" :status :review :mode "create" :action :revise :docs-kind "character" :applied [{:path "new.md" :created? false :before-sha256 "first" :after-sha256 "second"}]}'
            (one/'localllm-audit.edn').write_text(original);(two/'localllm-audit.edn').write_text(revised)
            self.assertEqual(creation(d,'BOXP-350',second)['creation-origin'],first)
            (two/'localllm-audit.edn').write_text(revised.replace(':before-sha256 "first"',':before-sha256 "owner-edit"'))
            with self.assertRaisesRegex(ValueError,'lineage'): creation(d,'BOXP-350',second)
    def test_original_images_go_to_local_vision_then_manifest(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);vault=root/'vault';folder=vault/'ひとはこさんバース/characters';folder.mkdir(parents=True)
            note=folder/'new.md';note.write_text('---\nticket: BOXP-350\n---\nSynthetic robot. ![[original.png]]\n')
            (folder/'original.png').write_bytes(png())
            digest=hashlib.sha256(note.read_bytes()).hexdigest()
            audit={'model':'gemma4-26b','applied':[{'path':note.relative_to(vault).as_posix(),'after-sha256':digest}],'sources':[]}
            captured=[]
            def request(req,**kwargs):
                self.assertEqual(req.full_url,prepare_board_image.BASE)
                captured.append(json.loads(req.data))
                return contextlib.closing(io.BytesIO(json.dumps({'choices':[{'finish_reason':'stop','message':{'content':json.dumps({'prompt':'Synthetic new blue robot','reference_index':0,'reference_reason':'Synthetic style reference'})}}]}).encode()))
            manifest=root/'manifest.json'
            args=['prepare','--vault',str(vault),'--ticket','BOXP-350','--run','20261028T113859Z-aaaa-bbbb','--manifest',str(manifest)]
            with patch('sys.argv',args),patch('prepare_board_image.creation',return_value=audit),patch('urllib.request.urlopen',side_effect=request),contextlib.redirect_stdout(io.StringIO()):
                prepare_board_image.main()
            self.assertEqual(captured[0]['model'],'gemma4-26b-vision')
            images=[x for x in captured[0]['messages'][1]['content'] if x['type']=='image_url']
            self.assertEqual(len(images),1)
            self.assertTrue(images[0]['image_url']['url'].startswith('data:image/png;base64,'))
            self.assertEqual(json.loads(manifest.read_text())['job']['reference']['sha256'],hashlib.sha256(png()).hexdigest())
            self.assertEqual(hashlib.sha256(note.read_bytes()).hexdigest(),digest)

    def test_ambiguous_image_link_cannot_become_no_reference(self):
        with tempfile.TemporaryDirectory() as d:
            vault=Path(d);folder=vault/'ひとはこさんバース/characters';folder.mkdir(parents=True)
            note=folder/'new.md';note.write_text('synthetic')
            (folder/'original.png').write_bytes(png())
            other=vault/'ひとはこさんバース/other';other.mkdir();(other/'original.png').write_bytes(png())
            with self.assertRaisesRegex(ValueError,'ambiguous'):
                prepare_board_image.resolve_link(vault,note,'![[original.png]]')
    def test_external_absolute_and_unresolved_images_are_refused(self):
        with tempfile.TemporaryDirectory() as d:
            vault=Path(d);note=vault/'note.md';note.write_text('synthetic')
            for link in ['![original](https://example.com/original.png)', '![[/tmp/private.png]]', '![original](missing)', '![original]()', '![[]]']:
                self.assertIn(link, prepare_board_image.links(link))
                with self.assertRaises(ValueError):
                    prepare_board_image.resolve_link(vault,note,link)
    def test_text_budget_exceeded_refuses_before_model(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);folder=root/'ひとはこさんバース';folder.mkdir()
            note=folder/'new.md';note.write_text('x'*24001)
            audit={'applied':[{'path':'ひとはこさんバース/new.md','after-sha256':hashlib.sha256(note.read_bytes()).hexdigest()}],'sources':[]}
            args=['prepare','--vault',str(root),'--ticket','BOXP-350','--run','20261028T113859Z-aaaa-bbbb','--manifest',str(root/'manifest.json')]
            with patch('sys.argv',args),patch('prepare_board_image.creation',return_value=audit),patch('urllib.request.urlopen') as model:
                with self.assertRaisesRegex(ValueError,'text budget'):
                    prepare_board_image.main()
                model.assert_not_called()


if __name__=='__main__':unittest.main()
