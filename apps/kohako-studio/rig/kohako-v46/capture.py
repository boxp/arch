"""Render both models through one persistent MCP client and server process."""
import io,json,os,subprocess,sys,shutil
from PIL import Image
sys.path.insert(0,'/tmp/boxp441/v6/psd2live')
from mcp_proxy import Client
c=Client(endpoint='http://127.0.0.1:18767/mcp',token=os.environ['PSD2LIVE_MCP_TOKEN'],timeout=240)
out='/tmp/boxp441/v6/out/'
angles=[{}, {'ParamAngleX':-30}, {'ParamAngleX':30}, {'ParamAngleY':-20}, {'ParamAngleY':20}]
values=[i/20 for i in range(21)]+[.135,.60]
def capture(prefix):
 for i,angle in enumerate(angles):
  poses=[dict(angle,ParamEyeLOpen=v,ParamEyeROpen=v) for v in values]
  for kind,viewport,edge in [('eyes',dict(left=300,top=160,width=230,height=120),1610),('full-eyes',dict(left=100,top=0,width=580,height=650),1300)]:
   sheets=[]; tiles=[]; yoff=0
   for start in range(0,len(poses),5):
    d,imgs=c.call('view_render_poses',{'viewport':dict(mode='canvas_rect',**viewport),'poses':poses[start:start+5],'columns':3,'target_long_edge':edge})
    sheet=Image.open(io.BytesIO(imgs[0])).convert('RGBA');sheets.append(sheet)
    for tile in d['tiles']:
     tile['imageRect'][1]+=yoff;tiles.append(tile)
    yoff+=sheet.height
   combined=Image.new('RGBA',(max(x.width for x in sheets),yoff))
   yoff=0
   for sheet in sheets:
    combined.paste(sheet,(0,yoff));yoff+=sheet.height
   combined.save(f'{out}{prefix}-{kind}{i}.png');open(f'{out}{prefix}-{kind}{i}.json','w').write(json.dumps({'tiles':tiles},indent=2))
capture('baseline1');capture('baseline2')
# Rebuild both candidates inside this server session from the identical v38 layout.
shutil.copytree('/tmp/boxp441/v6/layout','/tmp/boxp441/baseline-layout')
shutil.copyfile('/tmp/boxp441/eyes-v43.png','/tmp/boxp441/eyes-gemini.png')
shutil.copyfile('/tmp/boxp441/eyes-codex.png','/tmp/boxp441/eyes-v43.png')
for script in ['kohako-v45/parts.py','kohako-v36/build.py','kohako-v45/eyes.py','kohako-v25/mouth.py','kohako-v6/finalize.py']:
 subprocess.run(['python','/tmp/boxp441/rig/'+script],check=True)
capture('v45')
shutil.rmtree('/tmp/boxp441/v6/layout')
shutil.copytree('/tmp/boxp441/baseline-layout','/tmp/boxp441/v6/layout')
shutil.copyfile('/tmp/boxp441/eyes-gemini.png','/tmp/boxp441/eyes-v43.png')
for script in ['kohako-v46/parts.py','kohako-v36/build.py','kohako-v46/eyes.py','kohako-v25/mouth.py','kohako-v6/finalize.py']:
 subprocess.run(['python','/tmp/boxp441/rig/'+script],check=True)
capture('candidate')
# Render one direction at 0.05 steps and reuse the same stills in reverse.
frames=[]
for start in range(0,21,5):
 vals=[i/20 for i in range(start,min(start+5,21))]
 poses=[dict(ParamEyeLOpen=v,ParamEyeROpen=v) for v in vals]
 d,imgs=c.call('view_render_poses',{'viewport':dict(mode='canvas_rect',left=300,top=160,width=230,height=120),'poses':poses,'columns':min(3,len(poses)),'target_long_edge':1610})
 img=Image.open(io.BytesIO(imgs[0])).convert('RGB')
 for tile in d['tiles']:
  x,y,w,h=tile['imageRect'];frame=img.crop((x,y,x+w,y+h));frames.append(frame.resize(frames[0].size,Image.Resampling.LANCZOS) if frames else frame)
from PIL import ImageDraw
sequence=frames+frames[-2::-1];w,h=frames[0].size
sheet=Image.new('RGB',(w*7,(h+24)*6),'white');draw=ImageDraw.Draw(sheet)
for i,frame in enumerate(sequence):
 x=(i%7)*w;y=(i//7)*(h+24);sheet.paste(frame,(x,y+24));draw.text((x+4,y+4),f'{i/20 if i<=20 else (40-i)/20:.2f}',fill='black')
sheet.save(out+'v46-blink.jpg',quality=90);c.close()
