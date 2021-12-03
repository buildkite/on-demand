#!/usr/bin/env bats

load '/usr/local/lib/bats/load.bash'

# export DOCKER_STUB_DEBUG=/dev/tty

@test "Login to single registry with default password" {
  export BUILDKITE_PLUGIN_DOCKER_LOGIN_USERNAME="blah"
  export DOCKER_LOGIN_PASSWORD="llamas"

  stub docker \
    "login --username blah --password-stdin : echo logging in to docker hub"

  run $PWD/hooks/pre-command

  assert_success
  assert_output --partial "logging in to docker hub"

  unstub docker
}

@test "Login to single registry with password-env" {
  export BUILDKITE_PLUGIN_DOCKER_LOGIN_USERNAME="blah"
  export BUILDKITE_PLUGIN_DOCKER_LOGIN_PASSWORD_ENV="CUSTOM_DOCKER_LOGIN_PASSWORD"
  export CUSTOM_DOCKER_LOGIN_PASSWORD="llamas"

  stub docker \
    "login --username blah --password-stdin : echo logging in to docker hub"

  run $PWD/hooks/pre-command

  assert_success
  assert_output --partial "logging in to docker hub"

  unstub docker
}
