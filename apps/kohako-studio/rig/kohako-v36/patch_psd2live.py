# BOXP-441 TD-26 (kohako-v36): psd2live 6fe868a の RigBuilder.kt に backhair-anchor.patch（unified diff）を当てる。
# 後ろ髪の追従ワープに「根元は頭の向き・うなずきに追従、肩より下は首の傾きを打ち消して体に留まる」を足す。
# P2L_BACKHAIR_ANCHOR=1 のときだけ効く（未設定なら生成器は元のまま）。使い方: python patch_psd2live.py <psd2live dir> <patch>
import sys,re
root,patch=sys.argv[1],sys.argv[2]
p=root+'/src/main/kotlin/io/github/psd2live/core/RigBuilder.kt'; s=open(p).read()
if 'P2L_BACKHAIR_ANCHOR' in s: print('already patched'); sys.exit(0)
lines=open(patch).read().split('\n'); hunks=[]; cur=None
for l in lines:
 if l.startswith('@@'): cur=[[],[]]; hunks.append(cur); continue
 if cur is None or l.startswith('---') or l.startswith('+++') or l.startswith('diff ') or l.startswith('index '): continue
 if l.startswith('+'): cur[1].append(l[1:])
 elif l.startswith('-'): cur[0].append(l[1:])
 elif l.startswith(' '): cur[0].append(l[1:]); cur[1].append(l[1:])
for old,new in hunks:
 o='\n'.join(old); n='\n'.join(new)
 assert s.count(o)==1, 'hunk context not found once'
 s=s.replace(o,n)
open(p,'w').write(s); print('patched',len(hunks),'hunks')
