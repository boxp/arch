# GPU worker host tools

Installs interactive and smoke-test tools for lolice GPU worker hosts and GPU worker images.

When enabled, the role adds `ppa:quentiumyt/nvtop` and installs:

- `clinfo`
- `intel-gpu-tools`
- `nvtop`
- `vainfo`

The PPA is used because its `nvtop` package is built with Intel GPU support.
