"""Node-file transport to the dedicated SA Pod; no write token reaches this process."""
import json
import time
import uuid

from kubernetes_runtime import KubernetesBackend
from runtime import RecoveryRequired


class FileQueueBackend(KubernetesBackend):
    def __init__(self, lease_check, convergence_check, *, ownership_check, ssh, clock=time.monotonic):
        # Reuse all CAS/readback logic, replacing only credential-bearing I/O.
        self.lease_check, self.convergence_check = lease_check, convergence_check
        self.ownership_check, self.clock, self.ssh = ownership_check, clock, ssh
        self.observed = None

    @staticmethod
    def request(args):
        if args[:2] == ['get', '--raw'] and len(args) == 3:
            return 'GET', args[2], None
        if args == ['-n', 'local-llm', 'get', 'configmap', 'llama-server-admission', '-o', 'json']:
            return 'GET', '/api/v1/namespaces/local-llm/configmaps/llama-server-admission', None
        if args[:5] == ['-n', 'local-llm', 'patch', 'configmap', 'llama-server-admission']:
            prefix, path = 5, '/api/v1/namespaces/local-llm/configmaps/llama-server-admission'
        elif len(args) >= 6 and args[0] == '-n' and args[2:4] == ['patch', 'deployment'] and args[5] == '--subresource=scale' and (args[1], args[4]) in KubernetesBackend.TARGETS:
            prefix, path = 6, f'/apis/apps/v1/namespaces/{args[1]}/deployments/{args[4]}/scale'
        else:
            raise RecoveryRequired('unsupported file API command')
        if len(args) != prefix + 5 or args[prefix:prefix+2] != ['--type=json', '-p'] or args[-2:] != ['-o', 'json']:
            raise RecoveryRequired('conditional JSON patch required')
        return 'PATCH', path, json.loads(args[prefix+2])

    def call(self, args, deadline):
        remaining = deadline - self.clock()
        if remaining <= 0:
            raise TimeoutError('runtime file API deadline')
        method, path, body = self.request(args)
        identity = uuid.uuid4().hex
        request = dict(method=method, path=path, body=body, expires=time.time() + min(60, remaining))
        self.ssh('''
import json,os
from pathlib import Path
j=json.loads(payload);r=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work/runtime-api')
p=r/'requests'/(j['id']+'.json');tmp=r/(j['id']+'.tmp')
with tmp.open('x') as f:
 json.dump(j['request'],f);f.flush();os.fsync(f.fileno())
os.link(tmp,p);tmp.unlink()
f=os.open(p.parent,os.O_RDONLY|os.O_DIRECTORY);os.fsync(f);os.close(f)
print('queued')
''', {'id': identity, 'request': request}, timeout=min(30, remaining))
        while self.clock() < deadline:
            self.assert_lease()
            response = json.loads(self.ssh('''
import json
from pathlib import Path
j=json.loads(payload);p=Path('/var/lib/local-llm/models/boxp340-qwen-image-21/work/runtime-api/responses')/(j['id']+'.json')
print(p.read_text() if p.exists() else '{}')
''', {'id': identity}, timeout=min(25, max(1, deadline-self.clock()))))
            if response:
                if response.get('status') != 200 or 'object' not in response:
                    raise RecoveryRequired('file API rejected or unknown; observe before recovery')
                return response['object']
            time.sleep(0.2)
        raise RecoveryRequired('file API outcome unknown; observe before recovery')
