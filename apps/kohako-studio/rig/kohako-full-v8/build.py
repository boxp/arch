import sys,os,json,time,traceback
from pathlib import Path
sys.path.insert(0,os.environ['P2L']); from mcp_proxy import Client
out=Path(os.environ['OUT']); out.mkdir(parents=True,exist_ok=True)
for i in range(300):
 try:
  c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=300); c.tools(); break
 except Exception: time.sleep(2)
else: raise RuntimeError('MCP unavailable')
def run(op,req,key,edit=False,required=False):
 try:
  if edit: req=dict(req,state=c.state())
  d,imgs=c.call(op,req); (out/(key+'.json')).write_text(json.dumps(d,ensure_ascii=False,indent=2,default=str))
  for i,b in enumerate(imgs): (out/(key+('-'+str(i) if i else '')+'.png')).write_bytes(b)
  print(key,'ok',flush=True); return d
 except Exception:
  (out/(key+'-error.txt')).write_text(traceback.format_exc()); print(key,'failed',flush=True)
  if required: raise
run('project_import_layout',{'path':str(out.parent/'layout/layout.json'),'discard_unsaved':True},'import',True,True)
run('rig_generate',{'preset_group':'legacy-standard'},'rig',True,True)
run('skeleton_propose',{},'skeleton-propose')
run('skeleton_auto',{},'skeleton-auto',True)
for clip in ['Shake','Idle','Blink','Talk']: run('motion_seed_builtin',{'builtin':clip},'seed-'+clip,True)
for part in ['Front','Back']:
 d=run('modifier_plan',{'type':'physics','preset':'PhysicsHair'+part,'targets':[{'kind':'mesh','id':'ArtMesh'+part+'Hair'}]},'physics-plan-'+part)
 if d:
  for i,entry in enumerate(d.get('entries',[])): run('modifier_add',entry,'physics-'+part+str(i),True)
for clip in ['Shake','Idle','Blink','Talk']:
 d=run('modifier_plan',{'type':'motion','preset':clip,'targets':[{'kind':'mesh','id':'ArtMeshFrontHair'}]},'motion-plan-'+clip)
 if d:
  for i,entry in enumerate(d.get('entries',[])): run('modifier_add',entry,'motion-'+clip+str(i),True)
# Preserve the source mouth at rest while the generated mouth-open mesh is hidden.
for target,values in [('ArtMeshMouthOpen',[(0,0),(.08,1),(1,1)]),('ArtMeshFaceDetail',[(0,1),(.08,0),(1,0)])]:
 changes=[{'op':'set','target':'mesh:'+target,'key':{'ParamMouthOpenY':v},'channels':{'opacity':o}} for v,o in values]
 run('keyform_apply',{'changes':changes},'mouth-key-'+target,True,True)
for scope in ['parameters','layers','objects','physics']: run('workspace_inspect',{'scope':scope},scope)
run('motion_list',{},'motions')
run('project_save_as',{'path':str(out/'kohako-full-v8.psd2live')},'save',True,True)
poses=[{}, {'ParamAngleX':30},{'ParamAngleX':-30},{'ParamAngleY':20},{'ParamAngleY':-20},{'ParamBodyAngleX':10},{'ParamBodyAngleX':-10},{'ParamEyeLOpen':0,'ParamEyeROpen':0},{'ParamEyeLOpen':.15,'ParamEyeROpen':.15},{'ParamEyeLOpen':.5,'ParamEyeROpen':.5},{'ParamEyeLOpen':1,'ParamEyeROpen':1},{'ParamMouthOpenY':0},{'ParamMouthOpenY':.25},{'ParamMouthOpenY':.5},{'ParamMouthOpenY':1},{'ParamHairBack':1},{'ParamHairBack':-1},{'ParamAngleX':30,'ParamBodyAngleX':10}]
for i in range(0,len(poses),5):
 run('view_render_poses',{'viewport':{'mode':'canvas_rect','left':0,'top':0,'width':1143,'height':2048},'poses':poses[i:i+5],'columns':min(3,len(poses[i:i+5])),'target_long_edge':2000},'poses-'+str(i//5),required=True)
c.close()
