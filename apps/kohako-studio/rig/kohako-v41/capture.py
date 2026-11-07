"""Static model capture of eye and mouth values at each requested head angle."""
import json, os, sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
out='/tmp/boxp441/v6/out/'
angles=[{}, {'ParamAngleX':-30}, {'ParamAngleX':30}, {'ParamAngleY':-20}, {'ParamAngleY':20}]
for i,angle in enumerate(angles):
 for name,values,vp in [('eyes',[1,.75,.5,.3,.15,.1,0],dict(left=300,top=160,width=230,height=120)),('mouth',[0,.04,.1,.25,.5,1],dict(left=350,top=265,width=120,height=70))]:
  poses=[dict(angle,**({'ParamEyeLOpen':v,'ParamEyeROpen':v} if name=='eyes' else {'ParamMouthOpenY':v})) for v in values]
  for kind,viewport,edge in [(name,vp,1610),('full-'+name,dict(left=100,top=0,width=580,height=650),1300)]:
   d,imgs=c.call('view_render_poses',{'viewport':dict(mode='canvas_rect',**viewport),'poses':poses,'columns':3,'target_long_edge':edge})
   open(f'{out}v41-{kind}{i}.png','wb').write(imgs[0]);open(f'{out}v41-{kind}{i}.json','w').write(json.dumps(d,indent=2))
c.close()
