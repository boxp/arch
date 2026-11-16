import json,sys
for c in sys.argv[1:]:
  for v,layer in (('36','top'),('37','back')):
    d=json.load(open(f'o{v}{c}/log.json')); L=d['log']; segs={}
    for e in L: segs.setdefault(e['seg'],[]).append(e)
    print(f'v{v} {c}')
    for s,es in segs.items():
        line=f"  {s[:18]:18s} face[{min(e['face'][0] for e in es):5.0f},{max(e['face'][0] for e in es):4.0f}]"
        for n in ['SL','SR','CR']:
            a=[e['vis'][n][layer] for e in es]; line+=f" {n}:{max(abs(x[0]) for x in a):4.1f},{max(abs(x[1]) for x in a):4.1f}"
        for n in ['Lroot','Rroot','Lsho','Rsho','Ltip','Rtip']:
            rx=[e['lm'][n]['rel'][0] for e in es]; ry=[e['lm'][n]['rel'][1] for e in es]
            line+=f" {n[0]+n[1:3]}:{max(map(abs,rx)):3.0f},{max(map(abs,ry)):3.0f}"
        print(line)
