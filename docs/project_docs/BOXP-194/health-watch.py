#!/usr/bin/env python3
"""BOXP-194: Kubernetes Pod外のホストプロセス用の読み取り専用更新後観測。"""
import argparse
import datetime
import json
import ipaddress
import pathlib
import subprocess
import time
import urllib.request

NODES = {'shanghai-1', 'shanghai-2', 'shanghai-3', 'golyat-1', 'golyat-2', 'golyat-3', 'golyat-4'}
CP = ['shanghai-1', 'shanghai-2', 'shanghai-3']
K8S = 'v1.36.5'
CRIO = 'cri-o://1.36.6'
BASE = ['sudo', '-n', 'kubectl', '--kubeconfig=/etc/kubernetes/admin.conf', '--request-timeout=30s']


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def command(args, timeout=60):
    result = subprocess.run(BASE + args, text=True, capture_output=True, timeout=timeout)
    require(result.returncode == 0, '{}: {}'.format(' '.join(args), result.stderr.strip()))
    return result.stdout.strip()


def get(resource, namespace=None):
    args = ['get', resource]
    args += ['-n', namespace] if namespace else ['-A']
    return json.loads(command(args + ['-o', 'json']))['items']


def versions_ok(nodes):
    return ({n['metadata']['name'] for n in nodes} == NODES and all(
        n.get('status', {}).get('nodeInfo', {}).get('kubeletVersion') == K8S and
        n.get('status', {}).get('nodeInfo', {}).get('containerRuntimeVersion') == CRIO
        for n in nodes))


def ready_nodes(nodes):
    require(versions_ok(nodes), '全7台のKubernetes/CRI-O期待版に不一致')
    for node in nodes:
        name = node['metadata']['name']
        require(not node.get('spec', {}).get('unschedulable', False), name + ': cordon中')
        conditions = {c['type']: c['status'] for c in node['status']['conditions']}
        require(conditions.get('Ready') == 'True', name + ': NotReady')
        require(not any(conditions.get(x) == 'True' for x in ['MemoryPressure', 'DiskPressure', 'PIDPressure']), name + ': pressure')


def workload(items, name, daemon=False, expected=None):
    found = [x for x in items if x['metadata']['name'] == name]
    require(len(found) == 1, name + ': resource不在/重複')
    item = found[0]
    status = item.get('status', {})
    desired = status.get('desiredNumberScheduled', 0) if daemon else item.get('spec', {}).get('replicas', 1)
    require(desired > 0 and (expected is None or desired == expected), name + ': desired数異常')
    require(status.get('observedGeneration', 0) >= item['metadata'].get('generation', 1), name + ': generation未収束')
    if daemon:
        require(status.get('numberReady', 0) == desired and status.get('currentNumberScheduled', 0) == desired and status.get('updatedNumberScheduled', 0) == desired and status.get('numberUnavailable', 0) == 0, name + ': DaemonSet未収束')
    else:
        require(status.get('readyReplicas', 0) == desired and status.get('updatedReplicas', 0) == desired and status.get('availableReplicas', 0) == desired, name + ': Deployment未収束')
    return {'desired': desired, 'ready': status.get('numberReady' if daemon else 'readyReplicas', 0)}


def service_url(service):
    spec = service.get('spec', {})
    address = ipaddress.ip_address(spec.get('clusterIP', ''))
    ports = [p for p in spec.get('ports', []) if p.get('name') == 'http' and p.get('protocol', 'TCP') == 'TCP']
    require(len(ports) == 1, 'llama-server Service http port不在/重複')
    port = ports[0].get('port')
    require(isinstance(port, int) and 1 <= port <= 65535, 'llama-server Service http port不正')
    host = '[' + str(address) + ']' if address.version == 6 else str(address)
    return 'http://' + host + ':' + str(port)


def http(path, payload=None, timeout=30):
    body = json.dumps(payload).encode() if payload is not None else None
    service = json.loads(command(['get', 'svc', 'llama-server', '-n', 'local-llm', '-o', 'json']))
    req = urllib.request.Request(service_url(service) + path, data=body, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        require(response.status == 200, 'local-llm HTTP status ' + str(response.status))
        return json.load(response)


def check():
    result = {}
    require(command(['get', '--raw=/readyz']) in ['ok', 'readyz check passed'], 'API readyz異常')
    ready_nodes(get('nodes'))
    result['nodes'] = 7
    ds = get('daemonsets', 'kube-system')
    result['vip'] = workload(ds, 'kube-vip-ds', True, 3)
    result['calico_node'] = workload(get('daemonsets', 'calico-system'), 'calico-node', True, 7)
    deployments = get('deployments', 'kube-system')
    result['calico_controller'] = workload(get('deployments', 'calico-system'), 'calico-kube-controllers')
    result['coredns'] = workload(deployments, 'coredns')
    result['longhorn_manager'] = workload(get('daemonsets', 'longhorn-system'), 'longhorn-manager', True)
    volumes = get('volumes.longhorn.io', 'longhorn-system')
    require(len(volumes) > 0, 'Longhorn volume不在')
    for volume in volumes:
        require(volume.get('status', {}).get('robustness') == 'healthy', 'Longhorn unhealthy: ' + volume['metadata']['name'])
    result['longhorn_healthy'] = len(volumes)
    pvcs = get('pvc')
    for pvc in pvcs:
        require(pvc.get('status', {}).get('phase') == 'Bound', 'PVC未Bound: ' + pvc['metadata']['namespace'] + '/' + pvc['metadata']['name'])
    result['pvc_bound'] = len(pvcs)
    result['etcd'] = {}
    for node in CP:
        etcd = ['-n', 'kube-system', 'exec', 'etcd-' + node, '--', 'etcdctl', 'endpoint']
        options = ['--endpoints=https://127.0.0.1:2379', '--cacert=/etc/kubernetes/pki/etcd/ca.crt', '--cert=/etc/kubernetes/pki/etcd/healthcheck-client.crt', '--key=/etc/kubernetes/pki/etcd/healthcheck-client.key', '--write-out=json']
        health = json.loads(command(etcd + ['health'] + options))
        status = json.loads(command(etcd + ['status'] + options))
        require(len(health) == 1 and health[0].get('health') is True, node + ': etcd unhealthy')
        require(len(status) == 1 and not status[0].get('Status', {}).get('errors', []), node + ': etcd status errors')
        require(bool(status[0].get('Status', {}).get('header', {}).get('member_id')), node + ': etcd status不正')
        result['etcd'][node] = status[0]['Status']
    snapshots = get('pods', 'etcd-snapshots')
    snapshot = [p for p in snapshots if p['metadata'].get('labels', {}).get('app.kubernetes.io/name') == 'etcd-snapshot-store' and not p['metadata'].get('deletionTimestamp') and any(c.get('type') == 'Ready' and c.get('status') == 'True' for c in p.get('status', {}).get('conditions', []))]
    require(len(snapshot) == 1, 'snapshot-store Ready pod不在/重複')
    result['dns'] = command(['-n', 'etcd-snapshots', 'exec', snapshot[0]['metadata']['name'], '--', 'nslookup', 'kubernetes.default.svc.cluster.local'])
    result['llama_server'] = workload(get('deployments', 'local-llm'), 'llama-server')
    result['llama_health'] = http('/health')
    return result


def write(handle, event, **data):
    handle.write(json.dumps({'utc': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'event': event, **data}, ensure_ascii=False) + '\n')
    handle.flush()


def validate_gpu_models(models):
    entries = [m for m in models.get('data', []) if m.get('id') == 'gemma4-26b']
    require(len(entries) == 1, 'GPU model gemma4-26b不在/重複')
    args = entries[0].get('status', {}).get('args', entries[0].get('meta', {}).get('args', entries[0].get('args', [])))
    require(isinstance(args, list), 'GPU model argsが配列ではない')
    def has_option(names, value):
        return any(
            (arg in names and i + 1 < len(args) and str(args[i + 1]) == value)
            or any(arg == name + '=' + value for name in names)
            or (arg == '-ngl' + value and '-ngl' in names)
            for i, arg in enumerate(args)
        )
    require(has_option(['--device', '-dev'], 'SYCL0'), 'GPU --device/-dev SYCL0未確認')
    require(has_option(['--n-gpu-layers', '-ngl'], '99'), 'GPU --n-gpu-layers/-ngl 99未確認')
    return args


def run_gpu_test(handle):
    write(handle, 'gpu_start')
    response = http('/v1/chat/completions', {'model': 'gemma4-26b', 'messages': [{'role': 'user', 'content': 'Reply with the number 2 only.'}], 'max_tokens': 8, 'temperature': 0}, 600)
    choices = response.get('choices', [])
    require(bool(choices), 'GPU推論choicesが空')
    content = choices[0].get('message', {}).get('content', '')
    require(isinstance(content, str) and bool(content.strip()), 'GPU推論responseが空')
    models = http('/v1/models')
    gpu_args = validate_gpu_models(models)
    write(handle, 'gpu_pass', response=response, models=models, gpu_args=gpu_args)


def run_once(handle, gpu_test):
    write(handle, 'sample_pass', sample=0, **check())
    if gpu_test:
        run_gpu_test(handle)
    write(handle, 'completed', samples=1)


def self_test():
    nodes = [{'metadata': {'name': n}, 'status': {'nodeInfo': {'kubeletVersion': K8S, 'containerRuntimeVersion': CRIO}, 'conditions': [{'type': 'Ready', 'status': 'True'}]}} for n in NODES]
    ready_nodes(nodes)
    nodes[0]['spec'] = {'unschedulable': True}
    try:
        ready_nodes(nodes)
    except RuntimeError:
        pass
    else:
        raise AssertionError('cordon異常未検出')
    nodes[0].pop('spec')
    nodes[0]['status']['nodeInfo']['kubeletVersion'] = 'v1.36.1'
    assert not versions_ok(nodes)
    fixture = [{'metadata': {'name': 'test', 'generation': 1}, 'spec': {'replicas': 1}, 'status': {'observedGeneration': 1, 'readyReplicas': 1, 'updatedReplicas': 1, 'availableReplicas': 1}}]
    workload(fixture, 'test')
    fixture[0]['status']['readyReplicas'] = 0
    try:
        workload(fixture, 'test')
    except RuntimeError:
        pass
    else:
        raise AssertionError('workload異常未検出')
    validate_gpu_models({'data': [{'id': 'gemma4-26b', 'status': {'args': ['--device', 'SYCL0', '--n-gpu-layers', '99']}}]})
    validate_gpu_models({'data': [{'id': 'gemma4-26b', 'status': {'args': ['--device=SYCL0', '--n-gpu-layers=99']}}]})
    validate_gpu_models({'data': [{'id': 'gemma4-26b', 'status': {'args': ['-dev', 'SYCL0', '-ngl', '99']}}]})
    validate_gpu_models({'data': [{'id': 'gemma4-26b', 'status': {'args': ['-dev=SYCL0', '-ngl=99']}}]})
    validate_gpu_models({'data': [{'id': 'gemma4-26b', 'status': {'args': ['-dev', 'SYCL0', '-ngl99']}}]})
    try:
        validate_gpu_models({'data': [{'id': 'gemma4-26b', 'meta': {'args': ['--device', 'CPU', '--n-gpu-layers', '0']}}]})
    except RuntimeError:
        pass
    else:
        raise AssertionError('GPU設定異常未検出')
    assert service_url({'spec': {'clusterIP': '10.1.2.3', 'ports': [{'name': 'http', 'port': 9090}]}}) == 'http://10.1.2.3:9090'
    assert service_url({'spec': {'clusterIP': 'fd00::1', 'ports': [{'name': 'http', 'port': 8080}]}}) == 'http://[fd00::1]:8080'
    try:
        service_url({'spec': {'clusterIP': '10.1.2.3', 'ports': [{'name': 'other', 'port': 8080}]}})
    except RuntimeError:
        pass
    else:
        raise AssertionError('http port不在未検出')
    import io
    from unittest.mock import patch
    responses = [
        {'choices': [{'message': {'content': '2'}}]},
        {'data': [{'id': 'gemma4-26b', 'status': {'args': ['--device', 'SYCL0', '--n-gpu-layers', '99']}}]},
    ]
    output = io.StringIO()
    with patch.dict(globals(), {'check': lambda: {'fixture': True}}):
        with patch('__main__.http', side_effect=responses) as mocked_http:
            run_once(output, True)
            assert mocked_http.call_count == 2
    events = [json.loads(line)['event'] for line in output.getvalue().splitlines()]
    assert events == ['sample_pass', 'gpu_start', 'gpu_pass', 'completed'], events
    output = io.StringIO()
    with patch.dict(globals(), {'check': lambda: {'fixture': True}}):
        with patch('__main__.http', side_effect=RuntimeError('GPU failure')):
            try:
                run_once(output, True)
            except RuntimeError:
                pass
            else:
                raise AssertionError('once GPU失敗未伝播')
    assert 'completed' not in output.getvalue()
    print('fixtures PASS（クラスタ接続なし）')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='/var/tmp/BOXP-194-health-watch.jsonl')
    parser.add_argument('--gpu-test', action='store_true')
    parser.add_argument('--self-test', action='store_true')
    parser.add_argument('--once', action='store_true', help='期待版待機なしで全health checkを1回だけ実行')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    with pathlib.Path(args.output).open('a', encoding='utf-8') as handle:
        if args.once:
            try:
                run_once(handle, args.gpu_test)
                return 0
            except Exception as exc:
                write(handle, 'failed', error=str(exc))
                return 1
        write(handle, 'waiting_for_versions', max_seconds=2700, samples=61, interval_seconds=60)
        deadline = time.monotonic() + 2700
        while True:
            try:
                nodes = get('nodes')
                if versions_ok(nodes):
                    initial_health = check()
                    write(handle, 'initial_health_pass', **initial_health)
                    break
                write(handle, 'waiting', versions={x['metadata']['name']: x.get('status', {}).get('nodeInfo', {}) for x in nodes})
            except Exception as exc:
                write(handle, 'waiting_error', error=str(exc))
            if time.monotonic() >= deadline:
                write(handle, 'failed', error='全7台期待版・初期health収束待機45分timeout')
                return 1
            time.sleep(min(60, max(0, deadline - time.monotonic())))
        try:
            if args.gpu_test:
                run_gpu_test(handle)
            started = time.monotonic()
            write(handle, 'observation_start')
            for sample in range(61):
                time.sleep(max(0, started + sample * 60 - time.monotonic()))
                write(handle, 'sample_pass', sample=sample, **check())
            write(handle, 'completed', samples=61, elapsed_seconds=time.monotonic() - started)
            return 0
        except Exception as exc:
            write(handle, 'failed', error=str(exc))
            return 1


if __name__ == '__main__':
    raise SystemExit(main())
