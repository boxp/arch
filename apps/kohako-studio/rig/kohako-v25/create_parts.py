"""v25: v23 の閉口素材を FACE_DETAIL として戻し、v24 の髪飾り修正を適用。"""
import json, shutil
from pathlib import Path
p = Path('/tmp/boxp441'); src = p / 'v23/layout'; dst = p / 'v6/layout'
assert (src / 'layout.json').exists(), 'v23 layout missing'
if dst.exists(): shutil.rmtree(dst)
shutil.copytree(src, dst)
m = json.loads((dst / 'layout.json').read_text())
dropped = [l for l in m['layers'] if l['id'] == 'mouth_half']
for l in m['layers']:
    if l['id'] == 'mouth_closed':
        l['id'] = 'face_smile'; l['name'] = 'face smile'; l['tags'] = ['face', 'detail']
for l in dropped:
    m['layers'].remove(l); (dst / l['image']['path']).unlink(missing_ok=True)
m['name'] = 'kohako-v25'
(dst / 'layout.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
import subprocess, sys
subprocess.check_call([sys.executable, str(Path(__file__).with_name('orn_fix.py')), str(dst), str(p / 'v6/out/v24-orn-debug')])  # TD-22 ornament underlay fix
(p / 'v6/out').mkdir(parents=True, exist_ok=True)
(p / 'v6/out/v24-parts.json').write_text(json.dumps({'dropped': [l['id'] for l in dropped], 'layers': [l['id'] for l in m['layers']]}, indent=2))
print('v25 dropped', [l['id'] for l in dropped], flush=True)
