#!/usr/bin/env bats

load '/usr/local/lib/bats/load.bash'

# export AWS_STUB_DEBUG=/dev/tty
# export SSH_ADD_STUB_DEBUG=/dev/tty
# export SSH_AGENT_STUB_DEBUG=/dev/tty
# export GIT_STUB_DEBUG=/dev/tty

@test "delegating to go binary" {
  export BUILDKITE_PLUGIN_S3_SECRETS_BUCKET=my_secrets_bucket
  export BUILDKITE_PLUGIN_S3_SECRETS_DUMP_ENV=true
  export BUILDKITE_PIPELINE_SLUG=test

  stub s3secrets-helper \
    ": echo -e \"A=hello\nB=world\necho Agent pid 42\n\""

  run bash -c "$PWD/hooks/environment && $PWD/hooks/pre-exit"

  assert_success
  assert_output --partial "Evaluating 33 bytes of env"
  assert_output --partial "~~~ Environment variables that were set"
  assert_output --partial "A=hello"
  assert_output --partial "B=world"

  unstub s3secrets-helper
}
