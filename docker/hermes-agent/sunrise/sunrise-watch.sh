#!/bin/sh
# Installed as a Hermes scripts entry; paths are configured privately.
set -eu
: "${SUNRISE_WATCH_CONFIG:?}"
: "${SUNRISE_WATCH_STATE:?}"
exec python3 /opt/boxp/hermes-agent/sunrise/watch.py "$SUNRISE_WATCH_CONFIG" "$SUNRISE_WATCH_STATE"
