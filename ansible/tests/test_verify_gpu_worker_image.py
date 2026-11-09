"""Exercise scripts/images/verify-gpu-worker-image.sh against synthetic root trees.

The build pipeline runs the same script with --image (libguestfs); these tests
use --root so they run on any runner. Each case builds a tree that should pass
for golyat-2 (USB NIC, no GPU tools) and then breaks one property.
"""
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / 'scripts/images/verify-gpu-worker-image.sh'

NODE = 'golyat-2'
NODE_IP = '192.168.10.105'
INTERFACE = 'enx207bd2213354'
K8S_PKG = '1.36.5-1.1'
CRIO_PKG = '1.36.6-3.1'

DPKG_STATUS = '''Package: kubelet
Status: hold ok installed
Version: {k8s}

Package: kubeadm
Status: install ok installed
Version: {k8s}

Package: kubectl
Status: install ok installed
Version: {k8s}

Package: cri-o
Status: install ok installed
Version: {crio}

Package: docker-ce
Status: deinstall ok config-files
Version: 5:27.0.0-1

Package: multipath-tools
Status: install ok installed
Version: 0.9.4-5ubuntu5
'''


def write(root: Path, rel: str, content: str = '', mode: int | None = None):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)
    if mode is not None:
        path.chmod(mode)


def link(root: Path, rel: str, target: str):
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.symlink_to(target)


def build_tree(root: Path, *, gpu=False, multipath=True):
    write(root, 'etc/hostname', f'{NODE}\n')
    write(root, 'etc/lolice-worker-image', (
        f'node_name={NODE}\n'
        'kubernetes_version=1.36.5\n'
        'crio_version=1.36.6\n'
        f'crio_package_version={CRIO_PKG}\n'
        'static_network=True\n'
        f'gpu_runtime={"True" if gpu else "False"}\n'
        f'intel_graphics_ppa={"ppa:kobuk-team/intel-graphics" if gpu else ""}\n'
    ))
    write(root, 'etc/systemd/network/20-wired.network', (
        f'[Match]\nName={INTERFACE}\n\n[Network]\nAddress={NODE_IP}/24\n'
        'Gateway=192.168.10.1\nDNS=8.8.8.8\nDNS=8.8.4.4\n'
    ))
    link(root, 'etc/systemd/system/multi-user.target.wants/systemd-networkd.service',
         '/lib/systemd/system/systemd-networkd.service')
    write(root, 'etc/systemd/system/kubelet.service.d/10-kubeadm.conf',
          f'[Service]\nEnvironment="KUBELET_EXTRA_ARGS=--node-ip={NODE_IP}"\n')
    write(root, 'etc/kubernetes/kubelet-config.yaml', 'kind: KubeletConfiguration\n')
    link(root, 'etc/systemd/system/multi-user.target.wants/kubelet.service', '/usr/lib/systemd/system/kubelet.service')
    write(root, 'etc/crio/crio.conf.d/02-cgroup-manager.conf', '[crio.runtime]\ncgroup_manager = "systemd"\n')
    link(root, 'etc/systemd/system/multi-user.target.wants/crio.service', '/lib/systemd/system/crio.service')
    status = DPKG_STATUS.format(k8s=K8S_PKG, crio=CRIO_PKG)
    if gpu:
        status += ('Package: intel-opencl-icd\nStatus: install ok installed\nVersion: 1\n\n'
                   'Package: clinfo\nStatus: install ok installed\nVersion: 1\n\n')
    write(root, 'var/lib/dpkg/status', status)
    write(root, 'etc/ssh/sshd_config', 'PermitRootLogin no\nPasswordAuthentication no\nPubkeyAuthentication yes\n')
    link(root, 'etc/systemd/system/multi-user.target.wants/ssh.service', '/lib/systemd/system/ssh.service')
    link(root, 'etc/systemd/system/ssh.service.wants/lolice-ssh-hostkeys.service',
         '/etc/systemd/system/lolice-ssh-hostkeys.service')
    write(root, 'home/boxp/.ssh/authorized_keys', 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample boxp\n')
    write(root, 'etc/group', 'root:x:0:\nsudo:x:27:boxp\n')
    write(root, 'etc/passwd', 'root:x:0:0:root:/root:/bin/bash\nboxp:x:1000:1000::/home/boxp:/bin/bash\n')
    write(root, 'usr/local/sbin/lolice-grow-rootfs', '#!/bin/sh\n', 0o755)
    link(root, 'etc/systemd/system/multi-user.target.wants/lolice-grow-rootfs.service',
         '/etc/systemd/system/lolice-grow-rootfs.service')
    write(root, 'etc/machine-id', '')
    if multipath:
        write(root, 'etc/multipath/conf.d/90-longhorn.conf',
              'blacklist {\n    device {\n        vendor "^IET$"\n        product "^VIRTUAL-DISK$"\n    }\n}\n')
    (root / 'opt').mkdir(exist_ok=True)
    (root / 'root').mkdir(exist_ok=True)


def run_verifier(root: Path, *, gpu='false', require_multipath='true', report: Path | None = None):
    args = [str(SCRIPT), '--root', str(root), '--node', NODE, '--node-ip', NODE_IP,
            '--interface', INTERFACE, '--gpu-host-tools', gpu,
            '--kubernetes-package-version', K8S_PKG, '--crio-package-version', CRIO_PKG,
            '--require-longhorn-multipath', require_multipath]
    if report is not None:
        args += ['--report', str(report)]
    return subprocess.run(args, capture_output=True, text=True, check=False)  # noqa: S603 - fixed script path


@unittest.skipUnless(shutil.which('bash'), 'bash is required')
class VerifyGpuWorkerImageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.root = self.tmp / 'root'
        build_tree(self.root)

    def test_script_is_executable(self):
        self.assertTrue(os.access(SCRIPT, os.X_OK))

    def test_valid_tree_passes_and_writes_report(self):
        report = self.tmp / 'report.txt'
        result = run_verifier(self.root, report=report)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(f'summary: node={NODE} failures=0', result.stdout)
        self.assertNotIn('FAIL:', result.stdout)
        lines = report.read_text().splitlines()
        self.assertTrue(any(line.startswith('ok: multipath: Longhorn blacklist baked') for line in lines))
        self.assertTrue(any(line.startswith('ok: package: docker-ce absent') for line in lines))
        self.assertEqual(lines[-1], f'summary: node={NODE} failures=0 warnings=0')

    def test_gpu_tree_requires_gpu_packages(self):
        gpu_root = self.tmp / 'gpu'
        build_tree(gpu_root, gpu=True)
        self.assertEqual(run_verifier(gpu_root, gpu='true').returncode, 0)
        # A GPU image is rejected when the node is not supposed to have GPU tools.
        result = run_verifier(gpu_root, gpu='false')
        self.assertEqual(result.returncode, 1)
        self.assertIn('FAIL: package: intel-opencl-icd expected absent', result.stdout)

    def test_missing_multipath_blacklist_warns_or_fails_by_policy(self):
        plain = self.tmp / 'plain'
        build_tree(plain, multipath=False)
        warned = run_verifier(plain, require_multipath='false')
        self.assertEqual(warned.returncode, 0, warned.stdout)
        self.assertIn('warn: multipath: etc/multipath/conf.d/90-longhorn.conf absent', warned.stdout)
        failed = run_verifier(plain, require_multipath='true')
        self.assertEqual(failed.returncode, 1)
        self.assertIn('FAIL: multipath:', failed.stdout)

    def test_wrong_static_address_fails(self):
        net = self.root / 'etc/systemd/network/20-wired.network'
        net.write_text(net.read_text().replace(NODE_IP, '192.168.10.107'))
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn(f"does not match '^Address={NODE_IP}/24$'", result.stdout)

    def test_wrong_interface_name_fails(self):
        net = self.root / 'etc/systemd/network/20-wired.network'
        net.write_text(net.read_text().replace(INTERFACE, 'enp44s0'))
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn(f"does not match '^Name={INTERFACE}$'", result.stdout)

    def test_wrong_kubelet_node_ip_fails(self):
        conf = self.root / 'etc/systemd/system/kubelet.service.d/10-kubeadm.conf'
        conf.write_text(conf.read_text().replace(NODE_IP, '192.168.10.101'))
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn('FAIL: kubelet:', result.stdout)

    def test_wrong_package_version_fails(self):
        status = self.root / 'var/lib/dpkg/status'
        status.write_text(status.read_text().replace(f'Version: {K8S_PKG}', 'Version: 1.37.0-1.1', 1))
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn(f'FAIL: package: kubelet is 1.37.0-1.1, expected {K8S_PKG}', result.stdout)

    def test_baked_host_key_and_credentials_fail(self):
        write(self.root, 'etc/ssh/ssh_host_ed25519_key', 'secret\n')
        write(self.root, 'root/.aws/credentials', 'aws_access_key_id = AKIAABCDEFGHIJKLMNOP\n')
        write(self.root, 'home/boxp/id_rsa', '-----BEGIN OPENSSH PRIVATE KEY-----\nx\n-----END OPENSSH PRIVATE KEY-----\n')
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn('FAIL: ssh: baked host keys present', result.stdout)
        secrets_line = next(line for line in result.stdout.splitlines() if line.startswith('FAIL: secrets:'))
        self.assertIn('root/.aws/credentials', secrets_line)
        self.assertIn('home/boxp/id_rsa', secrets_line)

    def test_build_residue_and_password_auth_fail(self):
        (self.root / 'opt/arch-ansible').mkdir()
        sshd = self.root / 'etc/ssh/sshd_config'
        sshd.write_text(sshd.read_text().replace('PasswordAuthentication no', 'PasswordAuthentication yes'))
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn('FAIL: residue: opt/arch-ansible must not exist', result.stdout)
        self.assertIn("FAIL: ssh: etc/ssh/sshd_config does not match '^PasswordAuthentication no$'", result.stdout)

    def test_wrong_hostname_and_metadata_fail(self):
        write(self.root, 'etc/hostname', 'golyat-4\n')
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 1)
        self.assertIn(f"FAIL: identity: etc/hostname does not match '^{NODE}$'", result.stdout)

    def test_machine_id_uninitialized_passes_and_generated_fails(self):
        # The 2026-10-22 golyat-1 build shipped a generated machine-id because
        # virt-sysprep's "customize" operation re-created it.
        write(self.root, 'etc/machine-id', 'uninitialized\n')
        result = run_verifier(self.root)
        self.assertEqual(result.returncode, 0, result.stdout)
        write(self.root, 'etc/machine-id', '0123456789abcdef0123456789abcdef\n')
        result = run_verifier(self.root)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('FAIL: sysprep: etc/machine-id is not empty', result.stdout)

    def test_rejects_invalid_arguments(self):
        result = subprocess.run([str(SCRIPT), '--root', str(self.root), '--node', NODE],  # noqa: S603
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 2)
        result = run_verifier(self.root, gpu='maybe')
        self.assertEqual(result.returncode, 2)


if __name__ == '__main__':
    unittest.main()
