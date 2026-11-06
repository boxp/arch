import json,os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live'); from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
poses=[{'ParamEyeLOpen':0,'ParamEyeROpen':0}, {'ParamEyeLOpen':0,'ParamEyeROpen':0,'ParamAngleX':-20}, {'ParamEyeLOpen':0,'ParamEyeROpen':0,'ParamAngleX':20}]
d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':300,'top':170,'width':210,'height':110},'poses':poses,'columns':3,'target_long_edge':1800});open('/tmp/boxp441/v6/out/v15e-eyes.png','wb').write(imgs[0]);open('/tmp/boxp441/v6/out/v15e-eyes.json','w').write(json.dumps(d,indent=2));c.close()
