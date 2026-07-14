FROM ghcr.io/actions/actions-runner:2.335.1@sha256:08c30b0a7105f64bddfc485d2487a22aa03932a791402393352fdf674bda2c29

USER root

# The upstream runner image deliberately contains only the runner runtime.  Keep
# the tools used by this repository's self-hosted workflows here instead of
# relying on the GitHub-hosted ubuntu-latest VM tool cache.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
        ca-certificates \
        bc \
        bison \
        build-essential \
        bzip2 \
        cpio \
        curl \
        debootstrap \
        device-tree-compiler \
        file \
        flex \
        gcc-arm-linux-gnueabi \
        git \
        gzip \
        jq \
        libc6-i386 \
        lib32z1 \
        libelf-dev \
        libguestfs-tools \
        libssl-dev \
        make \
        mtd-utils \
        openssh-client \
        patch \
        python3 \
        python3-venv \
        qemu-utils \
        qemu-user-static \
        rsync \
        sudo \
        unzip \
        wget \
        xz-utils \
    && rm -rf /var/lib/apt/lists/* \
    && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner \
    && chmod 0440 /etc/sudoers.d/runner \
    && curl --fail --location --retry 3 --output /tmp/awscliv2.zip \
        https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip \
    && unzip -q /tmp/awscliv2.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscliv2.zip

USER runner
