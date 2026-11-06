import sys,os
sys.path.insert(0,'/tmp/boxp441/v6/psd2live');from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
d,_=c.call('keyform_apply',{'state':c.state(),'changes':[{'op':'set','target':'mesh:ArtMeshMouthClose','key':{'ParamMouthOpenY':0.2},'channels':{'opacity':0}}]});print(d,flush=True)
d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':280,'top':140,'width':250,'height':190},'poses':[{'ParamMouthOpenY':v} for v in [0,.1,.2,.5,1]],'columns':3,'target_long_edge':1800});open('/tmp/boxp441/v6/out/mouth-check.png','wb').write(imgs[0]);c.close()
