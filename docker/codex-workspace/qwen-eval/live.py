#!/usr/bin/env python3
"""BOXP-344 only: reviewed GitOps phases + existing local SSH file queue.

Each phase creates a PR and waits for independent review/CI/merge; this program
never merges, patches the cluster, grants permissions, or kills/unlocks anything.
An interrupted run requires explicit state reconciliation, never regeneration.
"""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import shlex
import signal
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request

from harness import Harness, INPUTS

HOST = 'boxp@192.168.10.107'
WORK = '/var/lib/local-llm/models/boxp340-qwen-image-21/work'
GPU = '/dev/dri/renderD128'
GEMMA = 'argoproj/local-llm/deployment.yaml'
QWEN = 'argoproj/stable-diffusion/qwen-image-eval-deployment.yaml'
GATE = 'argoproj/local-llm/admission-config.yaml'
PHASES = {
    'fence': ((1, 0), (1, 0), 'closed'),
    'stop-gemma': ((1, 0), (0, 0), 'closed'),
    'start-qwen': ((0, 0), (0, 1), 'closed'),
    'stop-qwen': ((0, 1), (0, 0), 'closed'),
    'restore-gemma': ((0, 0), (1, 0), 'verify'),
    'reopen': ((1, 0), (1, 0), 'open'),
}


def command(args, *, cwd=None, stdin=None, timeout=60):
    result = subprocess.run(args, cwd=cwd, input=stdin, text=True, capture_output=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}): {result.stderr[-2000:]}')
    return result.stdout.strip()


def cluster(kind, name, namespace):
    return json.loads(command(['kubectl', '-n', namespace, 'get', kind, name, '-o', 'json']))


def replicas(path):
    values = re.findall(r'^  replicas: (\d+)$', path.read_text(), re.M)
    if len(values) != 1: raise ValueError('ambiguous replicas')
    return int(values[0])


def http(url, method='GET', data=None, timeout=10):
    request = urllib.request.Request(url, method=method, data=data,
                                     headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read().decode()
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode()


class LiveAdapter:
    profile = 'turbo'
    evidence_directory = 'live-evidence'

    def __init__(self, root, lolice, token):
        if not re.fullmatch(r'BOXP-(?:344|349)-[A-Za-z0-9_-]+', token): raise ValueError('invalid run token')
        self.root, self.lolice, self.token = Path(root), Path(lolice), token
        self.evidence = self.root / self.evidence_directory
        self.evidence.mkdir(parents=True, exist_ok=False)
        self.generation_metadata = {}
        self.pod_uid = None
        self.qwen_started = False
        self.lease = None
        self.pending_phase = None
        self.uncertain_job = None

    def acquire_lease(self, recover=False):
        # A single node-wide lease plus a durable one-session marker prevents
        # another root/process from silently starting a second BOXP-344 pilot.
        code = Path(__file__).with_name('node_lease.py').read_text()
        mode = 'recover' if recover else 'new'
        self.lease = subprocess.Popen(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=5','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2',HOST,
                                      'python3 -c ' + shlex.quote(code) + ' ' + shlex.quote(WORK) + ' ' + mode],
                                     stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        self.lease.stdin.write(self.token+'\n'); self.lease.stdin.flush()
        if self.lease.stdout.readline().strip() != 'LEASED':
            raise RuntimeError('node evaluation lease/marker already exists; explicit reconciliation required')

    def assert_lease(self):
        if self.lease is None or self.lease.poll() is not None:
            raise RuntimeError('node evaluation lease lost; reconciliation required')
        self.ssh("""
import fcntl,json,os
from pathlib import Path
w=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work');j=json.loads((w/'boxp344-window.json').read_text())
assert j['token']==json.loads(payload)['token']
assert open('/proc/%d/stat'%j['pid']).read().split()[21]==j['start'], 'lease owner gone'
with (w/'boxp344-window.lock').open('a+b') as f:
 try: fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
 except BlockingIOError: pass
 else: raise RuntimeError('lease lock unexpectedly free')
print('held')
""", {'token':self.token})

    def release_lease(self):
        if self.lease is not None:
            self.lease.stdin.close()
            self.lease.wait(timeout=15)

    def record(self, name, value):
        Harness.write_new(self.evidence / (name + '.json'), json.dumps(value, indent=2).encode())

    def ssh(self, code, payload=None, timeout=30):
        # Code is repository-owned. JSON payload is data, never shell syntax.
        program = code if payload is None else 'payload = ' + repr(json.dumps(payload)) + '\n' + code
        return command(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', HOST, 'python3', '-'],
                       stdin=program, timeout=timeout)

    def gpu_pids(self):
        return json.loads(self.ssh('''
import json, subprocess
p = subprocess.run(['sudo','-n','fuser','/dev/dri/renderD128'], capture_output=True, text=True)
if p.returncode not in (0,1) or (p.returncode == 1 and p.stdout.strip()): raise RuntimeError('fuser failed')
# Permission errors cannot be mistaken for an empty device.
if p.returncode == 1 and p.stderr.strip(): raise RuntimeError(p.stderr)
ids = [int(x) for x in p.stdout.split()]
print(json.dumps({str(pid):open('/proc/%d/comm'%pid).read().strip() for pid in ids}))
'''))

    def phase(self, phase):
        self.assert_lease()
        if self.pending_phase is not None: raise RuntimeError('unsettled GitOps phase; reconciliation required')
        expected, desired, mode = PHASES[phase]
        if command(['git', 'status', '--porcelain'], cwd=self.lolice):
            raise RuntimeError('GitOps worktree is dirty')
        command(['git', 'fetch', 'origin', 'main'], cwd=self.lolice)
        branch = 'codex-task-board/' + self.token + '-' + phase
        command(['git', 'switch', '-c', branch, 'origin/main'], cwd=self.lolice)
        if (replicas(self.lolice/GEMMA), replicas(self.lolice/QWEN)) != expected:
            raise RuntimeError('GitOps desired state changed unexpectedly')
        if phase == 'fence':
            declared = re.search(r'^  state: (.*)$', (self.lolice/GATE).read_text(), re.M)[1]
            actual = cluster('configmap','llama-server-admission','local-llm')['data']['state'].strip()
            if not declared.startswith('open:') or actual != declared:
                raise RuntimeError('another admission fence/drift already exists; do not take ownership')
        if phase != 'fence' and ('closed:' + self.token) not in (self.lolice/GATE).read_text() and phase != 'reopen':
            raise RuntimeError('fence ownership changed')
        if phase == 'reopen' and ('verify:' + self.token) not in (self.lolice/GATE).read_text():
            raise RuntimeError('verify ownership changed')
        for file, count in zip((GEMMA,QWEN), desired):
            path = self.lolice / file
            path.write_text(re.sub(r'^  replicas: \d+$', '  replicas: ' + str(count), path.read_text(), flags=re.M))
        path = self.lolice / GATE
        path.write_text(re.sub(r'^  state: .*$', '  state: ' + mode + ':' + self.token, path.read_text(), flags=re.M))
        command(['kustomize', 'build', 'argoproj/local-llm'], cwd=self.lolice)
        command(['kustomize', 'build', 'argoproj/stable-diffusion'], cwd=self.lolice)
        command(['git', 'diff', '--check'], cwd=self.lolice)
        command(['git', 'add', GEMMA,QWEN,GATE], cwd=self.lolice)
        command(['git', 'commit', '-m', 'BOXP-344 closed evaluation: ' + phase], cwd=self.lolice)
        command(['git', 'push', '-u', 'origin', 'HEAD'], cwd=self.lolice)
        body = self.evidence / (phase + '-pr.md')
        Harness.write_new(body, (f'BOXP-344 合成素材2件・画像各1枚までの閉じた評価。段階: {phase}。\n\n'
                                f'Gemma/Qwen desired replicas: {expected} → {desired}、受付: {mode}:{self.token}。\n'
                                '独立レビュー・CI確認後に通常mergeする。広いRBAC/直接patch/強制killなし。\n'
                                'merge直前にcontroller存続とnode lease所有者(pid/starttime/flock)を確認し、不在/不明ならmergeしない。\n'
                                '次の段階へは対象commitのArgo反映、実Pod・入口・GPU利用のreadbackが成功した場合のみ進む。\n').encode())
        self.pending_phase = phase
        url = None
        try:
            url = command(['gh','pr','create','--base','main','--title','BOXP-344 合成評価 '+phase,'--body-file',str(body)], cwd=self.lolice)
            self.record(phase + '-requested', {'pr':url,'at':time.time(),'desired':desired,'gate':mode+':'+self.token})
            print('REVIEW_AND_MERGE_REQUIRED ' + url, flush=True)
            for _ in range(240):
                self.guard_pending_pr(url)
                state = json.loads(command(['gh','pr','view',url,'--json','state,mergeCommit'], cwd=self.lolice))
                if state['state'] == 'MERGED':
                    self.record(phase + '-merged', state)
                    merged_sha = state['mergeCommit']['oid']
                    break
                if state['state'] == 'CLOSED': raise RuntimeError('GitOps PR closed without merge')
                time.sleep(5)
            else:
                raise TimeoutError('GitOps review/merge pending; reconcile before continuing')
            self.wait_deploy('local-llm','llama-server',desired[0])
            self.wait_deploy('stable-diffusion','qwen-image-eval',desired[1])
            self.wait_application('local-llm', merged_sha, desired, mode)
            self.wait_application('stable-diffusion', merged_sha, desired, mode)
            self.assert_lease()
            self.pending_phase = None
        except BaseException:
            # Any exit from a pending phase (including timeout, GitHub read or
            # evidence failure) must attempt cancellation of our own OPEN PR.
            try:
                if url is None:
                    matches=json.loads(command(['gh','pr','list','--head',branch,'--state','all','--json','url'],cwd=self.lolice))
                    if len(matches)==1: url=matches[0]['url']
                    else: raise RuntimeError('ambiguous PR lookup for '+branch+': '+str(len(matches)))
                if url is not None:
                    final_state = self.cancel_pending_pr(url)
                    print('RECOVERY_REQUIRED phase='+phase+' branch='+branch+' pr='+url+' state='+final_state,flush=True)
            except BaseException as cancellation:
                print('RECOVERY_REQUIRED unresolved PR for '+branch+': '+repr(cancellation),flush=True)
            raise

    def cancel_pending_pr(self, url):
        state=json.loads(command(['gh','pr','view',url,'--json','state'],cwd=self.lolice))
        if state['state']=='OPEN':
            command(['gh','pr','close',url],cwd=self.lolice)
            state=json.loads(command(['gh','pr','view',url,'--json','state'],cwd=self.lolice))
            if state['state']!='CLOSED': raise RuntimeError('phase cancellation uncertain')
        # MERGED is deliberately not treated as cancellation; pending stays
        # set until commit application is positively reconciled.
        return state['state']

    def guard_pending_pr(self, url):
        try: self.assert_lease()
        except Exception:
            self.cancel_pending_pr(url)
            raise

    def wait_application(self, name, merged_sha, desired, mode):
        for _ in range(180):
            self.assert_lease()
            app=cluster('application',name,'argocd')
            sync=app.get('status',{}).get('sync',{})
            revision=sync.get('revision','')
            if sync.get('status')=='Synced' and re.fullmatch(r'[0-9a-f]{40}',revision):
                command(['git','fetch','origin','main'],cwd=self.lolice)
                try:
                    command(['git','merge-base','--is-ancestor',merged_sha,revision],cwd=self.lolice)
                    texts=[command(['git','show',revision+':'+file],cwd=self.lolice) for file in (GEMMA,QWEN,GATE)]
                    observed=tuple(int(re.search(r'^  replicas: (\d+)$',text,re.M)[1]) for text in texts[:2])
                    gate=cluster('configmap','llama-server-admission','local-llm')['data']['state'].strip()
                    if observed==desired and ('state: '+mode+':'+self.token) in texts[2] and gate==mode+':'+self.token:
                        self.record(self.pending_phase+'-'+name+'-synced',{'revision':revision,'merge':merged_sha,'at':time.time()})
                        return
                except (RuntimeError,TypeError): pass
            time.sleep(5)
        raise TimeoutError('GitOps commit application not confirmed: '+name)

    def wait_deploy(self, ns, name, count):
        for _ in range(180):
            self.assert_lease()
            obj = cluster('deployment', name, ns)
            pods = cluster('pods', '-l=app='+name, ns)['items']
            active = [p for p in pods if not p['metadata'].get('deletionTimestamp')]
            if obj['spec']['replicas'] == count and obj.get('status',{}).get('observedGeneration',0) >= obj['metadata']['generation']:
                if count == 0 and not pods: return
                if count == 1 and len(pods) == 1 and len(active) == 1 and all(x.get('ready') for x in active[0].get('status',{}).get('containerStatuses',[])) and active[0].get('status',{}).get('containerStatuses'):
                    return
            time.sleep(5)
        raise TimeoutError('deployment/pod readback incomplete: '+ns+'/'+name)

    def llama(self):
        pods = cluster('pods','-l=app=llama-server','local-llm')['items']
        if len(pods) != 1 or pods[0]['metadata'].get('deletionTimestamp'): raise RuntimeError('unexpected llama Pod set')
        pod = pods[0]
        if pod['spec'].get('nodeName') != 'golyat-4': raise RuntimeError('llama is outside the observed GPU node')
        args = next(c['args'] for c in pod['spec']['containers'] if c['name']=='llama-server')
        if args[args.index('--host')+1] != '127.0.0.1': raise RuntimeError('raw inference port is not fenced')
        return pod, 'http://' + pod['status']['podIP']

    def require_gate(self, mode):
        pod, url = self.llama()
        code, body = http(url+':8080/__board_pilot__/admission')
        if code != 200 or body.strip() != mode+':'+self.token: raise RuntimeError('gate has not converged on Pod')
        return pod,url

    def fence_and_drain(self):
        # The local arbiter is held by Harness for the whole session. Other
        # experiments may not be active, even if they do not use that arbiter.
        pids = self.gpu_pids()
        if not pids or set(pids.values()) != {'llama-server'}: raise RuntimeError('uncontrolled GPU owner')
        self.record('initial-gpu', pids)
        self.acquire_lease()
        canonical = json.loads(Path(__file__).with_name('canonical.json').read_text())
        model_hashes, scripts = canonical['models'], canonical['scripts']
        if canonical['revision'] != 'fc13ba1986fcb905854dc8de2f52eee395f49b5b': raise ValueError('unexpected model revision')
        for relative, digest in {**model_hashes, **scripts}.items():
            if not re.fullmatch(r'[0-9a-f]{64}', digest) or Path(relative).is_absolute() or '..' in Path(relative).parts:
                raise ValueError('invalid canonical hash manifest')
        checked = self.ssh('''
import hashlib,json
from pathlib import Path
j=json.loads(payload); base=Path('/var/lib/local-llm/models/boxp340-qwen-image-21')
for kind,root in [('models',base/'Qwen-Image-2.1-Turbo'),('scripts',base/'work')]:
 for name,expected in j[kind].items():
  p=root/name
  assert not p.is_symlink(), 'symlink model/script'
  digest=hashlib.sha256()
  with p.open('rb') as f:
   while chunk:=f.read(1024*1024): digest.update(chunk)
  assert digest.hexdigest()==expected, 'model/script hash mismatch: '+name
print(json.dumps(j))
''', {'models':model_hashes,'scripts':scripts}, timeout=300)
        self.record('canonical-hashes', json.loads(checked))
        self.ssh('''
from pathlib import Path
w=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work')
assert (w/'pylib/.ok').is_file(), 'runtime dependencies missing; no install permitted'
assert not list((w/'queue').glob('*.job')), 'pre-existing queue'
assert not list((w/'logs').glob('*.running')), 'pre-existing running job'
print('empty')
''')
        self.phase('fence')
        last_uid = None
        stable = 0
        for _ in range(180):
            try:
                pod,url = self.require_gate('closed')
            except RuntimeError:
                stable = 0
                time.sleep(2)
                continue
            uid = pod['metadata']['uid']
            values = json.loads(http(url+':9901/stats?format=json')[1])['stats']
            stats = {x['name']:x['value'] for x in values if 'name' in x}
            models = json.loads(http(url+':9901/__board_pilot__/models')[1])['data']
            loaded = [m['id'] for m in models if m.get('status',{}).get('value')=='loaded']
            if any(m.get('status',{}).get('value') not in ('loaded','unloaded') for m in models):
                raise RuntimeError('unknown/loading model status')
            idle = bool(loaded)
            for model in loaded:
                code,body = http(url+':9901/__board_pilot__/slots?model='+urllib.parse.quote(model,safe=''))
                slots = json.loads(body) if code==200 else None
                idle = idle and isinstance(slots,list) and bool(slots) and all(s.get('is_processing') is False for s in slots)
            idle = idle and all(stats.get('cluster.llama_server.'+k) == 0 for k in ('upstream_rq_active','upstream_rq_pending_active'))
            stable = stable+1 if idle and uid==last_uid else 0
            last_uid = uid
            if stable >= 3: break
            time.sleep(2)
        else: raise TimeoutError('drain did not complete')
        for base in (url+':8080','http://llama-server.local-llm.svc.cluster.local:8080','http://192.168.10.95:8080'):
            if http(base+'/v1/chat/completions','POST',b'{}')[0] != 503: raise RuntimeError('unfenced ingress '+base)
        try: http(url+':8081/health')
        except (urllib.error.URLError, TimeoutError): pass
        else: raise RuntimeError('raw port remains reachable')
        self.pod_uid = uid
        self.record('drained', {'uid':uid,'loaded':loaded,'stats':{k:v for k,v in stats.items() if 'llama_server.upstream_rq_' in k},'at':time.time()})

    def stop_gemma_and_prove_gpu_free(self):
        pod,_ = self.require_gate('closed')
        if pod['metadata']['uid'] != self.pod_uid: raise RuntimeError('Pod changed after drain')
        self.phase('stop-gemma')
        pids = self.gpu_pids()
        if pids: raise RuntimeError('GPU still in use after Gemma stop')
        self.record('gemma-stopped-gpu-free', {'pids':pids,'at':time.time()})

    def start_qwen(self):
        if self.gpu_pids(): raise RuntimeError('GPU acquired by another owner')
        if self.lease is None or self.lease.poll() is not None: raise RuntimeError('node lease lost')
        self.phase('start-qwen')
        self.qwen_started = True
        pod = cluster('pods','-l=app=qwen-image-eval','stable-diffusion')['items']
        if len(pod)!=1 or pod[0]['spec'].get('nodeName')!='golyat-4': raise RuntimeError('unexpected Qwen Pod/node set')
        self.record('qwen-pod', {'uid':pod[0]['metadata']['uid'],'containers':pod[0]['status']['containerStatuses']})

    def generate(self, contract):
        ref_data = None
        if contract.get('reference') is not None:
            if not getattr(self, 'reference_root', None):
                raise RuntimeError('reference image execution is not supported by the verified queue contract')
            from harness import validate_image_reference
            ref_data = validate_image_reference(self.reference_root, contract['reference'])
        self.assert_lease()
        name = self.token + '-' + contract['id']
        expected_job = dict(contract)
        if ref_data is not None:
            expected_job['ref'] = '/work/boxp344/' + name + '/reference.png'
        self.uncertain_job = name
        self.ssh('''
import json, os, base64, hashlib
from pathlib import Path
j=json.loads(payload); w=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work'); name=j['name']
b=w/'boxp344'/name; b.mkdir(parents=True,exist_ok=False)
if j.get('reference_png') is not None:
 data=base64.b64decode(j['reference_png'],validate=True)
 assert hashlib.sha256(data).hexdigest()==j['contract']['reference']['sha256']
 with (b/'reference.png').open('xb') as f: f.write(data);f.flush();os.fsync(f.fileno())
with (b/'jobs.json').open('x') as f: json.dump([j['contract']],f);f.flush();os.fsync(f.fileno())
text='MODEL=/models/Qwen-Image-2.1-Turbo\\nJOBS=/work/boxp344/'+name+'/jobs.json\\nOUT=/work/boxp344/'+name+'/out\\nEXTRA=\\n'
# Never replace queue/done/output state; uncertain execution cannot retry.
f=w/'queue'/(name+'.job'); tmp=b/'queued.job'
with tmp.open('x') as out: out.write(text); out.flush(); os.fsync(out.fileno())
os.link(tmp,f)
print('queued')
''', {'name':name,'contract':expected_job,'reference_png':base64.b64encode(ref_data).decode() if ref_data is not None else None})
        for _ in range(180):
            self.assert_lease()
            result = json.loads(self.ssh('''
import json, base64
from pathlib import Path
j=json.loads(payload); b=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work/boxp344')/j['name']/'out'
p=b/(j['id']+'.json')
done=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work/done')/(j['name']+'.job')
if not p.exists() or not done.exists(): print('{}')
else:
 try:
  meta=json.loads(p.read_text()); image=b/(j['id']+'.png')
  meta['load']=json.loads((b/'load.json').read_text())
  print(json.dumps({'metadata':meta,'png':base64.b64encode(image.read_bytes()).decode() if image.exists() else None}))
 except (ValueError,OSError): print('{}')
''', {'name':name,'id':contract['id']}, timeout=30))
            if result:
                self.uncertain_job = None
                self.generation_metadata = result['metadata']
                self.record('generation-'+contract['id'], result['metadata'])
                if result['metadata'].get('job') != expected_job: raise RuntimeError('generated contract metadata mismatch')
                if result['metadata'].get('status') != 'ok' or not result['png']: raise RuntimeError('Qwen generation failed')
                return base64.b64decode(result['png'],validate=True)
            time.sleep(5)
        raise TimeoutError('Qwen timeout; no retry')

    def stop_qwen_and_prove_gpu_free(self):
        # A failed start PR can still have merged; reconcile desired/actual.
        self.assert_lease()
        if self.pending_phase is not None: raise RuntimeError('unsettled GitOps phase prevents restore')
        obj=cluster('deployment','qwen-image-eval','stable-diffusion')
        if obj['spec']['replicas']==1: self.phase('stop-qwen')
        else: self.wait_deploy('stable-diffusion','qwen-image-eval',0)
        pids=self.gpu_pids()
        if pids: raise RuntimeError('GPU not free after Qwen stop')
        self.record('qwen-stopped-gpu-free', {'pids':pids,'at':time.time()})
        if self.uncertain_job is not None: raise RuntimeError('uncertain queued job prevents Gemma/admission restore')

    def restore_gemma_verify(self):
        self.phase('restore-gemma')
        self.verify_gemma_ready()

    def verify_gemma_ready(self):
        for _ in range(30):
            try:
                pod,url=self.require_gate('verify')
                break
            except RuntimeError: time.sleep(5)
        else: raise RuntimeError('restore gate not converged')
        if http(url+':8080/health')[0]!=200: raise RuntimeError('Gemma health failed')
        code,body=http(url+':9901/__board_pilot__/restore-probe','POST',b'{}',timeout=360)
        response=json.loads(body)
        if code!=200 or not response.get('choices') or not response['choices'][0].get('message',{}).get('content','').strip():
            raise RuntimeError('Gemma short inference failed')
        pids=self.gpu_pids()
        if not pids or set(pids.values())!={'llama-server'}: raise RuntimeError('unexpected GPU owner after restore')
        self.record('gemma-restored', {'uid':pod['metadata']['uid'],'response':response,'pids':pids,'at':time.time()})

    def reopen(self):
        self.assert_lease()
        if self.uncertain_job is not None: raise RuntimeError('uncertain job prevents reopen')
        self.phase('reopen')
        for _ in range(30):
            try:
                pod,_=self.require_gate('open')
                self.record('admission-restored',{'uid':pod['metadata']['uid'],'at':time.time()})
                return
            except RuntimeError: time.sleep(5)
        raise RuntimeError('admission reopen not converged')


def main():
    def terminated(signum, frame): raise SystemExit(128+signum)
    signal.signal(signal.SIGTERM, terminated)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',required=True)
    parser.add_argument('--lolice-worktree',required=True)
    parser.add_argument('--token',required=True)
    args=parser.parse_args()
    harness=Harness(args.root,profile='turbo')
    for board in INPUTS: harness.submit(board)
    adapter=LiveAdapter(harness.root,args.lolice_worktree,args.token)
    try:
        print(json.dumps(harness.run_many(list(INPUTS),adapter)))
    finally:
        adapter.release_lease()

if __name__=='__main__': main()
