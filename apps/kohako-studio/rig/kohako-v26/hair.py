"""Counter the measured head-follow below the shoulders, with a smooth mesh falloff."""
import json, os, sys
sys.path.insert(0, '/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client

c = Client(endpoint='http://127.0.0.1:18767/mcp', token=os.environ['PSD2LIVE_MCP_TOKEN'], timeout=240)
# Displacements measured on isolated layers around the shoulder (canvas pixels).
# Topology coordinates are normalized to each mesh's original editing frame.
parts = [
    ('ArtMeshBackHair', 17, 603, 465, (2, 0), (0, 3)),
    ('ArtMeshFrontHairL', 231, 312, 80, (-13, 0), (-1, 9)),
    ('ArtMeshFrontHairR', 207, 334, 69, (-14, 0), (-1, 9)),
]
for axis in ('ParamAngleX', 'ParamAngleY'):
    shapes = []
    for mesh, top, height, width, dx, dy in parts:
        topo, _ = c.call('mesh_get_topology', {'target': 'mesh:' + mesh, 'limit': 4096})
        x0, y0, x1, y1 = topo['bounds']
        cutoff = y0 + (425 - top) / height * (y1 - y0)
        indices = [int(i) for i, x, y in topo['items'] if y >= cutoff]
        shift = dx if axis == 'ParamAngleX' else dy
        shapes.append({'target': 'mesh:' + mesh, 'value': 30,
                       'operations': [{'type': 'translate', 'delta': [shift[0] / width, shift[1] / height],
                                       'selection': {'indices': indices, 'soft_radius': 0.22, 'falloff': 'smooth'}}]})
    request = {'state': c.state(), 'parameter': {'id': axis}, 'shapes': shapes}
    if axis == 'ParamAngleX': request['mirror'] = True
    else:
        # Pitch has opposite vertical displacement at the negative extreme.
        shapes += [dict(s, value=-30, operations=[dict(s['operations'][0], delta=[-v for v in s['operations'][0]['delta']])]) for s in shapes]
    result, _ = c.call('author_axis', request)
    print(axis, json.dumps(result), flush=True)
c.close()
