#!/usr/bin/env python3
"""Read-only exact Argo ownership proof; safe to invoke without printing objects."""
from live import cluster


def check():
    for name, expected in (
        ('local-llm', {('apps', 'Deployment', 'local-llm', 'llama-server', '/spec/replicas'),
                       ('', 'ConfigMap', 'local-llm', 'llama-server-admission', '/data/state')}),
        ('stable-diffusion', {('apps', 'Deployment', 'stable-diffusion', 'qwen-image-eval', '/spec/replicas')})):
        obj = cluster('application', name, 'argocd')
        spec = obj['spec']
        actual = set()
        for rule in spec.get('ignoreDifferences', []):
            if set(rule) != {'group', 'kind', 'namespace', 'name', 'jsonPointers'}:
                raise RuntimeError('unexpected ownership rule')
            for pointer in rule['jsonPointers']:
                actual.add((rule['group'], rule['kind'], rule['namespace'], rule['name'], pointer))
        if actual != expected:
            raise RuntimeError('Argo ownership mismatch')
        policy = spec['syncPolicy']
        if policy.get('automated', {}).get('selfHeal') is not True or policy.get('automated', {}).get('prune') is not True or 'RespectIgnoreDifferences=true' not in policy.get('syncOptions', []):
            raise RuntimeError('Argo sync policy mismatch')
        if obj.get('status', {}).get('sync', {}).get('status') != 'Synced':
            raise RuntimeError('Argo not synchronized')


if __name__ == '__main__':
    check()
