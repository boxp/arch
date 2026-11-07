"""第2案: mouth.py と第1案の不透明度適用後に実行。変更なしと判定された。"""
import os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
change = {'op':'reset', 'to':'rest', 'target':'mesh:ArtMeshMouthOpen', 'key':{'ParamMouthOpenY':1, 'ParamMouthForm':0}, 'vertices':[0,1,2,3,4,10]}
print(c.call('keyform_apply', {'state':c.state(), 'changes':[change]})[0])
c.close()
