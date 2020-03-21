# agent-composer

agent-composer combines several patterns I have developed for composing
Buildkite Agent ECS Task Definitions that can be scheduled on-demand by
[`agent-scheduler`](../agent-scheduler).

The goal is produce a Docker image containing the tools you use to perform
continuous integration or deployment, and an IAM Task Role to permit access to
any AWS services you require, wrapped together in an ECS Task Definition, for
each pipeline or pipeline step. Task Definitions don’t have to map images 1:1
with Task Roles, you can reuse the same image for different pipelines or steps
with and override the Task Role at scheduling time.

Composing a Docker image with the Buildkite Agent installed can be repetitive
and prevents tracking an official image from Docker Hub without modification.
[Buildkite Agent Injection](#buildkite-agent-injection) allows you to side load
the Buildkite Agent into an existing image, reducing the need to build your own
Docker images.

It is also possible to combine Agent Injection with your own purpose built
images hosted on ECR, Artifactory or private Docker Hub repositories, anywhere
you can configure ECS to pull an image from. See
[Image Builder CloudFormation Stacks](#image-builder-cloudformation-stacks)
for documentation on how to easily build a GitHub repository with a Dockerfile
into an image for use in your task definitions.

| Image Source | Agent Included? | Can Inject Agent? |
| --- | --- | --- |
| Official Docker Hub | Typically, no | ✔︎ |
| Purpose Built | If needed | ✔︎ |


# Patterns

- [Buildkite Agent Injection](#buildkite-agent-injection): use a Docker Volume
to inject the Buildkite Agent into _any_ image, allowing the use of stock images
from Docker Hub or elsewhere without modification.
- [`iam-ssh-agent` Sidecar](#iam-ssh-agent-sidecar): add an
[`iam-ssh-agent`](https://github.com/keithduncan/iam-ssh-agent) sidecar
container to your task definition to enable secure, IAM controlled access to SSH
keys. This allows source code repositories to be cloned without granting the
container access to the raw key material.
- [`Buildkite::ECS::TaskDefinition` CloudFormation Macro](#buildkiteecstaskdefinition-cloudformation-macro):
a Lambda based CloudFormation macro you can deploy to your account make writing
Buildkite Agent ECS Task Definitions simple.
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
which auto-updates when the base image changes, though it is also possible to
build your own. The source for this image is hosted on
[GitHub](https://github.com/keithduncan/buildkite-sidecar).


## `iam-ssh-agent` Sidecar

Adding an `iam-ssh-agent` container to your task definition allows your
Buildkite agents to clone private repositories without granting them access to
the raw key material. The private keys are securely kept behind a service
interface that offers `list-keys` and `sign data` operations, a bit like a
network attached hardware security module.

Incorporating the `ssh-agent` requires these steps:

1. Add a volume to your task definition called `ssh-agent`.
1. Add an `Essential: true` container to your task definition that boots the
`iam-ssh-agent` in daemon mode: `iam-ssh-agent daemon --bind-to=/ssh-agent/socket`
and mounts the `ssh-agent` volume at `/ssh-agent`.
1. Mount the `ssh-agent` volume in to the container with the Buildkite Agent and
set the `SSH_AUTH_SOCK` environment variable to the path to the socket.
1. Give the ECS task definition a task role, grant this role access to the
`iam-ssh-agent` API Gateway, and permit access to the ssh keys hosted by the
service. For in depth details see the
[`iam-ssh-agent` documentation](http://github.com/keithduncan/iam-ssh-agent).

A full example can be seen in [`examples/ssh.yml`](examples/ssh.yml).

## `Buildkite::ECS::TaskDefinition` CloudFormation Macro

[`agent-transform`](agent-transform) is a CloudFormation Transform Macro that
simplifies creating the `AWS::ECS::TaskDefinition` resources for your agents,
and reduces duplication.

This transform expands any `Type: Buildkite::ECS::TaskDefinition` resources
into: an ECS task definition, a log group, an IAM Role for Execution (with
access to the given SSM secrets), and an IAM Role for the Task (with access to
the given `iam-ssh-agent` backend if given).

The following resource parameters are supported:

- **Image**: the main image for your task definition, containing the software
you need for command steps and plugins. The `buildkite-agent` is not required
if using the `BuildkiteAgentImage` agent injection option.
- **BuildkiteAgentImage**: Optional, an image with the injectable
`buildkite-agent`. Should be a `FROM scratch` image that exposes a `/buildkite`
volume.
- **SshAgentBackend**: Optional, the ARN for your `iam-ssh-agent` API Gateway
stage
- **Secrets**: Optional, a list of `{ Name: MY_NAME, ValueFrom: /ssm/parameter/path }`
objects. If given the execution role is given access to fetch and decrypt these
SSM parameters.
- **Environment**: Optional, a list of `{ Name: MY_NAME, Value: MY_VALUE }`
objects to set environment variables in the container for `Image`. The Buildkite
Agent environment variables are included automatically, as is `SSH_AUTH_SOCK` if
you are using `iam-ssh-agent`.
- **TaskFamily**: the name of the task definition, must be unique per account
per region. This will be used by `agent-scheduler` to schedule the task based on
a `task-definition: my-task-definition` agent query rule in your Buildkite
Pipeline Steps.
- **TaskMemory**: how much memory to create the task with, see the
[`AWS::ECS::TaskDefinition` documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ecs-taskdefinition.html#cfn-ecs-taskdefinition-memory)
for appropriate values.
- **TaskCpu**: how much CPU to create the task with, see the
[`AWS::ECS::TaskDefinition` documentation](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-ecs-taskdefinition.html#cfn-ecs-taskdefinition-cpu)
for appropriate values.
- **TaskRoleArn**: Optional, the default task role for this task definition.
If unspecified one will be created for you and optionally granted access to the
given `iam-ssh-agent` API Gateway. If you provide your own task role and are
using `iam-ssh-agent` you are responsible for ensuring an appropriate access
policy is included.


An execution role is synthesized based on the `Secrets` parameter and is not
otherwise currently configurable.


Using a CloudFormation macro allows passing the list of secrets and environment
variables to include which substacks don't currently allow.

The Lambda for this transform and the associated `AWS::CloudFormation::Macro`
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

If you cannot compose an agent from a stock image with [agent injection](#buildkite-agent-injection)
you can build an image instead.

There are two image builder stack examples:

- [`CodeBuild`](examples/codebuild/codebuild.yml): creates an AWS CodeBuild Project to
build an image from a Dockerfile in a GitHub repository and stores the result in
AWS ECR. This stack requires you to connect CodeBuild to GitHub using OAuth with
an account that has access to the repositories you want to build. Alternatively,
you can build open source repositories without authentication.
- [`Kaniko`](examples/kaniko/builder.yml): creates an ECR repository and a task role with
permission to push to this repository. This stack works in conjunction with the
[`examples/kaniko/kaniko.yml`](examples/kaniko/kaniko.yml) stack to build images
using an on-demand Buildkite Agent task definition. See the
[kaniko documentation](examples/kaniko) for more details on this stack.
