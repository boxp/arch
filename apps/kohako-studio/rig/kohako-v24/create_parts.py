"""v24: let psd2live's fitted mouth drive ParamMouthOpenY from the original open mouth alone.

Diagnosis (TD-21, run 20261107T005232Z): the hand-added closed-line (v6/v16) and half-open (v17)
mouth layers were cross-faded by opacity keys, but the generator's closed-line swap keeps the
MOUTH_CLOSE layer visible up to mid openness regardless of those keys, so every value between
0.1 and 0.5 showed two lip lines. With only the open mouth, the generator closes it by mesh
deformation and the sweep 0 -> 1 is continuous. Eyes keep the generated closed patch (v16) but
only as a swap at the very end of the blink (see eyes.py). Hair split of v23 is kept; orn_fix.py removes the
ornament-shaped hair fill that body/hair_back inherited from the cut-out (TD-22).
Run after kohako-v23/create_parts.py (the v23 layout must be in /tmp/boxp441/v23/layout).
"""
import json, shutil
from pathlib import Path
p = Path('/tmp/boxp441'); src = p / 'v23/layout'; dst = p / 'v6/layout'
assert (src / 'layout.json').exists(), 'v23 layout missing'
if dst.exists(): shutil.rmtree(dst)
shutil.copytree(src, dst)
m = json.loads((dst / 'layout.json').read_text())
dropped = [l for l in m['layers'] if l['id'] in ('mouth_closed', 'mouth_half')]
for l in dropped:
    m['layers'].remove(l); (dst / l['image']['path']).unlink(missing_ok=True)
m['name'] = 'kohako-v24'
(dst / 'layout.json').write_text(json.dumps(m, ensure_ascii=False, indent=2) + '\n')
import subprocess, sys
subprocess.check_call([sys.executable, str(Path(__file__).with_name('orn_fix.py')), str(dst), str(p / 'v6/out/v24-orn-debug')])  # TD-22 ornament underlay fix
(p / 'v6/out').mkdir(parents=True, exist_ok=True)
(p / 'v6/out/v24-parts.json').write_text(json.dumps({'dropped': [l['id'] for l in dropped], 'layers': [l['id'] for l in m['layers']]}, indent=2))
print('v24 dropped', [l['id'] for l in dropped], flush=True)
