#!/bin/bash

set -euxo pipefail

pushd s3secrets-helper

mkdir -p pkg

binary="s3secrets-helper-${GOOS}-${GOARCH}"
go build -o "pkg/${binary}"

buildkite-agent artifact upload "pkg/*"