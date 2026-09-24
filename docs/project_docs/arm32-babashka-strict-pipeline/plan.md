# ARM32 babashka strict pipeline

## Goal

Make the ARM32 babashka native-image workflow fail immediately for every required build and test failure.

## Changes

1. Remove GraalVM CE, source-build, and native-image fallback paths.
2. Build and cache ARM32 static JDK libraries in an ARMv7 QEMU Docker container.
3. Require the boxp LLVM and Graal builds, the babashka native-image build, and qemu-arm tests to succeed.
4. Preserve the existing pinned action SHAs.

## Verification

Run YAML parsing, `actionlint`, and focused checks that no `continue-on-error`, warning fallback, or ignored-error pattern remains.
