import json,os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
proj,tag=sys.argv[1:3]
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
d,_=c.call('project_open',{'state':c.state(),'path':proj,'discard_unsaved':True})
poses=[{},{'ParamAngleX':20},{'ParamAngleX':-20},{'ParamAngleX':30,'ParamAngleY':-10},{'ParamAngleX':-30,'ParamAngleY':10},{'ParamAngleX':20,'ParamAngleY':10,'ParamAngleZ':10,'ParamHairBack':1}]
d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':140,'top':290,'width':420,'height':230},'poses':poses,'columns':3,'target_long_edge':2400})
open('/tmp/boxp441/v6/out/'+tag+'-band.png','wb').write(imgs[0]); c.close(); print('band',tag,flush=True)
