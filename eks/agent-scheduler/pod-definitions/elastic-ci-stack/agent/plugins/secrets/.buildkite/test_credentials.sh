#!/bin/bash
set -eu

export BUILDKITE_PLUGIN_S3_SECRETS_BUCKET=${TEST_BUCKET?}

pre_exit() {
  source hooks/pre-exit
}

# hooks/environment assumes `s3secrets-helper` command is available, normally
# by way of that binary existing in $PATH. But a shell function works too.
# Rather than build/install s3secrets-helper onto the build agent, build and
# run it inside docker.
# Feel free to replace this terrible hack with something better.
s3secrets-helper() {
  docker run \
    --rm \
    --volume $(pwd)/s3secrets-helper:/s3secrets-helper \
    --workdir /s3secrets-helper \
    --env-file <(env | egrep 'AWS|BUILDKITE') \
    golang:1.15 \
    bash -c 'go build && ./s3secrets-helper'
}

trap pre_exit EXIT
source hooks/environment

if [[ -d example-private-repository ]] ; then
  rm -rf example-private-repository
fi

# Cannot use git+ssh because the ephemeral ssh-agent will be started in the
# Docker container / pid namespace above and be terminated after the process
# s3secrets-helper process exits
echo "+++ Cloning private repository with https"
git clone -- https://github.com/buildkite/example-private-repository.git example-private-repository
rm -rf example-private-repository
