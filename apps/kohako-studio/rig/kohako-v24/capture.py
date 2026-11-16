"""Render the pose sheets used for the v23/v24 comparison (static poses, no physics)."""
import json, os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
tag = sys.argv[1]
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
out = '/tmp/boxp441/v6/out/'
sheets = {
    'mouth': ({'left': 350, 'top': 265, 'width': 120, 'height': 70}, [{'ParamMouthOpenY': v} for v in [0, .1, .2, .25, .3, .4, .5, .75, 1]], 3),
    'eyes': ({'left': 310, 'top': 180, 'width': 210, 'height': 80}, [{'ParamEyeLOpen': v, 'ParamEyeROpen': v} for v in [1, .7, .5, .35, .3, .2, .1, 0]], 2),
    'poses': ({'left': 100, 'top': 0, 'width': 580, 'height': 650}, [{}, {'ParamAngleX': 20}, {'ParamAngleX': -20}, {'ParamAngleX': 30, 'ParamAngleY': -10}, {'ParamAngleX': -30, 'ParamAngleY': 10}, {'ParamAngleY': -20}, {'ParamAngleX': 20, 'ParamAngleY': 10, 'ParamAngleZ': 10, 'ParamHairBack': 1}, {'ParamEyeLOpen': 0, 'ParamEyeROpen': 0, 'ParamMouthOpenY': 0.5}, {'ParamAngleX': -20, 'ParamMouthOpenY': 1, 'ParamEyeLOpen': 0.3, 'ParamEyeROpen': 0.3}], 3),
}
for name, (vp, poses, cols) in sheets.items():
    d, imgs = c.call('view_render_poses', {'viewport': dict(mode='canvas_rect', **vp), 'poses': poses, 'columns': cols, 'target_long_edge': 1800 if name != 'poses' else 2400})
    open(out + tag + '-' + name + '.json', 'w').write(json.dumps(d, indent=2)); open(out + tag + '-' + name + '.png', 'wb').write(imgs[0])
for scope in ['objects', 'parameters', 'layers']:
    d, _ = c.call('workspace_inspect', {'scope': scope}); open(out + tag + '-' + scope + '.json', 'w').write(json.dumps(d, indent=2, default=str))
c.close(); print('captured', tag, flush=True)
