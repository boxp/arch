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
