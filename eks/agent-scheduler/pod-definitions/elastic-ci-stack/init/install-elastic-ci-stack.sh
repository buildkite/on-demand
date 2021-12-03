#!/bin/bash
set -euxo pipefail

# Required environment variables:
# SECRETS_PLUGIN_ENABLED
# ECR_PLUGIN_ENABLED
# DOCKER_LOGIN_PLUGIN_ENABLED
# BUILDKITE_AGENTS_PER_INSTANCE
# BUILDKITE_ECR_POLICY
# BUILDKITE_SECRETS_BUCKET
# BUILDKITE_STACK_NAME
# BUILDKITE_STACK_VERSION
# DOCKER_EXPERIMENTAL
# AWS_REGION
# BUILDKITE_QUEUE
# BUILDKITE_AGENT_TAGS
# INSTANCE_ID
# BUILDKITE_AGENT_TIMESTAMP_LINES
# BUILDKITE_AGENT_EXPERIMENTS
# BUILDKITE_ELASTIC_BOOTSTRAP_SCRIPT

DOCKER_VERSION=$(docker --version | cut -f3 -d' ' | sed 's/,//')

PLUGINS_ENABLED=()
[[ $SECRETS_PLUGIN_ENABLED == "true" ]] && PLUGINS_ENABLED+=("secrets")
[[ $ECR_PLUGIN_ENABLED == "true" ]] && PLUGINS_ENABLED+=("ecr")
[[ $DOCKER_LOGIN_PLUGIN_ENABLED == "true" ]] && PLUGINS_ENABLED+=("docker-login")

# cfn-env is sourced by the environment hook in builds

# We will create it in two steps so that we don't need to go crazy with quoting and escaping. The
# first sets up a helper function, the second populates the default values for some environment
# variables.

# Step 1: Helper function.  Note that we clobber the target file and DO NOT apply variable
# substitution, this is controlled by the double-quoted "EOF".
cat <<- "EOF" > /etc/buildkite-agent/env
	# The Buildkite agent sets a number of variables such as AWS_DEFAULT_REGION to fixed values which
	# are determined at AMI-build-time.  However, sometimes a user might want to override such variables
	# using an env: block in their pipeline.yml.  This little helper is sets the environment variables
	# buildkite-agent and plugins expect, except if a user want to override them, for example to do a
	# deployment to a region other than where the Buildkite agent lives.
	function set_unless_present() {
	    local target=$1
	    local value=$2

	    if [[ -v "${target}" ]]; then
	        echo "^^^ +++"
	        echo "⚠️ ${target} already set, NOT overriding! (current value \"${!target}\" set by Buildkite step env configuration, or inherited from the buildkite-agent process environment)"
	    else
	        echo "export ${target}=\"${value}\""
	        declare -gx "${target}=${value}"
	    fi
	}

	function set_always() {
	    local target=$1
	    local value=$2

	    echo "export ${target}=\"${value}\""
	    declare -gx "${target}=${value}"
	}
EOF

# Step 2: Populate the default variable values.  This time, we append to the file, and allow
# variable substitution.
cat << EOF >> /etc/buildkite-agent/env

set_always         "BUILDKITE_AGENTS_PER_INSTANCE" "$BUILDKITE_AGENTS_PER_INSTANCE"
set_always         "BUILDKITE_ECR_POLICY" "${BUILDKITE_ECR_POLICY:-none}"
set_always         "BUILDKITE_SECRETS_BUCKET" "$BUILDKITE_SECRETS_BUCKET"
set_always         "BUILDKITE_STACK_NAME" "$BUILDKITE_STACK_NAME"
set_always         "BUILDKITE_STACK_VERSION" "$BUILDKITE_STACK_VERSION"
set_always         "BUILDKITE_DOCKER_EXPERIMENTAL" "$DOCKER_EXPERIMENTAL"
set_always         "DOCKER_VERSION" "$DOCKER_VERSION"
set_always         "PLUGINS_ENABLED" "${PLUGINS_ENABLED[*]-}"
set_unless_present "AWS_DEFAULT_REGION" "$AWS_REGION"
set_unless_present "AWS_REGION" "$AWS_REGION"
EOF

agent_metadata=(
	"queue=${BUILDKITE_QUEUE}"
	"docker=${DOCKER_VERSION}"
	"stack=${BUILDKITE_STACK_NAME}"
	"buildkite-eks-stack=${BUILDKITE_STACK_VERSION}"
)

# Split on commas
if [[ -n "${BUILDKITE_AGENT_TAGS:-}" ]] ; then
	IFS=',' read -r -a extra_agent_metadata <<< "${BUILDKITE_AGENT_TAGS:-}"
	agent_metadata=("${agent_metadata[@]}" "${extra_agent_metadata[@]}")
fi

set +x
BUILDKITE_AGENT_TOKEN="$(aws ssm get-parameter --name "${BUILDKITE_AGENT_TOKEN_PATH}" --with-decryption --query Parameter.Value --output text)"
set -x

cat << EOF > /etc/buildkite-agent/buildkite-agent.cfg
name="${BUILDKITE_STACK_NAME}-${INSTANCE_ID}-%spawn"
token="${BUILDKITE_AGENT_TOKEN}"
tags=$(IFS=, ; echo "${agent_metadata[*]}")
tags-from-ec2-meta-data=true
timestamp-lines=${BUILDKITE_AGENT_TIMESTAMP_LINES}
hooks-path=/var/lib/buildkite-agent/hooks
build-path=/var/lib/buildkite-agent/builds
plugins-path=/var/lib/buildkite-agent/plugins
experiment="${BUILDKITE_AGENT_EXPERIMENTS}"
priority=%n
spawn=${BUILDKITE_AGENTS_PER_INSTANCE}
no-color=true
EOF

if [[ -n "${BUILDKITE_ELASTIC_BOOTSTRAP_SCRIPT}" ]] ; then
	/usr/local/bin/bk-fetch.sh "${BUILDKITE_ELASTIC_BOOTSTRAP_SCRIPT}" /tmp/elastic_bootstrap
	bash < /tmp/elastic_bootstrap
	rm /tmp/elastic_bootstrap
fi
