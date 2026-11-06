import sys,os,json
sys.path.insert(0,'/tmp/boxp441/v6/psd2live');from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240);out='/tmp/boxp441/v6/out/'
d,_=c.call('project_save_as',{'state':c.state(),'path':'/tmp/boxp441/v6/out/kohako-v6.psd2live'});open(out+'save-final.json','w').write(json.dumps(d,indent=2));print('saved',flush=True)
exec(open('/tmp/boxp441/v6/pose_extra.py').read())
d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':180,'top':10,'width':400,'height':540},'poses':[{}, {'ParamAngleX':30},{'ParamAngleX':-30},{'ParamAngleY':30},{'ParamAngleY':-30},{'ParamHairFront':1},{'ParamHairFront':-1},{'ParamHairBack':1},{'ParamHairBack':-1}],'columns':3,'target_long_edge':1800});open(out+'poses.png','wb').write(imgs[0]);open(out+'poses-final.json','w').write(json.dumps(d,indent=2));c.close();print('rendered',flush=True)
