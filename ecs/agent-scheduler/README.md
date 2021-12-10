# agent-scheduler

This project contains source code and supporting files for scheduling Buildkite
Agents using AWS Elastic Container Service in response to jobs.

- `src` - Code for the Lambda functions.
- `template.yml` - A CloudFormation template that defines the AWS resources.

## Prerequisites

This stack has the following prerequisites that must be deployed beforehand:

* **Buildkite Agent Registration Token SSM Parameter**: A `String` or
`SecretString` parameter that stores an agent registration token.
* **EventBridge Bus**: A AWS EventBridge bus that is associated with a Buildkite
partner event source.
* **ECS Cluster**: An ECS Cluster that will be used to schedule tasks.
* **VPC Subnets**: VPC subnets to schedule tasks in, must have network access
to the Buildkite API but can otherwise be public or private subnets.

The [on-demand template](../) will create these resources for you. Consider
whether you want to deploy the on-demand template instead.

## Deploy using the AWS Serverless Application Repository web console

[![Deploy AWS Serverless Application](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://serverlessrepo.aws.amazon.com/applications/arn:aws:serverlessrepo:us-east-1:172840064832:applications~buildkite-on-demand-scheduler)

The serverless application repository console will ask you for values for the
following parameters:

* **Application Name**: Use something descriptive, the default value of
buildkite-on-demand-scheduler is fine.
* **Parameter BuildkiteAgentTokenParameterPath**: An AWS SSM Parameter path that
stores a Buildkite Agent Registration token for this deployment to use. This can
be a `String` or `SecretString` parameter and must already exist. See the
[Buildkite Agent Tokens Documentation](https://buildkite.com/docs/agent/v3/tokens)
for details.
* **Parameter EventBridgeBusName**: The name of an Amazon EventBridge Bus
associated with a Buildkite Partner Event source **NB** ensure you provide the
name of the EventBus name _not_ the EventBus ARN.
* **Parameter BuildkiteQueue**: The name of the Buildkite queue this stack will
service. You will use this queue name in your Buildkite Pipeline Agent Query
rules e.g. `queue=my-queue-name`.
* **Parameter EcsClusterName**: The cluster name to schedule agent task
definitions using.
* **Parameter VpcSubnetIds**: A comma separated list of VPC subnet IDs to
schedule agents in.

When creating the stack you will need to check the option to acknowledge that
the app creates custom IAM roles.

## Deploy using the AWS Serverless Application Model command line interface

The AWS SAM CLI is an extension of the AWS CLI that adds functionality for
building and testing Lambda applications. See the Amazon documentation for help
[installing the AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html). These instructions were
written using SAM Version 0.40.0.

To deploy `agent-scheduler` for the first time, run the following in your shell:

```bash
sam deploy --capabilities CAPABILITY_IAM --guided
```

This command will package and deploy `agent-scheduler` to your AWS account, and
present you with a series of prompts:

* **Stack Name**: The name of the stack to deploy to CloudFormation. This should
be unique to your account and region, something like
`buildkite-on-demand-agent-scheduler`.
* **AWS Region**: The AWS region you want to deploy `agent-scheduler` to and run
your Buildkite builds in. `agent-scheduler` can be deployed to multiple regions
allowing you to target specific regions using Buildkite Agent Query Rules.
* **Parameter EventBridgeBusName**: The name of the Amazon EventBridge Bus
associated with a Buildkite Partner Event source **NB** you provide the name of
the EventBus name _not_ the EventBus ARN.
* **Parameter BuildkiteQueue**: The name of the Buildkite queue this stack will
service. You will use this queue name in your Buildkite Pipeline Agent Query
rules e.g. `queue=my-queue-name`.
* **Parameter BuildkiteAgentTokenParameterPath**: An AWS SSM Parameter path that
stores a Buildkite Agent Registration token for this deployment to use. This can
be a `String` or `SecretString` parameter and must already exist. See the
[Buildkite Agent Tokens Documentation](https://buildkite.com/docs/agent/v3/tokens)
for details.
* **Parameter VpcSubnetIds**: A comma separated list of VPC subnet IDs to
schedule agents in.
* **Parameter EcsClusterName**: The cluster name to schedule agent task
definitions using.
* **Confirm changes before deploy**: If set to yes, any change sets will be
shown to you before execution for manual review. If set to no, the AWS SAM CLI
will automatically deploy changes.
* **Allow SAM CLI IAM role creation**: You must answer yes to this prompt. This
SAM application creates an AWS IAM role for your ECS task definitions and roles
for the AWS Lambda functions. These are scoped down to minimum required
permissions.
* **Save arguments to samconfig.toml**: Set to yes so your choices are saved to
a configuration file inside the project. In the future you can just re-run
`sam deploy` without parameters to deploy changes.
