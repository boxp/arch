# GPU worker host tools

Installs Intel graphics runtime packages and smoke-test tools for lolice GPU worker hosts and GPU worker images.

When enabled, the role adds `ppa:kobuk-team/intel-graphics` and `ppa:quentiumyt/nvtop`, then installs:

- `clinfo`
- `intel-gsc`
- `intel-gpu-tools`
- `intel-ocloc`
- `intel-opencl-icd`
- `libze-dev`
- `libze-intel-gpu1`
- `libze1`
- `nvtop`
- `vainfo`

The nvtop PPA is used because its `nvtop` package is built with Intel GPU support.

## i915 request timeout

`gpu_worker_host_tools_i915_timeout_enabled` is false by default. The worker
playbook enables it for nodes with `gpu_host_tools: true`, independently of
package installation. `gpu_worker_host_tools_i915_request_timeout_ms` defaults
to 600000 ms (10 minutes). This affects all GPU workloads on the node, including
LLM, SD and ComfyUI: the kernel may take up to 10 minutes to terminate a truly
stuck request. Writing this unsafe parameter may taint the kernel with
`TAINT_USER`. Runtime changes apply to newly created GPU contexts.

The role writes `/etc/modprobe.d/i915-request-timeout.conf` and updates the
initramfs when that file changes. It also updates the live parameter when i915
is loaded; image builds do not modify the build host's sysfs. To restore the
original 20000 ms, set `gpu_worker_host_tools_i915_request_timeout_ms: 20000`
and apply. To stop managing it, disable the timeout setting, remove the
modprobe file, run `update-initramfs -u`, and write the live value as root with
`echo 20000 > /sys/module/i915/parameters/request_timeout_ms`. Disabling the
setting alone does not remove previous settings.
