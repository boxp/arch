import json,os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
tag=sys.argv[1]
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
out='/tmp/boxp441/v6/out/'
poses=[{},{'ParamAngleX':20},{'ParamAngleX':-20},{'ParamAngleX':30,'ParamAngleY':-10},{'ParamAngleX':-30,'ParamAngleY':10},{'ParamAngleY':-20},{'ParamAngleX':20,'ParamAngleY':10,'ParamAngleZ':10,'ParamHairBack':1},{'ParamHairBack':1,'ParamHairFront':1},{'ParamHairBack':-1,'ParamHairFront':-1}]
d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':100,'top':0,'width':580,'height':650},'poses':poses,'columns':3,'target_long_edge':2400})
open(out+tag+'-poses.json','w').write(json.dumps(d,indent=2));open(out+tag+'-poses.png','wb').write(imgs[0])
for scope in ['objects','parameters','layers']:
    d,_=c.call('workspace_inspect',{'scope':scope}); open(out+tag+'-'+scope+'.json','w').write(json.dumps(d,indent=2,default=str))
c.close(); print('captured',tag,flush=True)
