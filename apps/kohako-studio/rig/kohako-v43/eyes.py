"""Crossfade each eye's intermediate patch with the original eye and closed patch."""
import os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
objects=c.call('workspace_inspect',{'scope':'objects'})[0]['items']
for side,letter in [('left','L'),('right','R')]:
 mid=next(x['target'].split(':',1)[1] for x in objects if x.get('layerId')==f'eye_mid_{side}_v43')
 parent=next(x['parentId'] for x in objects if x.get('target')==f'mesh:ArtMeshEyeClose{letter}')
 c.call('object_edit_appearance',{'state':c.state(),'edits':[{'action':'bind','kind':'mesh','id':mid,'parent_id':parent,'space':'canvas'}]})
 param=f'ParamEye{letter}Open'
 for target,values in [(mid,[(0,0),(.15,0),(.4,1),(.5,1),(.75,0),(1,0)]), *[(f'ArtMesh{part}{letter}',[(0,0),(.15,1),(.4,0),(.5,0),(.75,1),(1,1)]) for part in ('Eyelash','Eyewhite','Irides')],(f'ArtMeshEyeClose{letter}',[(0,1),(.15,0),(.4,0),(1,0)])]:
  c.call('keyform_apply',{'state':c.state(),'changes':[{'op':'set','target':'mesh:'+target,'key':{param:x},'channels':{'opacity':v}} for x,v in values]})
c.close()
