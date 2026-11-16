import json,os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
out='/tmp/boxp441/v6/out/'
for name,rect,poses in [
 ('v17-eyes',(300,170,210,110),[{'ParamEyeLOpen':v,'ParamEyeROpen':v} for v in [1,.5,.3,.2,0]]),
 ('v17-mouth',(350,265,120,70),[{'ParamMouthOpenY':v} for v in [0,.15,.25,.4,.5,.75,1]]+[{'ParamMouthOpenY':0,'ParamAngleX':v} for v in [-20,20]]),
 ('v17-full',(100,0,580,650),[{},*({'ParamAngleX':x,'ParamAngleY':y} for x,y in [(-20,-10),(-20,10),(20,-10),(20,10)])])]:
 left,top,width,height=rect
 d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':left,'top':top,'width':width,'height':height},'poses':poses,'columns':3,'target_long_edge':1800})
 open(out+name+'.json','w').write(json.dumps(d,indent=2));open(out+name+'.png','wb').write(imgs[0])
c.close()
