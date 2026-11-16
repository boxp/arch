import base64
import hashlib
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'docker/codex-workspace/qwen-eval'))
from harness import png
from live import LiveAdapter


class ReferenceDispatchTest(unittest.TestCase):
    def test_original_image_bytes_and_generator_ref_reach_queue(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);(root/'original.png').write_bytes(png())
            adapter=LiveAdapter(root,root,'BOXP-349-synthetic-ref')
            adapter.reference_root=root;adapter.assert_lease=lambda:None
            contract={'id':'BOXP-350','reference':{'path':'original.png','sha256':hashlib.sha256(png()).hexdigest()}}
            requests=[]
            def ssh(code,payload,**kwargs):
                if 'reference_png' in payload:
                    requests.append(payload);return 'queued'
                return __import__('json').dumps({'metadata':{'job':requests[0]['contract'],'status':'ok'},'png':base64.b64encode(png()).decode()})
            adapter.ssh=ssh
            self.assertEqual(adapter.generate(contract),png())
            self.assertEqual(base64.b64decode(requests[0]['reference_png']),png())
            self.assertEqual(requests[0]['contract']['ref'],'/work/boxp344/BOXP-349-synthetic-ref-BOXP-350/reference.png')
            self.assertIsNone(adapter.uncertain_job)
