# BOXP-239 sdnext-ipex修復計画

Ubuntu 26.04のPython 3.14がSD.Next installerで拒否される既存破損を修復する。

1. arch/loliceのmain、既存PR/run、上流Python/PyTorch XPU依存を確認する。
2. Ubuntu 24.04の現行digest、SD.Next commitをDockerfile/workflowに固定する。既存Renovate規則で24.04系列だけを許可しdigest更新を継続する。
3. installer完了ガードを維持し、noble/Python 3.12/package完全版をbuild内で確認する。通常PR、codex-review、CIを通す。
4. merge後のmain build/publish、生成image内package実測とvendor advisory、新digestとImageUpdater write-back一致を確認する。
5. stable-diffusion/cloudflared replicas 0とlocal-llm無変更を確認し、Obsidian Projects/BOXP-236/sdnext-ipex-repair.mdへ記録する。

SD.Next起動・GPU生成検証・scale変更・local-llm停止・cluster applyは行わない。GPU実機検証は未実施と明示する。問題時はPR revertでbuild定義を復旧できるが、旧imageへ戻す場合もreplicas 0を維持する。
