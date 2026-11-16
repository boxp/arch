"""v24 eyes: the generated lid deformation closes the eye from 1 down to EPS; the generated closed-eye
patch (v16 material) takes over only below EPS, so there is no long opacity cross-fade."""
import os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
EPS = float(os.environ.get('V24_EYE_EPS', 0.15))
def setop(part, side, keys):
    c.call('keyform_apply', {'state': c.state(), 'changes': [{'op': 'set', 'target': 'mesh:ArtMesh' + part + side, 'key': {'ParamEye' + side + 'Open': v}, 'channels': {'opacity': o}} for v, o in keys]})
for s in 'LR':
    for part in ['Eyelash', 'Eyewhite', 'Irides']: setop(part, s, [(0, 0), (EPS, 1), (0.2, 1), (1, 1)])
    setop('EyeClose', s, [(0, 1), (EPS, 0), (0.2, 0), (1, 0)])
print('v24 eyes keyed, eps', EPS, flush=True)
c.close()
