"""Move the half-mouth mesh towards the closed line at the low keys."""
import os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
d, _ = c.call('workspace_inspect', {'scope': 'objects'})
half = next(x['target'] for x in d['items'] if x.get('layerId') == 'mouth_half')
# Existing geometry is a 3x3 ParamMouthForm / ParamMouthOpenY grid.
# Move the three closed-end forms in mesh space; existing 0.5
# and 1.0 forms remain unchanged and interpolate back to the authored shape.
keys = [{'ParamMouthForm': form, 'ParamMouthOpenY': 0} for form in [-1, 0, 1]]
c.call('rig_deform', {'state': c.state(), 'changes': [{'target': half, 'key': key, 'operations': [{'type': 'translate', 'delta': [0, -.125]}]} for key in keys]})
c.close()
