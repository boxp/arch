"""v26: no shoulder split. The chest-length hair layers stay whole (v17 layout) and follow the head,
and hair.py later keys a counter-shift on the vertices below the shoulder so the follow fades to
zero on the body (a gradient instead of v23's hard split, which left a step/kink at the shoulder line
in every head turn; TD-23 video evidence). Mouth/eyes/ornament handling is the same as v25.
Run after kohako-v17 (the v17 layout must be in /tmp/boxp441/v17/layout). No new images.
"""
import json, shutil, subprocess, sys
from pathlib import Path
p = Path('/tmp/boxp441'); src = p / 'v17/layout'; dst = p / 'v6/layout'
assert (src / 'layout.json').exists(), 'v17 layout missing'
if dst.exists(): shutil.rmtree(dst)
shutil.copytree(src, dst)
m = json.loads((dst / 'layout.json').read_text())
dropped = [l for l in m['layers'] if l['id'] == 'mouth_half']
for l in m['layers']:
    if l['id'] == 'mouth_closed':
        l['id'] = 'face_smile'; l['name'] = 'face smile'; l['tags'] = ['face', 'detail']
for l in dropped:
    m['layers'].remove(l); (dst / l['image']['path']).unlink(missing_ok=True)
m['name'] = 'kohako-v26'
(dst / 'layout.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
subprocess.check_call([sys.executable, str(Path(__file__).parent.parent / 'kohako-v25' / 'orn_fix.py'), str(dst), str(p / 'v6/out/v26-orn-debug')])  # TD-22 ornament underlay fix
(p / 'v6/out').mkdir(parents=True, exist_ok=True)
(p / 'v6/out/v26-parts.json').write_text(json.dumps({'dropped': [l['id'] for l in dropped], 'layers': [l['id'] for l in m['layers']]}, indent=2))
print('v26 parts', [l['id'] for l in m['layers']], flush=True)
