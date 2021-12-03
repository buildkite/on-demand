#!/bin/bash

set -euxo pipefail

if [ -z "${BUILDKITE_TAG}" ]
then
  echo "No release steps to be uploaded"
  exit 0
fi

buildkite-agent pipeline upload .buildkite/pipeline-release.yml
