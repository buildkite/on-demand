#!/bin/bash

set -euo pipefail

echo '--- Getting release version from buildkite meta-data'

VERSION=$(buildkite-agent meta-data get 'version')

if [ -z "${VERSION}" ]
then
	echo "Error: Missing \$VERSION, set buildkite-agent meta-data version before invoking this step"
	exit 1
fi

echo '--- Downloading releases'

rm -rf pkg
mkdir -p pkg
buildkite-agent artifact download "pkg/*" .

echo '--- Creating GitHub Release'

github-release "${VERSION}" pkg/* --commit "$(git rev-parse HEAD)" --github-repository "buildkite/elastic-ci-stack-s3-secrets-hooks"
