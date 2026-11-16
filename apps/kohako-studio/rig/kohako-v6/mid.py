import sys,os
sys.path.insert(0,'/tmp/boxp441/v6/psd2live');from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
for side in 'LR':
 for part in ['Eyelash','Eyewhite','Irides','EyeClose']:
  target='mesh:ArtMesh'+part+side;param='ParamEye'+side+'Open'
  try:
   change={'op':'set','target':target,'key':{param:0.2},'channels':{'opacity':0 if part=='EyeClose' else 1}}
   d,_=c.call('keyform_apply',{'state':c.state(),'changes':[change]}); print(target,'OK',flush=True)
  except Exception as e:print(target,'ERROR',e,getattr(e,'detail',None),flush=True); raise
d,imgs=c.call('view_render_poses',{'viewport':{'mode':'canvas_rect','left':280,'top':140,'width':250,'height':190},'poses':[{'ParamEyeLOpen':v,'ParamEyeROpen':v} for v in [1,.5,.2,0]],'columns':2,'target_long_edge':1800});open('/tmp/boxp441/v6/out/mid-check.png','wb').write(imgs[0]);c.close()
