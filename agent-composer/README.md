# agent-composer

agent-composer combines several patterns I have developed for composing
Buildkite Agent ECS Task Definitions that can be scheduled on-demand by
[`agent-scheduler`](../agent-scheduler). These patterns include:

- [Buildkite Agent Injection](#buildkite-agent-injection): using a Docker Volume
to inject the Buildkite Agent into _any_ image, allowing the use of stock images
from Docker Hub or elsewhere without modification.
- [`iam-ssh-agent` Sidecar](#iam-ssh-agent-sidecar): adding an
[`iam-ssh-agent`](https://github.com/keithduncan/iam-ssh-agent) container to
your task definitions sidecar to enable secure, IAM controlled access to SSH
keys. This allows source code repositories to be cloned without granting the
container access to the raw key material.
- [`Buildkite::ECS::TaskDefinition`](#buildkiteecstaskdefinition-cloudformation-macro)
CloudFormation Macro: a Lambda based CloudFormation macro you can deploy to your
account make writing Buildkite Agent ECS Task Definitions simple.
- [Image Builder CloudFormation Stacks](#image-builder-cloudformation-stacks):
drop in CloudFormation substacks to configure resources for building and storing
Docker images on ECR.

## Buildkite Agent Injection

Buildkite agent injection works by confining the Buildkite binary, configuration
and other directories to a single directory; copying that directory into a
`FROM scratch` image; and marking the final directory a `VOLUME`.

With that image in hand, it is then possible to schedule a container which
simply prints and exits, and use the `--volumes-from` Docker option (or platform
equivalent) to make the agent available in another container. This is possible
in both ECS Tasks and Kubernetes Pods.

I have published an injectable agent to Docker Hub available at
[`keithduncan/buildkite-sidecar`](https://hub.docker.com/r/keithduncan/buildkite-sidecar)
which auto-updates when the base image changes though it is also possible to
build your own.

## `iam-ssh-agent` Sidecar

TBD

## `Buildkite::ECS::TaskDefinition` CloudFormation Macro

`agent-transform` is a CloudFormation Transform Macro that simplifies creating
the `AWS::ECS::TaskDefinition` resources for your agents, and reduces
duplication

This macro will expand a `Type: Buildkite::ECS::TaskDefinition` CloudFormation
resource into: a task definition, a log group, an IAM Role for Execution (with
access to the given SSM secrets), and an IAM Role for the Task (with access to
the given `iam-ssh-agent` backend if any).

Using a CloudFormation macro allows passing a list of secrets and environment
variables to include, which substacks don't currently allow.

The lambda for this transform and the associated `AWS::CloudFormation::Macro`
must be deployed first if you intend to use its functionality.


A simple `Buildkite::ECS::TaskDefinition` might look like this:

```yaml
Ruby2:
	Type: Buildkite::ECS::TaskDefinition
	Properties:
  		Image: ruby:2.7
  		BuildkiteAgentImage: keithduncan/buildkite-sidecar:3
  		TaskCpu: 1024
  		TaskMemory: 2048
```

This defines a task definition called `ruby2`, which you would address in your
on-demand pipeline with an Agent Query Rule of `task-definition: ruby2`.

The main image is `ruby:2.7` from Docker Hub, the Buildkite sidecar is
`keithduncan/buildkite-sidecar:3`.

This image doesn't have an `iam-ssh-agent` sidecar and so cannot clone private
repositories.

There are no secrets or environment variables included.


A more complex `Buildkite::ECS::TaskDefinition` might look like this:

```yaml
CargoPublish:
	Type: Buildkite::ECS::Agent
	Properties:
		Image: !GetAtt BuildRust.Outputs.Image
		BuildkiteAgentImage: !GetAtt BuildAgentSidecar.Outputs.Image
		SshAgentBackend: !FindInMap [ AgentConfig, !Ref AWS::Region, SshBackend ]
		Secrets:
			- Name: CARGO_REGISTRY_TOKEN
			  ValueFrom: /crates.io/token
		TaskFamily: cargo-publish
		TaskCpu: 1024
		TaskMemory: 2048
```

This task definition uses a family name of `cargo-publish` and is used to
publish new crate versions to https://crates.io.

The main image is the output of one of the [builder stacks](#builder-stacks),
the Buildkite sidecar is also the output of a builder stack.

This image does have an `iam-ssh-agent` sidecar, included automatically by
specifying the ARN of the API Gateway stage in the `SshAgentBackend` parameter.

In order to publish a new crate version an authentication token is required.
`cargo`, the rust build tool, supports reading this token from the
`CARGO_REGISTRY_TOKEN` environment variable. By including this item in the
secret list, agent-transform adds permission to fetch and decrypt the given SSM
parameter path to the ECS Execution Role.

## Image Builder CloudFormation Stacks

TBD

- CodeBuild
- Kaniko
