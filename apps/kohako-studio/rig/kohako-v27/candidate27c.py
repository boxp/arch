import sys,os,json,statistics,collections,math
sys.path.insert(0,'/tmp/boxp441/v6/psd2live');from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
c.call('project_open',{'state':c.state(),'path':'/tmp/boxp441/v26/out/kohako-v6.psd2live','discard_unsaved':True})
data=[json.loads(l) for l in open('/tmp/boxp441/measure27.jsonl')]
for axis in ['ParamAngleX','ParamAngleY']:
 shapes=[]
 for mesh in ['ArtMeshBackHair','ArtMeshFrontHairL','ArtMeshFrontHairR']:
  topo,_=c.call('mesh_get_topology',{'target':'mesh:'+mesh,'limit':4096}); local=topo['items'];bounds=topo['bounds']
  rows=[r for r in data if r['mesh']==mesh];rest=next(r['points'] for r in rows if not r['pose'])
  slope=[statistics.covariance([v[k] for v in local],[v[k] for v in rest])/statistics.variance([v[k] for v in local]) for k in (1,2)]
  for value in [30,-30]:
   posed=next(r['points'] for r in rows if r['pose']=={axis:value}); groups=collections.defaultdict(list)
   for i,((_,x,y),(_,px,py)) in enumerate(zip(rest,posed)):
    if y >= 315: groups[int((y-315)//20)].append((i,y,px-x,py-y))
   ops=[]
   for grp in groups.values():
    y=statistics.mean(a[1] for a in grp);w=max(0,min(1,(y-315)/80));w=w*w*(3-2*w)
    dx=-statistics.mean(a[2] for a in grp)*w*250;dy=-statistics.mean(a[3] for a in grp)*w*250
    ops.append({'type':'translate','delta':[dx/(slope[0]*(bounds[2]-bounds[0])),dy/(slope[1]*(bounds[3]-bounds[1]))],'selection':{'indices':[a[0] for a in grp]}})
   shapes.append({'target':'mesh:'+mesh,'value':value,'operations':ops})
 print('apply',axis,flush=True)
 r,_=c.call('author_axis',{'state':c.state(),'parameter':{'id':axis},'shapes':shapes});print(json.dumps(r),flush=True)
c.call('project_save_as',{'state':c.state(),'path':'/tmp/boxp441/v27c/out/kohako-v6.psd2live'})
c.close()
