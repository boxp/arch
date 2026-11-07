import json, os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
out = '/tmp/boxp441/v6/out/'
poses = [{'ParamMouthOpenY': v, 'ParamAngleX': a} for a in (0, -30, 30) for v in (0, .02, .04, .06, .08, .25, .5, 1)]
def capture(name):
    for angle in range(3):
        for suffix, viewport, edge in [('mouth', dict(mode='canvas_rect', left=350, top=265, width=120, height=70), 1920), ('full', dict(mode='canvas_rect', left=100, top=0, width=580, height=650), 1740)]:
            d, imgs = c.call('view_render_poses', {'viewport': viewport, 'poses': poses[angle*8:(angle+1)*8], 'columns': 3, 'target_long_edge': edge})
            open(out + name + '-' + suffix + str(angle) + '.png', 'wb').write(imgs[0])
            open(out + name + '-' + suffix + str(angle) + '.json', 'w').write(json.dumps(d, indent=2))
points, _ = c.call('debug_mesh_points', {'target':'mesh:ArtMeshMouthOpen', 'coordinate':{'ParamMouthOpenY':1}, 'limit':256})
open(out + 'mouth39-points.json', 'w').write(json.dumps(points, indent=2))
capture('before39')
for target, values in [('ArtMeshMouthOpen', [(0,0),(.03,1),(.08,1),(1,1)]), ('ArtMeshFaceDetail', [(0,1),(.03,0),(.08,0),(1,0)])]:
    changes = [{'op':'set','target':'mesh:'+target,'key':{'ParamMouthOpenY':x},'channels':{'opacity':v}} for x,v in values]
    print(target, c.call('keyform_apply', {'state':c.state(), 'changes':changes})[0], flush=True)
capture('after39')
for target, values in [('ArtMeshMouthOpen', [(0,0),(.01,0),(.03,1),(.08,1),(1,1)]), ('ArtMeshFaceDetail', [(0,1),(.01,0),(.03,0),(.08,0),(1,0)])]:
    changes = [{'op':'set','target':'mesh:'+target,'key':{'ParamMouthOpenY':x},'channels':{'opacity':v}} for x,v in values]
    print('sequential', target, c.call('keyform_apply', {'state':c.state(), 'changes':changes})[0], flush=True)
capture('after39c')
d, imgs = c.call('view_render_poses', {'viewport':dict(mode='canvas_rect',left=350,top=265,width=120,height=70), 'poses':[{'ParamMouthOpenY':v} for v in (0,.005,.01,.015,.02,.03)], 'columns':3, 'target_long_edge':1800})
open(out+'transition39.png','wb').write(imgs[0])
open(out+'transition39.json','w').write(json.dumps(d,indent=2))
c.close()
