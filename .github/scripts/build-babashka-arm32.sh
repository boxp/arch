#!/usr/bin/env bash
# Builds babashka as an ARMv7 hard-float native image and verifies it under qemu-arm (BOXP-152).
#
# Usage: build-babashka-arm32.sh <phase> [args]
#   deps                  install the Debian bookworm cross toolchain and armhf libraries
#   llvm                  build the LLVM toolchain of boxp/llvm-project into $WORK/llvm
#   jdk                   cross-build the labs-openjdk static libraries into $WORK/jdk-static
#   graal                 build boxp/graal and its ARM32 C libraries
#   cap                   generate the C annotation processor cache for ARM32 with qemu-arm
#   hello                 build a Hello World image and require it to work under qemu-arm
#   babashka <version>    build babashka and require it to work under qemu-arm
#
# Debian bookworm matches IS01: glibc 2.36 and a 32-bit time_t. Every phase fails on any error, and
# there is deliberately no fallback to another architecture or a stock native-image.
set -euo pipefail

WORK="${WORK:-$PWD/work}"
OUT="${OUT:-$PWD/out}"

LLVM_REPO=https://github.com/boxp/llvm-project.git
LLVM_SHA=9828c929f29aa94bc6ce1d87f33727bc309cd25d
GRAAL_REPO=https://github.com/boxp/graal.git
GRAAL_SHA="${GRAAL_SHA:-717c28d5b92225f34460be99a80b79e3686104ad}"
MX_REPO=https://github.com/graalvm/mx.git
MX_SHA=2675b13e58f97d6d37a4090cdcb5a52c280e1d8c
LABSJDK_TAG=jvmci-25.3-b21
LABSJDK_URL="https://github.com/graalvm/labs-openjdk/releases/download/${LABSJDK_TAG}/labsjdk-ce-25.0.4.1%2B0-${LABSJDK_TAG}-linux-amd64.tar.gz"

ARM_CFLAGS="-march=armv7-a -mfpu=vfpv3-d16 -mfloat-abi=hard"
LLVM_TOOLS=(llc opt llvm-link llvm-config llvm-objcopy llvm-nm llvm-ar llvm-objdump llvm-readobj lld)
# libc6:armhf must be used: the older libc6-armhf-cross loader crashes together with it in pthread_create.
QEMU_SYSROOT=/

mkdir -p "$WORK" "$OUT"

setup_jdk() {
  BOOT_JDK="$WORK/labsjdk"
  if [ ! -x "$BOOT_JDK/bin/java" ]; then
    mkdir -p "$BOOT_JDK"
    curl --fail --silent --show-error --location "$LABSJDK_URL" | tar xz --strip-components=1 -C "$BOOT_JDK"
  fi
  export JAVA_HOME="$BOOT_JDK"
  export PATH="$BOOT_JDK/bin:$PATH"
}

setup_graal() {
  setup_jdk
  export MX_CACHE_DIR="$WORK/mx-cache"
  export PATH="$WORK/mx:$PATH"
  GRAALVM_HOME="$(cd "$WORK/graal" && mx --primary-suite-path substratevm --java-home "$BOOT_JDK" graalvm-home | tail -1)"
  export PATH="$GRAALVM_HOME/lib/svm/bin:$PATH"
  ARM32_CLIBRARIES="$GRAALVM_HOME/lib/svm/clibraries/linux-arm32/glibc"
}

native_image_arm32() {
  CC=arm-linux-gnueabihf-gcc native-image \
    "--tool:llvm-backend=$GRAALVM_HOME/lib/svm/tools/llvm-backend" \
    --target=linux-arm32 \
    -H:+UnlockExperimentalVMOptions \
    -H:CompilerBackend=llvm \
    -H:+UseLLVMDataSection \
    -H:-CheckToolchain \
    -H:-ForeignAPISupport \
    -H:-UseContainerSupport \
    --gc=serial \
    "-J-Dllvm.bin.dir=$WORK/llvm/bin" \
    -H:CCompilerPath=/usr/bin/arm-linux-gnueabihf-gcc \
    "-H:CLibraryPath=$WORK/jdk-static" \
    "-H:CLibraryPath=$ARM32_CLIBRARIES" \
    "-H:CAPCacheDir=$WORK/capcache" \
    "$@"
}

qemu_run() {
  timeout 300 qemu-arm -L "$QEMU_SYSROOT" "$@"
}

# Requires the command to exit with 0 and its output to contain the expected string.
expect_output() {
  local expected="$1" output status=0
  shift
  output="$(qemu_run "$@" 2>&1)" || status=$?
  printf '%s\n' "$output" | tail -n 20
  if [ "$status" -ne 0 ]; then
    echo "::error::exit status $status: $*"
    return 1
  fi
  if ! grep -qF -- "$expected" <<<"$output"; then
    echo "::error::missing output '$expected': $*"
    return 1
  fi
}

check_elf() {
  local info machine
  info="$(arm-linux-gnueabihf-readelf -h -l "$1")"
  machine="$(awk -F: '/Machine:/ {gsub(/^ +/, "", $2); print $2}' <<<"$info")"
  grep -q 'ELF32' <<<"$info" || { echo "::error::$1 is not ELF32"; return 1; }
  [ "$machine" = "ARM" ] || { echo "::error::$1 has machine '$machine'"; return 1; }
  grep -q 'hard-float ABI' <<<"$(arm-linux-gnueabihf-readelf -h "$1")" || { echo "::error::$1 is not hard-float"; return 1; }
  grep -qF '/lib/ld-linux-armhf.so.3' <<<"$info" || { echo "::error::$1 has an unexpected interpreter"; return 1; }
  # glibc of the IS01 userland (Debian bookworm).
  local newest
  newest="$(arm-linux-gnueabihf-readelf -V "$1" | grep -oE 'GLIBC_[0-9.]+' | sort -Vu | tail -1)"
  echo "$1: newest required symbol version $newest"
  [ "$(printf '%s\nGLIBC_2.36\n' "$newest" | sort -V | tail -1)" = "GLIBC_2.36" ] || { echo "::error::$1 requires $newest"; return 1; }
}

phase_deps() {
  export DEBIAN_FRONTEND=noninteractive
  dpkg --add-architecture armhf
  apt-get update -q
  apt-get install -y -q --no-install-recommends \
    ca-certificates git curl python3 gcc g++ make cmake ninja-build autoconf zip unzip file patch xz-utils \
    zlib1g-dev gcc-arm-linux-gnueabihf g++-arm-linux-gnueabihf libc6-dev-armhf-cross qemu-user \
    zlib1g-dev:armhf libasound2-dev:armhf libfontconfig1-dev:armhf libfreetype6-dev:armhf libcups2-dev:armhf \
    libx11-dev:armhf libxext-dev:armhf libxrender-dev:armhf libxrandr-dev:armhf libxtst-dev:armhf libxt-dev:armhf \
    libffi-dev:armhf
}

phase_llvm() {
  local src="$WORK/llvm-src" dest="$WORK/llvm"
  git init -q "$src"
  git -C "$src" fetch -q --depth 1 "$LLVM_REPO" "$LLVM_SHA"
  git -C "$src" checkout -q FETCH_HEAD
  cmake -S "$src/llvm" -B "$src/build" -G Ninja \
    -DCMAKE_BUILD_TYPE=Release \
    -DLLVM_TARGETS_TO_BUILD="ARM;X86" \
    -DLLVM_ENABLE_PROJECTS=lld \
    -DLLVM_INCLUDE_TESTS=OFF \
    -DLLVM_INCLUDE_BENCHMARKS=OFF \
    -DLLVM_INCLUDE_EXAMPLES=OFF \
    -DLLVM_ENABLE_ZSTD=OFF \
    -DLLVM_ENABLE_LIBXML2=OFF
  cmake --build "$src/build" --target "${LLVM_TOOLS[@]}"
  mkdir -p "$dest/bin"
  for tool in "${LLVM_TOOLS[@]}"; do
    cp -a "$src/build/bin/$tool" "$dest/bin/"
  done
  ln -sf lld "$dest/bin/ld.lld"
  rm -rf "$src"
  "$dest/bin/llc" --version | grep -E '^ +arm +- '
}

phase_jdk() {
  setup_jdk
  local src="$WORK/labsjdk-src" dest="$WORK/jdk-static"
  git clone -q --depth 1 --branch "$LABSJDK_TAG" https://github.com/graalvm/labs-openjdk.git "$src"
  (
    cd "$src"
    export PKG_CONFIG_PATH=/usr/lib/arm-linux-gnueabihf/pkgconfig:/usr/share/pkgconfig
    export PKG_CONFIG_LIBDIR=/usr/lib/arm-linux-gnueabihf/pkgconfig
    bash configure \
      --with-boot-jdk="$BOOT_JDK" \
      --openjdk-target=arm-linux-gnueabihf \
      --with-jvm-variants=zero \
      --with-debug-level=release \
      --disable-warnings-as-errors \
      --disable-precompiled-headers \
      --with-extra-cflags="$ARM_CFLAGS" \
      --with-extra-cxxflags="$ARM_CFLAGS"
    make JOBS="$(nproc)" static-libs-image
  )
  mkdir -p "$dest"
  find "$src/build" -name '*.a' -path '*/static-libs/*' -exec cp {} "$dest/" \;
  # libjvm.a of the image comes from SubstrateVM, not from the HotSpot of this JDK.
  rm -f "$dest/libjvm.a"
  rm -rf "$src"
  for lib in java nio net zip; do
    grep -q 'Machine: *ARM' <<<"$(arm-linux-gnueabihf-readelf -h "$dest/lib$lib.a")" || { echo "::error::lib$lib.a is not ARM"; exit 1; }
  done
}

phase_graal() {
  setup_jdk
  git clone -q "$MX_REPO" "$WORK/mx"
  git -C "$WORK/mx" checkout -q "$MX_SHA"
  git clone -q --filter=blob:none "$GRAAL_REPO" "$WORK/graal"
  git -C "$WORK/graal" checkout -q "$GRAAL_SHA"
  export MX_CACHE_DIR="$WORK/mx-cache"
  export PATH="$WORK/mx:$PATH"
  (cd "$WORK/graal" && mx --primary-suite-path substratevm --java-home "$BOOT_JDK" build)
  setup_graal

  local src="$WORK/graal/substratevm/src" obj="$WORK/clib-obj" fallbacks
  local cflags=($ARM_CFLAGS -g -fPIC -O2 -D_LITTLE_ENDIAN -ffunction-sections -fdata-sections -fvisibility=hidden -D_FORTIFY_SOURCE=0 -D_GNU_SOURCE)
  local includes=("-I$src/com.oracle.svm.native.libchelper/include" "-I$BOOT_JDK/include" "-I$BOOT_JDK/include/linux")
  mkdir -p "$obj/chelper" "$obj/jvm" "$ARM32_CLIBRARIES"
  for c in "$src"/com.oracle.svm.native.libchelper/src/*.c; do
    arm-linux-gnueabihf-gcc "${cflags[@]}" "${includes[@]}" -c "$c" -o "$obj/chelper/$(basename "$c" .c).o"
  done
  arm-linux-gnueabihf-ar rcs "$ARM32_CLIBRARIES/liblibchelper.a" "$obj"/chelper/*.o
  fallbacks="$(find "$WORK/graal/substratevm/mxbuild" -name JvmFuncsFallbacks.c -print -quit)"
  arm-linux-gnueabihf-gcc "${cflags[@]}" "${includes[@]}" -c "$src/com.oracle.svm.native.jvm.posix/src/JvmFuncs.c" -o "$obj/jvm/JvmFuncs.o"
  arm-linux-gnueabihf-gcc "${cflags[@]}" "${includes[@]}" "-I$src/com.oracle.svm.native.jvm.posix/src" -c "$fallbacks" -o "$obj/jvm/JvmFuncsFallbacks.o"
  arm-linux-gnueabihf-ar rcs "$ARM32_CLIBRARIES/libjvm.a" "$obj"/jvm/*.o
  rm -rf "$obj"
}

write_hello() {
  mkdir -p "$WORK/hello"
  cat >"$WORK/hello/Hello.java" <<'JAVA'
public class Hello {
    public static void main(String[] args) {
        System.out.println("Hello ARM32 from native-image");
    }
}
JAVA
  javac -d "$WORK/hello" "$WORK/hello/Hello.java"
}

phase_cap() {
  setup_graal
  write_hello
  local query="$WORK/query" cap="$WORK/capcache" status=0 count=0 name
  local gcc_include
  rm -rf "$query" "$cap"
  mkdir -p "$query" "$cap"
  (
    cd "$WORK/hello"
    # This option always ends the image build with a non-zero status: the queries are verified below.
    native_image_arm32 -H:+ExitAfterQueryCodeGeneration -H:+QueryIfNotInCAPCache "-H:QueryCodeDir=$query" -H:+NewCAPCache -cp . Hello hello
  ) || status=$?
  echo "query generation finished with status $status"
  gcc_include="$(arm-linux-gnueabihf-gcc --print-file-name=include)"
  for q in "$query"/*.c; do
    name="$(basename "$q" .c)"
    arm-linux-gnueabihf-gcc "$q" "-I$GRAALVM_HOME/include" "-I$GRAALVM_HOME/include/linux" "-I$gcc_include" -lm -o "$query/$name"
    qemu_run "$query/$name" >"$cap/$name.cap"
    count=$((count + 1))
  done
  echo "generated $count C annotation caches"
  for name in BuiltinDirectives JNIHeaderDirectives LLVMDirectives PosixDirectives; do
    if [ ! -s "$cap/$name.cap" ]; then
      echo "::error::missing C annotation cache $name"
      exit 1
    fi
  done
}

# Arrays have no monitor slot, so each synchronized takes the lock of the additional monitor map. This
# depends on StoreLoad ordering: without real barriers about 7 of 8 runs lost a wakeup and hung.
write_contention() {
  mkdir -p "$WORK/contention"
  cat >"$WORK/contention/Contention.java" <<'JAVA'
import java.util.concurrent.CountDownLatch;

public class Contention {
    public static void main(String[] args) throws Exception {
        int iterations = 1_000_000;
        int[] counter = new int[1];
        Thread[] threads = new Thread[2];
        CountDownLatch start = new CountDownLatch(threads.length);
        for (int i = 0; i < threads.length; i++) {
            threads[i] = new Thread(() -> {
                start.countDown();
                try {
                    start.await();
                } catch (InterruptedException e) {
                    throw new IllegalStateException(e);
                }
                for (int j = 0; j < iterations; j++) {
                    synchronized (counter) {
                        counter[0]++;
                    }
                }
            });
            threads[i].start();
        }
        for (Thread thread : threads) {
            thread.join();
        }
        System.out.println("contended " + counter[0]);
    }
}
JAVA
  javac -d "$WORK/contention" "$WORK/contention/Contention.java"
}

# A torn volatile long or a lost volatile int handoff means that the atomic accesses are wrong.
write_volatile_stress() {
  mkdir -p "$WORK/volatile"
  cat >"$WORK/volatile/VolatileStress.java" <<'JAVA'
public class VolatileStress {
    private static final long A = 0xAAAAAAAA55555555L;
    private static final long B = 0x55555555AAAAAAAAL;
    static volatile long wide = A;
    static volatile int turn;
    static volatile boolean done;

    public static void main(String[] args) throws Exception {
        Thread writer = new Thread(() -> {
            while (!done) {
                wide = B;
                wide = A;
            }
        });
        writer.start();
        for (int i = 0; i < 5_000_000; i++) {
            long seen = wide;
            if (seen != A && seen != B) {
                throw new IllegalStateException("torn volatile long: " + Long.toHexString(seen));
            }
        }
        done = true;
        writer.join();

        int rounds = 200_000;
        Thread partner = new Thread(() -> {
            for (int i = 0; i < rounds; i++) {
                while (turn != 1) {
                    Thread.onSpinWait();
                }
                turn = 0;
            }
        });
        partner.start();
        for (int i = 0; i < rounds; i++) {
            turn = 1;
            while (turn != 0) {
                Thread.onSpinWait();
            }
        }
        partner.join();
        System.out.println("volatile ok");
    }
}
JAVA
  javac -d "$WORK/volatile" "$WORK/volatile/VolatileStress.java"
}

check_barriers() {
  # qemu-arm treats the legacy CP15 barrier as a nop, and it is deprecated on ARMv7.
  local disassembly
  disassembly="$(arm-linux-gnueabihf-objdump -d "$1")"
  if grep -qE 'mcr.*cr7, cr10, \{5\}' <<<"$disassembly"; then
    echo "::error::$1 has legacy CP15 barriers"
    return 1
  fi
  grep -qE '\bdmb\b' <<<"$disassembly" || { echo "::error::$1 has no dmb barrier"; return 1; }
}

phase_hello() {
  local run
  setup_graal
  write_hello
  (cd "$WORK/hello" && native_image_arm32 -cp . Hello "$OUT/hello-arm32")
  check_elf "$OUT/hello-arm32"
  check_barriers "$OUT/hello-arm32"
  expect_output 'Hello ARM32 from native-image' "$OUT/hello-arm32"
  write_contention
  (cd "$WORK/contention" && native_image_arm32 -cp . Contention "$WORK/contention/contention-arm32")
  for run in 1 2 3 4 5 6 7 8 9 10; do
    expect_output 'contended 2000000' "$WORK/contention/contention-arm32"
  done
  write_volatile_stress
  (cd "$WORK/volatile" && native_image_arm32 -cp . VolatileStress "$WORK/volatile/volatile-arm32")
  expect_output 'volatile ok' "$WORK/volatile/volatile-arm32"
  # 64-bit volatile accesses have to use the exclusive pair: ldrd alone is not single-copy atomic on ARMv7 without LPAE.
  grep -qE '\bldrexd\b' <<<"$(arm-linux-gnueabihf-objdump -d "$WORK/volatile/volatile-arm32")" || { echo "::error::no ldrexd in the volatile test image"; exit 1; }
}

phase_babashka() {
  local version="$1" jar="$WORK/babashka.jar" unpacked="$WORK/babashka-jar" image="$OUT/babashka-arm32" props
  setup_graal
  curl --fail --silent --show-error --location -o "$jar" \
    "https://github.com/babashka/babashka/releases/download/v${version}/babashka-${version}-standalone.jar"
  rm -rf "$unpacked"
  mkdir -p "$unpacked"
  (cd "$unpacked" && unzip -q "$jar")
  # The foreign function API needs a downcall stub generator, which ARM32 does not have.
  props="$unpacked/META-INF/native-image/babashka/babashka/native-image.properties"
  grep -q 'ForeignAPISupport' "$props"
  sed -i 's/-H:+ForeignAPISupport *\\*//g' "$props"
  (cd "$unpacked" && zip -q -r "$WORK/babashka-patched.jar" .)

  (
    cd "$OUT"
    native_image_arm32 \
      --initialize-at-build-time=com.fasterxml.jackson \
      --features=babashka.impl.CharsetsFeature,clj_easy.graal_build_time.InitClojureClasses \
      -cp "$WORK/babashka-patched.jar" \
      babashka.main
    # The image name comes from native-image.properties of the jar.
    mv bb babashka-arm32
  )
  arm-linux-gnueabihf-strip "$image"
  check_elf "$image"
  ls -l "$image"
  (cd "$OUT" && sha256sum babashka-arm32 hello-arm32 | tee SHA256SUMS)

  expect_output "babashka v${version}" "$image" --version
  expect_output '6 3628800' "$image" -e '(println (+ 1 2 3) (reduce * (range 1 11)))'
  expect_output 'caught: Divide by zero' "$image" -e '(try (/ 1 0) (catch ArithmeticException e (println "caught:" (.getMessage e))))'
  expect_output '121932631112635269 1099511627776' "$image" -e '(println (* 123456789 987654321) (bit-shift-left 1 40))'
  expect_output '42 :timeout' "$image" -e '(println @(future (+ 1 41)) (deref (promise) 10 :timeout))'
  expect_output '{"a":[1,2,{"b":"c"}]}' "$image" -e '(require (quote [cheshire.core :as j])) (println (j/generate-string {:a [1 2 {:b "c"}]}))'
  expect_output '1 true' "$image" -e '(spit "/tmp/bb-arm32.txt" "x") (println (count (slurp "/tmp/bb-arm32.txt")) (pos? (count (file-seq (java.io.File. "/tmp")))))'
  expect_output '100000' "$image" -e '(println (count (reduce (fn [a i] (assoc a i (str i))) {} (range 100000))))'
  expect_output ':contended 40000' "$image" -e '(let [a (int-array 1) fs (doall (for [_ (range 2)] (future (dotimes [_ 20000] (locking a (aset a 0 (inc (aget a 0))))))))] (run! deref fs) (println :contended (aget a 0)))'
  echo "babashka ${version} works under qemu-arm (this does not prove that it works on IS01)"
}

phase="${1:?phase is required}"
shift
case "$phase" in
  deps) phase_deps ;;
  llvm) phase_llvm ;;
  jdk) phase_jdk ;;
  graal) phase_graal ;;
  cap) phase_cap ;;
  hello) phase_hello ;;
  babashka) phase_babashka "${1:?babashka version is required}" ;;
  *)
    echo "unknown phase: $phase" >&2
    exit 2
    ;;
esac
