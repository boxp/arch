"""Three short crossfades; look up the generated half mesh by source layer."""
# v6 mouth_open.py sets ParamMouthOpenY=0.2/opacity 1 on mesh:ArtMeshMouthOpen. In v17 that mesh id is the mouth_half layer
# (mouth_open is ArtMeshMouthOpen2), and the half keys below overwrite 0.2 with 0.5. The open mesh also gets an explicit
# 0.2/opacity 0 key so no stale opacity-1 key can show the open mouth during the half-open crossfade.
import os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
d,_=c.call('workspace_inspect',{'scope':'objects'})
half=next(x['target'] for x in d['items'] if x.get('layerId')=='mouth_half')
open_mesh=next(x['target'] for x in d['items'] if x.get('layerId')=='mouth_open')
close_mesh=next(x['target'] for x in d['items'] if x.get('layerId')=='mouth_closed')
for target,keys in [(close_mesh,[(0,1),(.15,1),(.2,.5),(.25,0),(.6,0),(1,0)]),(half,[(0,0),(.15,0),(.2,.5),(.25,1),(.6,1),(.75,0),(1,0)]),(open_mesh,[(0,0),(.2,0),(.6,0),(.75,1),(1,1)])]:
 changes=[{'op':'set','target':target,'key':{'ParamMouthOpenY':v},'channels':{'opacity':opacity}} for v,opacity in keys]
 c.call('keyform_apply',{'state':c.state(),'changes':changes})
c.close()
