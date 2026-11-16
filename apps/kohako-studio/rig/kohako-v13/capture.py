"""Capture nine equivalent bust poses plus four compound extremes."""
import json, os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
out = '/tmp/boxp441/v6/out/'
poses = [{}, {'ParamAngleX':30}, {'ParamAngleX':-30}, {'ParamAngleY':30}, {'ParamAngleY':-30}, {'ParamHairBack':1}, {'ParamHairBack':-1}, {'ParamHairFront':1}, {'ParamHairFront':-1}]
compound = [{'ParamAngleX': x, 'ParamAngleY': y} for x in (-30,30) for y in (-30,30)]
# Sample the authored Shake curves at key times. Linear interpolation is an
# approximation; MCP does not simulate physics in view_render_poses.
curves = json.load(open(out + 'motion-plan-Shake.json'))['entries'][0]['config']['curves']
shake = []
for t in [0, .14, .4, .62, .9, 1.24, 1.67]:
    values = {}
    for curve in curves:
        keys = curve['keys']
        if t <= keys[0]['time']:
            value = keys[0]['value']
        elif t >= keys[-1]['time']:
            value = keys[-1]['value']
        else:
            a, b = next((a, b) for a, b in zip(keys, keys[1:]) if a['time'] <= t <= b['time'])
            u = (t-a['time']) / (b['time']-a['time'])
            value = a['value'] + u * (b['value']-a['value'])
        values[curve['parameter']] = value
    shake.append(values)
for name, batch in [('hair-poses', poses), ('compound-poses', compound), ('shake-approx', shake)]:
    data, images = c.call('view_render_poses', {'viewport': {'mode':'canvas_rect','left':100,'top':0,'width':580,'height':650}, 'poses':batch,'columns':3,'target_long_edge':1800})
    open(out + name + '.json', 'w').write(json.dumps(data, ensure_ascii=False, indent=2))
    open(out + name + '.png', 'wb').write(images[0])
c.close()
