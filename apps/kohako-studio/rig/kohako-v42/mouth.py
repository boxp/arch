import os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
objects=c.call('workspace_inspect', {'scope':'objects'})[0]['items']
mid=next(x['target'].split(':',1)[1] for x in objects if x.get('layerId')=='face_mid_v42')
closed=next(x['target'].split(':',1)[1] for x in objects if x.get('layerId')=='face_smile')
parent=next(x['parentId'] for x in objects if x.get('target')=='mesh:ArtMeshMouthOpen')
result=c.call('object_edit_appearance', {'state':c.state(), 'edits':[{'action':'bind','kind':'mesh','id':mid,'parent_id':parent,'space':'canvas'}]})[0]
print('reparent',result,flush=True)
for target, values in [('ArtMeshMouthOpen', [(0,0),(.04,0),(.25,0),(.35,1),(1,1)]), (closed, [(0,1),(.04,0),(1,0)]), (mid, [(0,0),(.04,1),(.25,1),(.35,0),(1,0)])]:
    changes = [{'op':'set','target':'mesh:'+target,'key':{'ParamMouthOpenY':x},'channels':{'opacity':v}} for x,v in values]
    result=c.call('keyform_apply', {'state':c.state(), 'changes':changes})[0]
    print(target, result, flush=True)
c.close()
