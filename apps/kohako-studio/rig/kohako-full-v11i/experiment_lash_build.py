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
# Resolve the generated mesh IDs by imported layer, and require each edit.
objects=run('workspace_inspect',{'scope':'objects'},'objects-before',required=True)['items']
def mesh(layer):
 matches=[x for x in objects if x.get('layerId')==layer]
 assert len(matches)==1,(layer,matches)
 return matches[0]['target']
# Bind the extracted patch to the same physics deformer as the front hair.
corner = mesh('hair_front_corner')
front = mesh('hair_front')
front_parent = next(x['parentId'] for x in objects if x.get('target') == front)
run('object_edit_appearance', {'edits':[{'action':'bind','kind':'mesh','id':corner.split(':',1)[1],'parent_id':front_parent,'space':'canvas'}]}, 'bind-corner', True, True)
for side,letter in [('left','L'),('right','R')]:
 mid=mesh('eye_mid_'+side+'_v44'); closed=mesh('eye_closed_'+side)
 parent=next(x['parentId'] for x in objects if x.get('target')==closed)
 run('object_edit_appearance',{'edits':[{'action':'bind','kind':'mesh','id':mid.split(':',1)[1],'parent_id':parent,'space':'canvas'}]},'bind-'+side,True,True)
 lower=mesh('lash_lower_'+side); lash=mesh('eye_'+side+'_lash')
 lash_parent=next(x['parentId'] for x in objects if x.get('target')==lash)
 run('object_edit_appearance',{'edits':[{'action':'bind','kind':'mesh','id':lower.split(':',1)[1],'parent_id':lash_parent,'space':'canvas'}]},'bind-lower-'+side,True,True)
 param='ParamEye'+letter+'Open'
 run('keyform_apply',{'changes':[{'op':'set','target':lower,'key':{param:x},'channels':{'opacity':v}} for x,v in [(0,0),(.89,0),(.90,1),(1,1)]]},'lower-'+side,True,True)
 param='ParamEye'+letter+'Open'; lo0,lo1,hi0,hi1=.133,.137,.598,.602
 targets=[(mid,[(0,0),(lo0,0),(lo1,1),(hi0,1),(hi1,0),(1,0)]),(closed,[(0,1),(lo0,1),(lo1,0),(1,0)])]
 for part in ['white','iris','lash']: targets.append((mesh('eye_'+side+'_'+part),[(0,0),(hi0,0),(hi1,1),(1,1)]))
 for j,(target,values) in enumerate(targets):
  run('keyform_apply',{'changes':[{'op':'set','target':target,'key':{param:x},'channels':{'opacity':v}} for x,v in values]},'eye-'+side+str(j),True,True)
# Three unique detail meshes; narrow transitions avoid visible double lines.
detail_layers=['face_smile','mouth_mid','mouth_open','face_brow','eye_mid_left_v44','eye_mid_right_v44']
assert len({mesh(x) for x in detail_layers}) == len(detail_layers)
for target,values in [(mesh('face_smile'),[(0,1),(.10,1),(.12,0),(1,0)]),(mesh('mouth_mid'),[(0,0),(.10,0),(.12,1),(.50,1),(.55,0),(1,0)]),(mesh('mouth_open'),[(0,0),(.50,0),(.55,1),(1,1)])]:
 changes=[{'op':'set','target':target,'key':{'ParamMouthOpenY':v},'channels':{'opacity':o}} for v,o in values]
 run('keyform_apply',{'changes':changes},'mouth-key-'+target.replace(':','-'),True,True)
for scope in ['parameters','layers','objects','physics']: run('workspace_inspect',{'scope':scope},scope)
run('motion_list',{},'motions')
run('project_save_as',{'path':str(out/'kohako-full-v11i.psd2live')},'save',True,True)
poses=[{}, {'ParamAngleX':30},{'ParamAngleX':-30},{'ParamAngleY':20},{'ParamAngleY':-20},{'ParamBodyAngleX':10},{'ParamBodyAngleX':-10},{'ParamEyeLOpen':0,'ParamEyeROpen':0},{'ParamEyeLOpen':.15,'ParamEyeROpen':.15},{'ParamEyeLOpen':.5,'ParamEyeROpen':.5},{'ParamEyeLOpen':1,'ParamEyeROpen':1},{'ParamMouthOpenY':0},{'ParamMouthOpenY':.25},{'ParamMouthOpenY':.5},{'ParamMouthOpenY':1},{'ParamHairBack':1},{'ParamHairBack':-1},{'ParamAngleX':30,'ParamBodyAngleX':10}]
for i in range(0,len(poses),5):
 run('view_render_poses',{'viewport':{'mode':'canvas_rect','left':0,'top':0,'width':1143,'height':2048},'poses':poses[i:i+5],'columns':min(3,len(poses[i:i+5])),'target_long_edge':2000},'poses-'+str(i//5),required=True)
c.close()
