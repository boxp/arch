"""Render matching poses without physical simulation, in two MCP batches."""
import json, os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
poses=[{}, {'ParamAngleX':-20,'ParamAngleY':-10}, {'ParamAngleX':20,'ParamAngleY':10}, {'ParamAngleX':-30}, {'ParamAngleX':30}, {'ParamHairBack':-1}, {'ParamHairBack':1}, {'ParamHairFront':-1}, {'ParamHairFront':1}]
for i in range(0,len(poses),3):
 d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':100,'top':0,'width':580,'height':650},'poses':poses[i:i+3], 'columns':3,'target_long_edge':1800})
 open('/tmp/boxp441/v6/out/v14-poses-%d.png'%i,'wb').write(imgs[0]); open('/tmp/boxp441/v6/out/v14-poses-%d.json'%i,'w').write(json.dumps(d,ensure_ascii=False,indent=2))
c.close()
# Separately render the back layer and its occluders with identical transforms.
# Alpha compositing gives an exposure estimate, not a physics simulation.
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
manifest=json.load(open('/tmp/boxp441/v6/layout/layout.json'))
ids=[x['id'] for x in manifest['layers']]
for label, pose in [('default',{}),('xminus20',{'ParamAngleX':-20,'ParamAngleY':-10}),('xplus20',{'ParamAngleX':20,'ParamAngleY':10}),('xminus30',{'ParamAngleX':-30}),('xplus30',{'ParamAngleX':30}),('backminus',{'ParamHairBack':-1}),('backplus',{'ParamHairBack':1})]:
 for part, layers in [('back',['hair_back']),('front',[i for i in ids if i!='hair_back'])]:
  d,imgs=c.call('view_render_model',{'viewport':{'mode':'canvas_rect','left':0,'top':0,'width':680,'height':650},'parameters':pose,'include_layer_ids':layers,'background':'transparent','target_long_edge':680})
  open('/tmp/boxp441/v6/out/exposure-%s-%s.png'%(label,part),'wb').write(imgs[0])
c.close()
