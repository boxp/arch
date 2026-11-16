import os,sys,json,time
sys.path.insert(0,'/work/psd2live');from mcp_proxy import Client
for _ in range(240):
 try:c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=300);c.tools();break
 except Exception:time.sleep(2)
else:raise RuntimeError('MCP unavailable')
def run(op,req):
 d,_=c.call(op,req);open('/work/edit-'+op+'.json','w').write(json.dumps(d,ensure_ascii=False,indent=2));print(op,'ok',flush=True);return d
run('project_open',{'path':'/work/baseline.psd2live','discard_unsaved':True,'state':c.state()})
g=json.load(open('/work/rest-geom.json'));v=next(m['v'] for m in g['meshes'] if m['id']=='ArtMeshBackHair');indices=[i//2 for i in range(0,len(v),2) if v[i+1]<430];print('selected vertices',len(indices),flush=True)
for param,extreme,shift in [('ParamAngleX',30,18),('ParamBodyAngleX',10,20)]:
 shapes=[]
 for sign in [-1,1]:shapes.append({'target':'mesh:ArtMeshBackHair','value':sign*extreme,'operations':[{'type':'translate','delta':[-sign*shift,0]}],'selection':{'indices':indices,'soft_radius':.12,'falloff':'smooth'}})
 run('author_axis',{'state':c.state(),'parameter':{'id':param},'shapes':shapes})
run('project_save_as',{'state':c.state(),'path':'/work/kohako-full-v10i.psd2live'})
c.close()
