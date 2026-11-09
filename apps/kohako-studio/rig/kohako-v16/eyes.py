"""Short opacity transition for the generated closed eyes."""
import os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
for side in 'LR':
 for part in ['Eyelash','Eyewhite','Irides','EyeClose']:
  param='ParamEye'+side+'Open'; closed=part=='EyeClose'
  changes=[{'op':'set','target':'mesh:ArtMesh'+part+side,'key':{param:v},'channels':{'opacity':(1 if closed else 0) if v<=.3 else (0 if closed else 1)}} for v in [0,.2,.3,.35,1]]
  c.call('keyform_apply',{'state':c.state(),'changes':changes})
# The closed patch contains skin; explicitly hide it at the open endpoint.
for part,keys in [('MouthClose',[(0,1),(.2,0),(1,0)]),('MouthOpen',[(0,0),(.2,1),(1,1)])]:
 changes=[{'op':'set','target':'mesh:ArtMesh'+part,'key':{'ParamMouthOpenY':v},'channels':{'opacity':opacity}} for v,opacity in keys]
 c.call('keyform_apply',{'state':c.state(),'changes':changes})
c.close()
