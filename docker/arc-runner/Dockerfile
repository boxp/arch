FROM ghcr.io/actions/actions-runner:2.335.1

USER root

# The upstream runner image deliberately contains only the runner runtime.  Keep
# the tools used by this repository's self-hosted workflows here instead of
# relying on the GitHub-hosted ubuntu-latest VM tool cache.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
        awscli \
        ca-certificates \
        curl \
        git \
        jq \
        openssh-client \
        python3 \
        python3-venv \
        unzip \
    && rm -rf /var/lib/apt/lists/*

USER runner
