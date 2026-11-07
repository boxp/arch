import sys,json,time,traceback,os
sys.path.insert(0,'/tmp/boxp441/v6/psd2live'); from mcp_proxy import Client
out='/tmp/boxp441/v6/out/'
for i in range(900):
 try:
  c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240); c.tools(); break
 except Exception: time.sleep(2)
else: raise RuntimeError('MCP unavailable')
def run(op,req,key,edit=False,required=False):
 try:
  if edit: req=dict(req,state=c.state())
  d,imgs=c.call(op,req); open(out+key+'.json','w').write(json.dumps(d,ensure_ascii=False,indent=2,default=str))
  for i,b in enumerate(imgs): open(out+key+('-'+str(i) if key!='poses' else '')+'.png','wb').write(b)
  print(key,'ok',flush=True); return d
 except Exception as e:
  open(out+key+'-error.txt','w').write(traceback.format_exc()+'\n'+str(getattr(e,'detail',None))); print(key,'ERROR',e,flush=True)
  if required: raise
run('project_import_layout',{'path':'/tmp/boxp441/v6/layout/layout.json','discard_unsaved':True},'import',True,True)
run('workspace_inspect',{'scope':'layers'},'layers-before')
run('rig_generate',{'preset_group':'legacy-standard'},'rig-legacy',True,True)
# BOXP-441 TD-26: 後ろ髪の追従・揺れの数値を hair/legacy モディファイアの tuning で変える（psd2live RigTuning の項目名・単位）
tuning=json.loads(os.environ.get('V36_TUNING','{}'))
if tuning:
 st,_=c.call('modifier_stack',{}); hair=next(e for e in st['entries'] if e['type']=='hair/legacy')
 run('modifier_update',{'id':hair['id'],'type':hair['type'],'config':dict(hair['config'],tuning=tuning)},'hair-tuning',True,True)
for clip in ['Shake','Idle','Blink','Talk']: run('motion_seed_builtin',{'builtin':clip},'seed-'+clip,True,clip != 'Talk')
for part in ['Front','Back']:
 d=run('modifier_plan',{'type':'physics','preset':'PhysicsHair'+part,'targets':[{'kind':'mesh','id':'ArtMesh'+part+'Hair'}]},'physics-plan-'+part,required=True)
 if d:
  phys=json.loads(os.environ.get('V36_PHYS_'+part.upper(),'{}'))
  for entry in d['entries']:
   def merge(a,b):
    for k,v in b.items():
     if isinstance(v,dict) and isinstance(a.get(k),dict): merge(a[k],v)
     else: a[k]=v
   merge(entry,phys); run('modifier_add',entry,'physics-mod-'+part,True,True)
for clip in ['Shake','Idle','Blink','Talk']:
 d=run('modifier_plan',{'type':'motion','preset':clip,'targets':[{'kind':'mesh','id':'ArtMeshFrontHair'}]},'motion-plan-'+clip,required=True)
 if d:
  for entry in d['entries']: run('modifier_add',entry,'motion-mod-'+clip,True,True)
for scope in ['layers','parameters','objects','project','physics']: run('workspace_inspect',{'scope':scope},'final-'+scope)
run('motion_list',{},'motion-list'); run('expression_list',{},'expressions')
run('project_save_as',{'path':'/tmp/boxp441/v6/out/kohako-v6.psd2live'},'save',True,True)
run('view_render_poses',{'viewport':{'mode':'canvas_rect','left':180,'top':10,'width':400,'height':540},'poses':[{}, {'ParamAngleX':30},{'ParamAngleX':-30},{'ParamAngleY':30},{'ParamAngleY':-30},{'ParamHairFront':1},{'ParamHairFront':-1},{'ParamHairBack':1},{'ParamHairBack':-1}],'columns':3,'target_long_edge':1800},'poses')
exec(open('/tmp/boxp441/v6/pose_extra.py').read())
c.close()
