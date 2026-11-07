import os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
for target, values in [('ArtMeshMouthOpen', [(0,0),(.08,1),(1,1)]), ('ArtMeshFaceDetail', [(0,1),(.08,0),(1,0)])]:
    changes = [{'op':'set','target':'mesh:'+target,'key':{'ParamMouthOpenY':x},'channels':{'opacity':v}} for x,v in values]
    print(target, c.call('keyform_apply', {'state':c.state(), 'changes':changes})[0], flush=True)
c.close()
