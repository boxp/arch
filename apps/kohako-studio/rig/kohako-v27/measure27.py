import sys,os,json,time
sys.path.insert(0,'/tmp/boxp441/v6/psd2live'); from mcp_proxy import Client
for i in range(120):
 try:
  c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240); c.tools();break
 except Exception: time.sleep(2)
else: raise Exception('server unavailable')
c.call('project_open',{'state':c.state(),'path':'/tmp/boxp441/v26/out/kohako-v6.psd2live','discard_unsaved':True})
poses=[{}, {'ParamAngleX':30},{'ParamAngleX':-30},{'ParamAngleY':30},{'ParamAngleY':-30},{'ParamAngleX':30,'ParamAngleY':20},{'ParamAngleX':-30,'ParamAngleY':-20}]
for m in ['ArtMeshBackHair','ArtMeshFrontHairL','ArtMeshFrontHairR']:
 for pose in poses:
  points=[]; offset=0
  while True:
   d,_=c.call('debug_mesh_points',{'target':'mesh:'+m,'coordinate':pose,'offset':offset,'limit':256});points+=d['points']
   if 'nextOffset' not in d: break
   offset=d['nextOffset']
  print(json.dumps({'mesh':m,'pose':pose,'points':points}),flush=True)
c.close()
