"""Capture v38, then test a sequential eye-material transition."""
import json, os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
out = '/tmp/boxp441/v6/out/'
angles = [{}, {'ParamAngleX':-30}, {'ParamAngleX':30}, {'ParamAngleY':-20}, {'ParamAngleY':20}]
values = [1,.75,.5,.3,.15,.1,0]
def capture(tag):
 for i, angle in enumerate(angles):
  poses = [dict(angle, ParamEyeLOpen=v, ParamEyeROpen=v) for v in values]
  for name, vp, edge in [('eyes',dict(mode='canvas_rect',left=300,top=160,width=230,height=120),1610),('full',dict(mode='canvas_rect',left=100,top=0,width=580,height=650),1300)]:
   d, imgs = c.call('view_render_poses', {'viewport':vp,'poses':poses,'columns':3,'target_long_edge':edge})
   with open(f'{out}{tag}-{name}{i}.png','wb') as f: f.write(imgs[0])
   with open(f'{out}{tag}-{name}{i}.json','w') as f: json.dump(d,f,indent=2)
capture('before40')
for side in 'LR':
 for part, keys in [('Eyelash',[(0,0),(.1,0),(.12,0),(.15,1),(.2,1),(1,1)]),('Eyewhite',[(0,0),(.1,0),(.12,0),(.15,1),(.2,1),(1,1)]),('Irides',[(0,0),(.1,0),(.12,0),(.15,1),(.2,1),(1,1)]),('EyeClose',[(0,1),(.1,1),(.12,0),(.15,0),(.2,0),(1,0)])]:
  changes=[{'op':'set','target':'mesh:ArtMesh'+part+side,'key':{'ParamEye'+side+'Open':v},'channels':{'opacity':o}} for v,o in keys]
  print(part,side,c.call('keyform_apply',{'state':c.state(),'changes':changes})[0],flush=True)
capture('after40')
d, imgs = c.call('view_render_poses', {'viewport':dict(mode='canvas_rect',left=300,top=160,width=230,height=120), 'poses':[{'ParamEyeLOpen':v,'ParamEyeROpen':v} for v in (.1,.11,.12,.13,.15)],'columns':3,'target_long_edge':1610})
with open(out+'transition40.png','wb') as f: f.write(imgs[0])
with open(out+'transition40.json','w') as f: json.dump(d,f,indent=2)
c.close()
