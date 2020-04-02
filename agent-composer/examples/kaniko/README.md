# kaniko

The kaniko stack uses the [on-demand patterns](../../README.md#patterns) to
produce a task definition capable of building Docker images, and pushing them
to AWS ECR or Docker Hub. This task definition is capable of being run on AWS
Fargate where you cannot run privileged containers with access to the Docker
daemon.

## Template Parameters

* **Image**: Main image, must include `socat`. See [keithduncan/buildkite-base](https://github.com/keithduncan/buildkite-base/blob/master/agent/Dockerfile) for an example.
* **BuildkiteAgentImage**: Buildkite Agent sidecar image.
* **BuildkiteAgentTokenParameterPath**: Optional, The AWS SSM Parameter Store parameter
path to a Buildkite Agent registration token. Defaults to `/buildkite/agent-token`.
* **SshAgentBackend**: Optional, an `iam-ssh-agent` backend for use cloning
repositories with git+ssh.
* **DockerConfigHubTokenParameterPath**: Optional, AWS SSM Parameter Store
parameter path to a Docker Hub credentials. The parameter should store a
`SecureString` encrypted using the `aws/ssm` KMS key in the format `username:token`
e.g. `keithduncan:1234EXAMPLE`.
* **DockerConfigAwsRegistriesEcrHelper**: Optional, comma separated list of AWS
Account IDs to use [awslabs/amazon-ecr-credential-helper](https://github.com/awslabs/amazon-ecr-credential-helper)
for. To push to AWS ECR repositories for the account this is deployed to pass
`!Ref AWS::AccountId`.
* **TaskRoleArn**: Optional, the default task role to use for this task
definition. If absent, one will be generated with access to the given
`SshAgentBackend`.

## Task Definition

The `kaniko` task definition comprises these containers:

- `agent`
	- The Buildkite Agent will execute in this container.
	- The image for this container must include `socat` on `$PATH` to connect to
	the `kaniko` container along with any other tools your pipeline step needs.
	- Executes a `buildkite-agent` to acquire a Buildkite Job.
	- Shares a volume with:
		- `agent-init` to inject the `buildkite-agent` binary at `/buildkite`
		- `ssh-agent` to access the `iam-ssh-agent` keys
		- `kaniko` to provide the kaniko `executor` access to the source code
		cloned by the Buildkite Agent. This volume is mounted at the same
		absolute path in both containers so that paths don't have to be
		translated between the mount namespaces.
	- Depends on:
		- `agent-init` being SUCCESS
		- `kaniko` being HEALTHY
		- `ssh-agent` being HEALTHLY
- `agent-init`
	- An image which includes the `buildkite-agent` and a `/buildkite` volume.
- `ssh-agent`
	- Optional, `keithduncan/iam-ssh-agent` image giving the main container
	access to an `ssh-agent` for private key operations.
	- Unix domain socket shared between this container and the `agent`
	container for interprocess communication.
- `kaniko`
	- Uses an image based on `kaniko:debug` image which includes busybox and
	includes `socat`, see [keithduncan/kaniko-socat](http://github.com/keithduncan/kaniko-socat).
	- Executes `socat` as a Unix listener, connects clients to `/bin/sh` to
	provide a remote shell.
	- Shares a volume with:
		- `docker-login` to inject the generated Docker `config.json`
	- Depends on `docker-login` being SUCCESS.
- `docker-login`
	- Writes a Docker `config.json` file with authentication credentials.
	Supports a single Docker Hub token, and multiple AWS ECR login helpers.

These containers work together to allow a Buildkite Agent executing in the
`agent` container, to access the kaniko `executor` binary, while the executor
binary executes in a separate container with its own process and mount
namespaces.

## Buildkite Pipeline Example

Once this task definition is deployed to your Buildkite on-demand AWS Account, a
pipeline which uses this task definition might look like this:

```yaml
agents:
  queue: your-on-demand-queue

steps:
  - label: ":docker: :kangaroo:"
    command: echo "executor --force --verbosity=debug --context='\$PWD' --destination=keithduncan/hello-world" | socat STDIO,ignoreeof unix-connect:\$KANIKO_SOCKET
    agents:
      task-definition: kaniko
      task-role: DockerHubPublish
```

The `executor` command is piped to the remote shell, and executed in the
`kaniko` container. When the remote shell command completes, the pipeline
command step will exit.

## Buildkite Agent Plugin

Writing out the remote executor shell command in every pipeline would be error
prone. The [kanikoctl agent plugin](https://github.com/keithduncan/kanikoctl-buildkite-plugin)
wraps the command line options in a more declarative format. Using the plugin
the same pipeline would look like this:

```yaml
agents:
  queue: your-on-demand-queue

steps:
  - label: ":docker: :kangaroo:"
    plugins:
      - "keithduncan/kanikoctl#261d24e5f25e01ba0ee8f2b406c5ff7c260d2cc5":
          destination: keithduncan/hello-world
          tags:
            - latest
    agents:
      task-definition: kaniko
      task-role: DockerHubPublish
```

See [keithduncan/kanikoctl-buildkite-plugin](https://github.com/keithduncan/kanikoctl-buildkite-plugin)
for documentation on the plugin parameters.

## Builder Stack

The examples above show pushing an image to Docker Hub and depend on the
`kaniko` stack being instantiated with a
`DockerConfigHubTokenParameterPath` template parameter.

To publish to an AWS ECR repository instead, include the
[kaniko builder](builder.yml) CloudFormation stack in your template and provide
the `DockerConfigAwsRegistriesEcrHelper` parameter. This stack creates an ECR
repository and IAM Task Role with permission to push to it that you use with
the `kaniko` task definition.
