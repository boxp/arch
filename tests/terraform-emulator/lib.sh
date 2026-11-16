#!/usr/bin/env bash
# shellcheck disable=SC2154 # Callers provide Docker names and image.
# 共通の Docker 実行環境。認証情報はエミュレーター生成ファイルのみを使用する。
D=/home/emulator/.aws/emulator/9297
common_env=(-e HOME=/tmp -e AWS_ENDPOINT_URL=https://127.0.0.1:9297 -e AWS_SHARED_CREDENTIALS_FILE="$D/emulator_credentials" -e AWS_CONFIG_FILE="$D/config" -e AWS_CA_BUNDLE="$D/ca.pem" -e AWS_EC2_METADATA_DISABLED=true -e AWS_DISABLE_HOST_PREFIX_INJECTION=true -e AWS_REGION=ap-northeast-1 -e TF_IN_AUTOMATION=1)
tf() { docker run --rm -u 1000 --network "container:$emu" -v "$emuhome:/home/emulator/.aws/emulator:ro" -v "$work:/work" -w /work/config "${common_env[@]}" "$tf_image" "$@"; }
aws() { docker run --rm -u 1000 --network "container:$emu" -v "$emuhome:/home/emulator/.aws/emulator:ro" "${common_env[@]}" "$AWS_CLI_IMAGE" "$@"; }
export -f aws
export emu emuhome AWS_CLI_IMAGE D
