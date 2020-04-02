# agent-composer

agent-composer combines several patterns for composing Buildkite Agent ECS Task
Definitions that can be scheduled on-demand by
[`agent-scheduler`](../agent-scheduler).

The goal is produce an ECS Task Definition for each Buildkite Pipeline or
Pipeline Step. Each task definition needs a Docker image containing the tools
you use to perform continuous integration or deployment, and optionally an IAM
Task Role to permit access to any AWS services you require. Task Definitions
don’t have to map 1:1 with Task Roles, you can share a Task Definition between
different pipelines or steps and override the Task Role for each.

See the [patterns section](#patterns) for documentation on the individual
patterns that make up agent-composer, or skip ahead to
[deploying](#deploying-task-definitions) to start building task definitions for
on-demand pipelines.


# Patterns

- [Buildkite Agent Sidecar](#buildkite-agent-sidecar): use a Docker Volume
to inject the Buildkite Agent into _any_ image, allowing the use of stock images
from Docker Hub or elsewhere without modification.
- [`iam-ssh-agent` Sidecar](#iam-ssh-agent-sidecar): add an
[`iam-ssh-agent`](https://github.com/keithduncan/iam-ssh-agent) sidecar
container to your task definition to enable secure, IAM controlled access to SSH
keys. This allows source code repositories to be cloned without granting the
agent container access to the raw key material.
- [Buildkite Agent CloudFormation Macro](#buildkite-agent-cloudformation-macro):
a Lambda based CloudFormation Macro you can deploy to your account make writing
Buildkite Agent ECS Task Definitions simple.
- [Image Builder CloudFormation Stacks](#image-builder-cloudformation-stacks):
drop in CloudFormation substacks to configure resources for building and storing
Docker images in ECR.


## Buildkite Agent Sidecar

Composing an upstream Docker image with the Buildkite Agent installed can be
repetitive and prevents tracking an official image from Docker Hub without
modification. Adding the Buildkite Agent as a sidecar container allows you to
side load the Buildkite Agent into an existing image, often replacing the need
to build a specific Docker image.

It is also possible to combine an agent sidecar with your own purpose built
images hosted on ECR, Artifactory or private Docker Hub repositories. See
[Image Builder CloudFormation Stacks](#image-builder-cloudformation-stacks)
for documentation on how to build a GitHub repository with a Dockerfile into an
image for use in your task definitions.

| Image Source | Agent Included? | Agent Sidecar Supported? |
| --- | --- | --- |
| Official Docker Hub | Unlikely | ✔︎ |
| Purpose Built | Optionally | ✔︎ |

A Buildkite Agent sidecar works by confining the Buildkite Agent binary,
configuration and other directories to a single directory; copying that
directory into a `FROM scratch` image; and marking the final directory a
`VOLUME`.

With that image in hand, it is possible to schedule a container which simply
`echo`s to stdout and exits, while using the `--volumes-from` Docker option
(or platform equivalent) to bring the `buildkite` volume in to another
container. This is possible in both ECS Tasks and Kubernetes Pods.

A ready made agent sidecar image is available on Docker Hub
[`keithduncan/buildkite-sidecar`](https://hub.docker.com/r/keithduncan/buildkite-sidecar),
though it is also possible to build your own. The source for this image is
available on [GitHub](https://github.com/keithduncan/buildkite-sidecar).

Adding the agent sidecar to your task definition can be handled by the
[CloudFormation Macro](#buildkite-agent-cloudformation-macro).


## `iam-ssh-agent` Sidecar

Adding an `iam-ssh-agent` container to your task definition allows your
Buildkite agents to clone private repositories using git+ssh without granting
the container access to the raw key material. The private keys are securely kept
behind a service interface that offers `list-keys` and `sign data` operations, a
bit like a network attached hardware security module.

To deploy an `iam-ssh-agent` backend, see the
[`iam-ssh-agent` project documentation](http://github.com/keithduncan/iam-ssh-agent).

Once you have an `iam-ssh-agent` backend, you can add the client to your task
definitions:

1. Add a volume to your task definition called `ssh-agent`.
1. Add an `Essential: true` container to your task definition that boots the
`iam-ssh-agent` in daemon mode: `iam-ssh-agent daemon --bind-to=/ssh-agent/socket`
and mounts the `ssh-agent` volume at `/ssh-agent`.
1. Mount the `ssh-agent` volume in to the container with the Buildkite Agent and
set the `SSH_AUTH_SOCK` environment variable to the path to the socket.
1. Give the ECS task definition a task role, grant this role access to the
`iam-ssh-agent` API Gateway, and permit access to the ssh keys hosted by the
service.

A full example can be seen in [`examples/ssh.yml`](examples/ssh.yml).

Adding the `iam-ssh-agent` sidecar to your task definition can be handled by the
[CloudFormation Macro](#buildkite-agent-cloudformation-macro).


## Buildkite Agent CloudFormation Macro

The [`transform`](transform) directory contains an AWS SAM project that deploys
a CloudFormation Transform Macro to simplify creating the
`AWS::ECS::TaskDefinition` resources for your agents and reduces duplication.

To use the CloudFormation Macro, deploy it to your continuous integration AWS
Account using the AWS Serverless Application Repository:

[![Deploy AWS Serverless Application](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://serverlessrepo.aws.amazon.com/applications/arn:aws:serverlessrepo:us-east-1:832577133680:applications~buildkite-on-demand-transform)

The macro expands any `Type: Buildkite::ECS::TaskDefinition` CloudFormation
resources in your template into: an ECS task definition, a log group, an ECS
Task Execution Role (with access to the given SSM secrets), and a Task Role for
the Task (with access to the given `iam-ssh-agent` backend).

The following resource parameters are supported:

- **Image**: the main image for your task definition, containing the software
you need for command steps and plugins. The `buildkite-agent` is not required
if using the `BuildkiteAgentImage` agent sidecar option.
- **BuildkiteAgentImage**: Optional, an image with the injectable
`buildkite-agent`. Should be a `FROM scratch` image that exposes a `/buildkite`
volume. If absent, your main image must include a `buildkite-agent` binary on
the image `$PATH`.
- **SshAgentBackend**: Optional, the ARN for your `iam-ssh-agent` API Gateway
stage.
- **Secrets**: Optional, a list of `{ Name: MY_NAME, ValueFrom: /ssm/parameter/path }`
objects. If given, the generated execution role is given access to fetch and
decrypt these SSM parameters.
- **Environment**: Optional, a list of `{ Name: MY_NAME, Value: MY_VALUE }`
objects to set environment variables in the container for `Image`. The Buildkite
Agent environment variables are included automatically, as is `SSH_AUTH_SOCK` if
you are using `iam-ssh-agent`.
- **TaskFamily**: the name of the task definition, must be unique per account
per region. This will be used by your Buildkite Pipelines and `agent-scheduler`
to schedule the task based on the `task-definition: my-task-definition` agent
query rule in your Pipeline Step configuration.
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


An execution role is synthesized for the task definition based on the `Secrets`
parameter and is not otherwise configurable.


Using a CloudFormation Macro allows passing the list of secrets and environment
variables to include which substacks don't currently allow.

The Lambda for this transform and the associated `AWS::CloudFormation::Macro`
must be deployed first if you intend to use its functionality.


#### Simple `Buildkite::ECS::TaskDefinition` Example

```yaml
Ruby2:
  Type: Buildkite::ECS::TaskDefinition
  Properties:
    Image: ruby:2.7
    BuildkiteAgentImage: keithduncan/buildkite-sidecar:latest
    TaskFamily: ruby2
    TaskCpu: 1024
    TaskMemory: 2048
```

This creates a task definition called `ruby2`, which you would address in your
on-demand pipeline with a `task-definition: ruby2` Agent Query Rule.

The main image is `ruby:2.7` from Docker Hub, the Buildkite sidecar is
`keithduncan/buildkite-sidecar:latest`.

This image doesn't have an `iam-ssh-agent` sidecar and so cannot clone private
repositories.

There are no secrets or environment variables included.


#### Complex `Buildkite::ECS::TaskDefinition` Example

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

The main image is the output of an [image builder stack](#image-builder-cloudformation-stacks),
and the Buildkite sidecar is also the output of a builder stack.

The task definition will include an `iam-ssh-agent` sidecar, by specifying the
ARN of the API Gateway stage in the `SshAgentBackend` parameter.

To allow the Pipeline Steps that use this task definition to publish Rust
crates, an authentication token is included in the environment. `cargo`, the
Rust build tool, supports reading this token from the `CARGO_REGISTRY_TOKEN`
environment variable. By including this item in the list of secrets, the macro
adds permission to fetch and decrypt the given SSM parameter path to the task
definition's ECS Execution Role.


## Image Builder CloudFormation Stacks

If you cannot compose a task definition from stock Docker Hub images and an
[agent sidecar](#buildkite-agent-sidecar), you can build your own base
image. Building your own base image and the agent sidecar are not mutually
exclusive, you can still use an agent sidecar with your own base images.

You can build your own base images using whatever technology or stack you
choose, so long as the resulting image can be fetched by your ECS Cluster.
`agent-composer` includes two example image builder stacks that you can use or
repurpose:

- [`CodeBuild`](examples/codebuild/codebuild.yml): creates an AWS CodeBuild
Project to build an image from a Dockerfile in a GitHub repository, and stores
the result in AWS ECR. This stack requires you to connect CodeBuild to GitHub
using OAuth ahead of time. Use an account that has read access to the
repositories you want to build. Consider creating a machine user in your GitHub
organisation for this. Alternatively, you can build open source repositories
without authentication.
- [`Kaniko`](examples/kaniko/kaniko.yml): creates an ECS Task Definition that
can be scheduled by agent-scheduler. The task definition uses [GoogleContainerTools/kaniko](http://github.com/GoogleContainerTools/kaniko)
to allow building Docker images without access to a Docker daemon, making it
suitable for use on AWS ECS and Fargate. This allows you to use Buildkite
Pipelines to build Docker images instead of a CodeBuild Project. The Kaniko
stack works in conjunction with the [`examples/kaniko/builder.yml`](examples/kaniko/builder.yml)
stack to provide somewhere to store the built images. See the
[kaniko stack documentation](examples/kaniko) for more details.


# Deploying Task Definitions

Deploying your task definitions is best done as part of a CloudFormation
template. This ensures that the task family names, CPU and memory requirements
are all written down and deployable in a repeatable fashion. You can split your
task definitions across multiple CloudFormation templates but consider that task
definition names must be unique per account per region.

The following examples use the
[Buildkite Agent CloudFormation Macro](#buildkite-agent-cloudformation-macro) as
a [template transform](https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/transform-section-structure.html). [Deploy the CloudFormation Macro](transform/README.md#deploying)
to your AWS Account before using these examples.

To start adding task definitions, create a new source code repository for your
on-demand infrastructure and create a `template.yml` file that looks like this:

```yaml
AWSTemplateFormatVersion: 2010-09-09
Description: >-
  Buildkite Agent Task Definitions

Transform:
- Buildkite-Agents-2020-03-21

Resources: {}
```

You can choose how to deploy this template to your infrastructure. For solo
developers, you can use either the AWS CLI or AWS SAM CLI, consider using
something like [aws-vault](https://github.com/99designs/aws-vault) to store your
AWS Account credentials securely. For teams, consider using a Buildkite Pipeline
and IAM Role with permission to deploy the CloudFormation template for
continuous deployment of your infrastructure.

### AWS CLI

```bash
template$ aws-vault exec ci-account -- aws cloudformation deploy --template-file template.yml --stack-name agent-composer
```

### AWS SAM

```bash
template$ aws-vault exec ci-account -- sam deploy --template-file template.yml --stack-name agent-composer
```

The following examples show you how to:

- [Create a default task definition](#default-task-definition)
- [Test a simple Rails application](#testing-rails-applications)
- [Build Docker images](#building-docker-images)
- [Clone private repositories with git+ssh](#cloning-private-repositories)

## Default Task Definition

`agent-scheduler` defaults to a `buildkite` task definition if the pipeline
steps don’t include a `task-definition` in the agent query rules. Add a default
task definition to your CloudFormation template like this:

```yaml
AWSTemplateFormatVersion: 2010-09-09
Description: >-
  Buildkite Agent Task Definitions

Transform:
- Buildkite-Agents-2020-03-21

Resources:
  Buildkite:
    Type: Buildkite::ECS::TaskDefinition
    Properties:
      Image: keithduncan/buildkite-base
      BuildkiteAgentImage: keithduncan/buildkite-sidecar
      TaskFamily: buildkite
      TaskCpu: 256
      TaskMemory: 512
```

This task definition uses a [base image](https://github.com/keithduncan/buildkite-base)
and [agent sidecar image](https://github.com/keithduncan/buildkite-sidecar)
from Docker Hub. You can of course use your own base image with your own set
of pre-installed software. Avoid installing too much in your base image, prefer
to use more specific task definitions with their own image to avoid collisions
or version requirement conflicts.

To test that your on-demand infrastructure is working, create a new Buildkite
Pipeline for a public repository that uses your `agent-scheduler`, and create a
step that uses this task definition:

```yaml
agents:
  queue: your-agent-scheduler-queue

steps:
  - label: "Hello"
    command: echo hello
    agents:
      task-definition: buildkite
```

Create a new build for this pipeline and check that an agent is created to run
the job.

## Testing Rails Applications

To run the tests for a simple Rails project we need a task definition that
includes the Ruby interpreter. Add a new task definition to your template
resources section like this:

```yaml
Resources:
  Ruby2:
    Type: Buildkite::ECS::TaskDefinition
    Properties:
      Image: ruby:2.7.0
      BuildkiteAgentImage: keithduncan/buildkite-sidecar
      TaskFamily: ruby2
      TaskCpu: 1024
      TaskMemory: 2048
```

This task definition uses the stock `ruby:2.7.0` image from Docker Hub and adds
a Buildkite Agent sidecar. It also has more CPU and memory than the default task
definition.

A Buildkite Pipeline that uses this task definition to test a Rails application
might look like this:

```yaml
agents:
  queue: your-agent-scheduler-queue
  task-definition: ruby2

steps:
  - command:
      - bundle install
      - rake db:schema:load test RAILS_ENV=test
    label: ":rails:"
    env:
      RUBYOPT: "-W:no-deprecated -W:no-experimental"
```

This pipeline will install the gem dependencies using Bundler, load the database
schema for the test environment and then run tests.

## Building Docker Images

To build Docker images using the [kaniko](examples/kaniko) task definition, you
can include the kaniko sub-stack in your template. You can use this task
definition to build general purpose docker images or even additional base images
for use in your Buildkite on-demand infrastructure.

```yaml
Resources:
  Kaniko:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: examples/kaniko/kaniko.yml
      Parameters:
        Image: keithduncan/buildkite-base
        BuildkiteAgentImage: keithduncan/buildkite-sidecar
        DockerConfigAwsRegistriesEcrHelper:
          !Join
            - ","
            - [ !Sub "${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com" ]
```

`keithduncan/buildkite-base` includes `socat` which is needed to communicate
with the kaniko sidecar container.

This instantiation of the kaniko stack configures kaniko to use `ecr-login` when
pushing images to the AWS Elastic Container Registry for this account.
N.B. while the Docker configuration will use `ecr-login` to authenticate to ECR,
you must use a task role with permission to push to the ECR repository you want
to use, otherwise the image push will fail.

To give your Buildkite Pipeline somewhere to push and store an image,
instantiate a copy of the kaniko builder stack. This sub-stack creates an ECR
repository and IAM Role with ECR repository push permission:

```yaml
Resources:
  BuildExampleImage:
    Type: AWS::CloudFormation::Stack
    Properties:
      TemplateURL: examples/kaniko/builder.yml
      Parameters:
        RepositoryName: example-repository
        TaskRoleName: BuildExampleImage
```

N.B. to create named roles that you can reference in your Buildkite Pipeline
steps, your CloudFormation stack will need `CAPABILITY_NAMED_IAM`.

Now, you combine these two stacks with a Buildkite Pipeline:

```yaml
agents:
  queue: your-agent-scheduler-queue

steps:
  - label: ":docker: :kangaroo:"
    plugins:
      - "keithduncan/kanikoctl#261d24e5f25e01ba0ee8f2b406c5ff7c260d2cc5":
          destination: 1234EXAMPLE.dkr.ecr.us-east-1.amazonaws.com/my-ecr-repository
    agents:
      task-definition: kaniko
      task-role: BuildExampleImage
```

This pipeline uses the kaniko task definition, and the `BuildExampleImage` task
role to build and push an image to an ECR repository. You should instantiate as
many `example/kaniko/builder.yml` stacks as you need to store images.

## Cloning Private Repositories

All the examples so far have used public repositories with no authentication.
Unlike the Buildkite Elastic CI Stack, there is no support for copying
private keys to the on-demand agents. Instead, Buildkite on-demand uses role
based access to an [`iam-ssh-agent`](https://github.com/keithduncan/iam-ssh-agent)
backend which uses the caller's IAM identity to provide signatures for
pre-selected ssh keys.

See the the [`iam-ssh-agent` deployment documentation](https://github.com/keithduncan/iam-ssh-agent/tree/master/service#deploying)
for details on how to deploy a copy of this serverless application to your AWS
Organization.

Once you have deployed the service, and [added your private keys](https://github.com/keithduncan/iam-ssh-agent/#adding-keys), you can create a task role in your on-demand
account and [grant it access](https://github.com/keithduncan/iam-ssh-agent/#granting-access-to-keys)
to an ssh key.

To add the `iam-ssh-agent` sidecar to your task definition you add the
`SshAgentBackend` parameter to a `Buildkite::ECS::TaskDefinition` resource.
Adding the `iam-ssh-agent` sidecar to the Ruby task definition would like this:

```diff
 Resources:
   Ruby2:
     Type: Buildkite::ECS::TaskDefinition
     Properties:
       Image: ruby:2.7.0
       BuildkiteAgentImage: keithduncan/buildkite-sidecar
+      SshAgentBackend: arn:aws:execute-api:us-east-1:12345EXAMPLE:zEXAMPLE12/Prod
       TaskFamily: ruby2
       TaskCpu: 1024
       TaskMemory: 2048
```

`Buildkite::ECS::TaskDefinition` resources automatically create a task role with
permission to access the `SshAgentBackend` if given. You can choose to give this
default role permission to access the ssh keys, or create a new role that has
access. A task definition can be scheduled with different roles and can be
reused between projects including between open or closed source.

If you choose to create a non-default role, ensure you include an IAM Policy to
[grant access to the API Gateway](https://github.com/keithduncan/iam-ssh-agent/#granting-access-to-the-api-gateway).
