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
to 600000 ms (10 minutes), with a minimum of 20000 ms.

The role writes `/etc/modprobe.d/i915-request-timeout.conf` and updates the
initramfs when the file changes. The setting takes effect at the next i915
module load (node reboot); applying the role does not change the running GPU
device. Writing the module sysfs parameter at runtime does not affect an
already-probed device, which has its own copy (observed on kernel 6.8).

This affects all GPU workloads on the node: the kernel cancels a truly hung
GPU request after up to 10 minutes instead of 20 seconds. A non-default value
logs `Setting dangerous option request_timeout_ms - tainting kernel` and sets
the `TAINT_USER` flag.

To roll back, set the variable to 20000 and apply the role, or remove the
modprobe file and run `update-initramfs -u`; then reboot. Disabling the setting
alone does not remove the file.
