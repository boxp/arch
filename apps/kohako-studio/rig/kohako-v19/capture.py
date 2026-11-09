import json, os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
out='/tmp/boxp441/v6/out/'
values=[0,.1,.15,.2,.25,.3,.4,.5,.75,1]
def capture(name,rect,poses):
    left,top,width,height=rect
    d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':left,'top':top,'width':width,'height':height},'poses':poses,'columns':3,'target_long_edge':1800})
    open(out+'v19-'+name+'.json','w').write(json.dumps(d,indent=2));open(out+'v19-'+name+'.png','wb').write(imgs[0])
for i in range(0,30,3):
    poses=[{'ParamMouthOpenY':values[j%10],'ParamAngleX':[0,-20,20][j//10]} for j in range(i,i+3)]
    capture('mouth-'+str(i//3),(350,265,120,70),poses)
capture('full',(100,0,580,650),[{},*({'ParamAngleX':x,'ParamAngleY':y} for x,y in [(-20,-10),(-20,10),(20,-10),(20,10)])])
c.close()
