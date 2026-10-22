"""BOXP-269: per-node worker image settings resolve from vars/nodes.yml.

Covers the three contracts the P0 pipeline change relies on:
- every golyat worker has an IP and hardware entry, consistent with the
  production inventory;
- playbooks/worker-image.yml resolves the interface / GPU decision from the
  node name (image builds) while live runs keep the historical GPU default;
- the plan/apply workflows still target only the pre-existing nodes (adding
  golyat-1..3 to live management is BOXP-269 G1, a separate change).
"""
import json
import re
import subprocess
import sys
import unittest
from pathlib import Path

import yaml
from ansible.parsing.dataloader import DataLoader
from ansible.template import Templar, trust_as_template

ANSIBLE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = ANSIBLE_DIR.parent
NODES = ANSIBLE_DIR / 'vars/nodes.yml'
PLAYBOOK = ANSIBLE_DIR / 'playbooks/worker-image.yml'
INVENTORY = ANSIBLE_DIR / 'inventories/production/hosts.yml'
NODE_CONFIG_SCRIPT = REPO_ROOT / 'scripts/images/worker-node-config.py'
BUILD_WORKFLOW = REPO_ROOT / '.github/workflows/build-gpu-worker-image.yml'
APPLY_WORKFLOW = REPO_ROOT / '.github/workflows/apply-ansible.yml'
PLAN_WORKFLOW = REPO_ROOT / '.github/workflows/plan-ansible.yml'
PLAN_NODE_WORKFLOW = REPO_ROOT / '.github/workflows/plan-ansible-node.yml'

WORKERS = ['golyat-1', 'golyat-2', 'golyat-3', 'golyat-4']
EXPECTED = {
    'golyat-1': ('192.168.10.101', 'enp3s0', False),
    'golyat-2': ('192.168.10.105', 'enx207bd2213354', False),
    'golyat-3': ('192.168.10.106', 'enp3s0', False),
    'golyat-4': ('192.168.10.107', 'enp44s0', True),
}
INTERFACE_RE = re.compile(r'^[a-z][a-z0-9]*$')


def load_nodes():
    return yaml.safe_load(NODES.read_text())


class WorkerNodesVarsTest(unittest.TestCase):
    def test_every_worker_has_ip_and_hardware_entry(self):
        nodes = load_nodes()
        for node in WORKERS:
            with self.subTest(node=node):
                ip, interface, gpu = EXPECTED[node]
                self.assertEqual(nodes['node_ips'][node], ip)
                worker = nodes['worker_nodes'][node]
                self.assertEqual(worker['interface'], interface)
                self.assertIs(worker['gpu_host_tools'], gpu)
                self.assertRegex(worker['interface'], INTERFACE_RE)
                self.assertTrue(worker.get('hardware'))

    def test_only_golyat_4_bakes_gpu_host_tools(self):
        nodes = load_nodes()
        gpu_nodes = sorted(n for n, w in nodes['worker_nodes'].items() if w['gpu_host_tools'])
        self.assertEqual(gpu_nodes, ['golyat-4'])

    def test_node_ips_match_production_inventory(self):
        nodes = load_nodes()
        inventory = yaml.safe_load(INVENTORY.read_text())
        hosts = inventory['all']['children']['workers']['hosts']
        for node in WORKERS:
            with self.subTest(node=node):
                self.assertEqual(hosts[node]['node_ip'], nodes['node_ips'][node])
                self.assertEqual(hosts[node]['ansible_host'], nodes['node_ips'][node])
        self.assertEqual(sorted(nodes['worker_nodes']), sorted(hosts))

    def test_control_plane_ips_unchanged(self):
        nodes = load_nodes()
        self.assertEqual(nodes['node_ips']['shanghai-1'], '192.168.10.102')
        self.assertEqual(nodes['node_ips']['shanghai-2'], '192.168.10.103')
        self.assertEqual(nodes['node_ips']['shanghai-3'], '192.168.10.104')


class WorkerImagePlaybookResolutionTest(unittest.TestCase):
    def render(self, node, chroot_build, extra=None):
        loader = DataLoader()
        play = loader.load_from_file(str(PLAYBOOK))[0]
        variables = dict(load_nodes())
        variables['node_name'] = node
        variables['chroot_build'] = chroot_build
        for key, value in play['vars'].items():
            variables[key] = trust_as_template(value) if isinstance(value, str) else value
        # `extra` emulates -e extra vars, which outrank play vars.
        variables.update(extra or {})
        templar = Templar(loader=loader, variables=variables)
        return {
            key: templar.template(trust_as_template('{{ ' + key + ' }}'))
            for key in ('node_ip', 'worker_static_network_interface', 'worker_install_gpu_host_tools')
        }

    def test_image_build_resolves_interface_ip_and_gpu_from_node_name(self):
        for node, (ip, interface, gpu) in EXPECTED.items():
            with self.subTest(node=node):
                rendered = self.render(node, chroot_build=True)
                self.assertEqual(rendered['node_ip'], ip)
                self.assertEqual(rendered['worker_static_network_interface'], interface)
                self.assertEqual(bool(rendered['worker_install_gpu_host_tools']), gpu)

    def test_live_run_keeps_gpu_host_tools_off_by_default(self):
        # apply-ansible.yml does not pass worker_install_gpu_host_tools, so a
        # live golyat-4 run must keep the pre-BOXP-269 default (false).
        rendered = self.render('golyat-4', chroot_build=False)
        self.assertEqual(rendered['worker_static_network_interface'], 'enp44s0')
        self.assertFalse(bool(rendered['worker_install_gpu_host_tools']))

    def test_explicit_extra_var_overrides_node_defaults(self):
        rendered = self.render('golyat-1', chroot_build=True,
                               extra={'worker_install_gpu_host_tools': True,
                                      'worker_static_network_interface': 'enp9s9'})
        self.assertTrue(rendered['worker_install_gpu_host_tools'])
        self.assertEqual(rendered['worker_static_network_interface'], 'enp9s9')

    def test_playbook_asserts_known_node_and_static_network_default_off(self):
        play = yaml.safe_load(PLAYBOOK.read_text())[0]
        self.assertIs(play['vars']['worker_configure_static_network'], False)
        guard = play['pre_tasks'][0]
        self.assertEqual(guard['name'], 'Require a known worker node_name')
        self.assertIn('node_name in worker_nodes', guard['ansible.builtin.assert']['that'])
        metadata = next(t for t in play['tasks'] if t['name'] == 'Record worker image build metadata')
        self.assertNotIn("default('golyat-4')", metadata['ansible.builtin.copy']['content'])

    def test_image_metadata_records_the_baked_versions_and_is_build_only(self):
        # The 2026-10-22 golyat-1 build recorded kubernetes_version=1.32 (the
        # role default) because the pins were role params only. The record
        # must use the play-level worker_* pins and must not run on a live apply.
        play = yaml.safe_load(PLAYBOOK.read_text())[0]
        role = next(r for r in play['roles'] if r['role'] == 'kubernetes_components')
        for key in ('kubernetes_version', 'kubernetes_package_version', 'crio_version', 'crio_package_version'):
            self.assertEqual(role['vars'][key], '{{ worker_' + key + ' }}')
            self.assertIn('worker_' + key, play['vars'])
        metadata = next(t for t in play['tasks'] if t['name'] == 'Record worker image build metadata')
        content = metadata['ansible.builtin.copy']['content']
        self.assertIn('kubernetes_version={{ worker_kubernetes_version }}', content)
        self.assertIn('crio_package_version={{ worker_crio_package_version }}', content)
        self.assertEqual(metadata['when'], 'worker_image_build | bool')
        self.assertEqual(play['vars']['worker_kubernetes_version'], '1.36.5')
        self.assertEqual(play['vars']['worker_crio_package_version'], '1.36.6-3.1')


class WorkerNodeConfigScriptTest(unittest.TestCase):
    def run_script(self, node):
        return subprocess.run([sys.executable, '-I', str(NODE_CONFIG_SCRIPT), node, '--repo-root', str(REPO_ROOT)],  # noqa: S603
                              capture_output=True, text=True, check=False)

    def test_prints_node_expectations(self):
        for node, (ip, interface, gpu) in EXPECTED.items():
            with self.subTest(node=node):
                result = self.run_script(node)
                self.assertEqual(result.returncode, 0, result.stderr)
                values = dict(line.split('=', 1) for line in result.stdout.splitlines())
                self.assertEqual(values['NODE_IP'], ip)
                self.assertEqual(values['NETWORK_INTERFACE'], interface)
                self.assertEqual(values['GPU_HOST_TOOLS'], 'true' if gpu else 'false')
                self.assertEqual(values['KUBERNETES_PACKAGE_VERSION'], '1.36.5-1.1')
                self.assertEqual(values['CRIO_PACKAGE_VERSION'], '1.36.6-3.1')
                self.assertEqual(values['GATEWAY'], '192.168.10.1')

    def test_rejects_non_worker_and_unknown_nodes(self):
        for node in ('shanghai-1', 'golyat-9'):
            with self.subTest(node=node):
                result = self.run_script(node)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(node, result.stderr)


class WorkflowScopeGuardTest(unittest.TestCase):
    """BOXP-269 P0 must not widen live plan/apply targets. Update with G1."""

    def test_apply_and_plan_matrices_exclude_golyat_1_to_3(self):
        apply = yaml.safe_load(APPLY_WORKFLOW.read_text())
        self.assertEqual(apply['jobs']['apply']['strategy']['matrix']['node'],
                         ['shanghai-1', 'shanghai-2', 'shanghai-3', 'golyat-4'])
        self.assertEqual(json.loads(apply['jobs']['apply']['env']['NODE_IPS']),
                         {'shanghai-1': '192.168.10.102', 'shanghai-2': '192.168.10.103',
                          'shanghai-3': '192.168.10.104', 'golyat-4': '192.168.10.107'})
        plan = yaml.safe_load(PLAN_WORKFLOW.read_text())
        self.assertEqual(plan['jobs']['control-plane']['strategy']['matrix']['node'],
                         ['shanghai-1', 'shanghai-2', 'shanghai-3'])
        self.assertEqual(plan['jobs']['worker']['with']['node'], 'golyat-4')
        plan_node = yaml.safe_load(PLAN_NODE_WORKFLOW.read_text())
        self.assertEqual(json.loads(plan_node['jobs']['plan']['env']['NODE_IPS']),
                         json.loads(apply['jobs']['apply']['env']['NODE_IPS']))

    def test_live_worker_runs_still_pin_golyat_4_interface_explicitly(self):
        for workflow in (APPLY_WORKFLOW, PLAN_NODE_WORKFLOW):
            with self.subTest(workflow=workflow.name):
                self.assertIn('worker_static_network_interface=enp44s0', workflow.read_text())

    def test_build_workflow_is_dispatch_only_with_auto_gpu_default(self):
        workflow = yaml.safe_load(BUILD_WORKFLOW.read_text())
        self.assertEqual(list(workflow[True].keys()), ['workflow_dispatch'])
        gpu_input = workflow[True]['workflow_dispatch']['inputs']['install_gpu_host_tools']
        self.assertEqual(gpu_input['type'], 'choice')
        self.assertEqual(gpu_input['default'], 'auto')
        self.assertEqual(gpu_input['options'], ['auto', 'true', 'false'])
        text = BUILD_WORKFLOW.read_text()
        self.assertIn('verify_report', text)
        self.assertIn('latest.verify.txt', text)


if __name__ == '__main__':
    unittest.main()
