"""Crossfade each eye's intermediate patch with the original eye and closed patch."""
import os,sys
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
objects=c.call('workspace_inspect',{'scope':'objects'})[0]['items']
assert next(x['target'] for x in objects if x.get('layerId') == 'face_smile') == 'mesh:ArtMeshFaceDetail', 'mouth target must remain face_smile'
width=float(os.environ.get('V45_WIDTH','0.004'))
low=float(os.environ.get('V45_LOW','0.11'));high=float(os.environ.get('V45_HIGH','0.59'))
lo0,lo1=low-width/2,low+width/2
hi0,hi1=high-width/2,high+width/2
for side,letter in [('left','L'),('right','R')]:
 mid=next(x['target'].split(':',1)[1] for x in objects if x.get('layerId')==f'eye_mid_{side}_v44')
 parent=next(x['parentId'] for x in objects if x.get('target')==f'mesh:ArtMeshEyeClose{letter}')
 c.call('object_edit_appearance',{'state':c.state(),'edits':[{'action':'bind','kind':'mesh','id':mid,'parent_id':parent,'space':'canvas'}]})
 param=f'ParamEye{letter}Open'
 for target,values in [(mid,[(0,0),(lo0,0),(lo1,1),(hi0,1),(hi1,0),(1,0)]), *[(f'ArtMesh{part}{letter}',[(0,0),(hi0,0),(hi1,1),(1,1)]) for part in ('Eyelash','Eyewhite','Irides')],(f'ArtMeshEyeClose{letter}',[(0,1),(lo0,1),(lo1,0),(1,0)])]:
  c.call('keyform_apply',{'state':c.state(),'changes':[{'op':'set','target':'mesh:'+target,'key':{param:x},'channels':{'opacity':v}} for x,v in values]})
c.close()
