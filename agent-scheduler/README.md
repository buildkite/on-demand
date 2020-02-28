# agent-scheduler

This project contains source code and supporting files for running Buildkite
Agents on-demand in response to builds.

- `src` - Code for the Lambda functions. These have been inlined into `template.yml` for easier stack creation in any region.
- `template.yml` - A CloudFormation template that defines the AWS resources.

## Set-up Instructions

Before deploying this serverless application to your AWS account, you have to
configure the Amazon EventBridge integration between your Buildkite and AWS
accounts. See the [Buildkite Documentation](https://buildkite.com/docs/integrations/amazon-eventbridge)
for how to do this.

It is best practice to run your continuous integration in a separate AWS
account, consider creating a new AWS account in your AWS Organization for the
EventBridge integration.

Once you have associated your Buildkite Partner Event Source with an Amazon
EventBridge bus, you are ready to deploy the `agent-scheduler` stack to your
AWS Account. You can deploy this stack using the AWS Console on the web or AWS
Serverless Application Model CLI on your local device.

## Deploy using the CloudFormation Console

[![Launch AWS Stack](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=agent-scheduler&templateURL=https://buildkite-on-demand-us-east-1.s3.amazonaws.com/agent-scheduler/latest/template.yml)

The CloudFormation Console will ask you for values for the following parameters:

* **Parameter EventBridgeBusName**: The name of the Amazon EventBridge Bus you associated the Buildkite Partner Event source with **NB** ensure this is the name of the EventBus name _not_ the EventBus ARN.
* **Parameter BuildkiteQueue**: The name of the Buildkite queue this stack will service. You will use this
queue name in your Buildkite Pipeline Agent Query rules e.g. `queue=my-queue-name`
* **Parameter BuildkiteAgentToken**: A Buildkite Agent Registration token for your Buildkite account. See
the [Buildkite Agent Tokens Documentation](https://buildkite.com/docs/agent/v3/tokens) for details.
* **Parameter VpcSubnetIds**: An optional parameter. If you have an existing VPC you
want to schedule your agent containers in enter a comma separated list of subnet ids. If left blank
a simple two subnet VPC will be created.

When creating the stack you will need to check the options to allow creating
IAM resources.

## Deploy using the Serverless Application Model on the command line

The AWS SAM CLI is an extension of the AWS CLI that adds functionality for building and testing Lambda applications.

To use the AWS SAM CLI, you need the following tools:

* AWS SAM CLI - [Install the AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html). These instructions were written using SAM Version 0.40.0.
* Node.js - [Install Node.js 10](https://nodejs.org/en/), including the npm package management tool.
* Docker - [Install Docker community edition](https://hub.docker.com/search/?type=edition&offering=community).

To deploy `agent-scheduler` for the first time, run the following in your shell:

```bash
sam deploy --capabilities CAPABILITY_IAM --guided
```

This command will package and deploy `agent-scheduler` to AWS, with a series of prompts.

* **Stack Name**: The name of the stack to deploy to CloudFormation. This should be unique to your account and region,
something like `agent-scheduler`.
* **AWS Region**: The AWS region you want to deploy `agent-scheduler` and run your Buildkite builds.
The `agent-scheduler` can be deployed to multiple regions allowing you to target specific regions using Buildkite
Agent Query Rules.
* **Parameter EventBridgeBusName**: The name of the Amazon EventBridge Bus you associated the Buildkite Partner Event source with **NB** ensure this is the name of the EventBus name _not_ the EventBus ARN.
* **Parameter BuildkiteQueue**: The name of the Buildkite queue this stack will service. You will use this
queue name in your Buildkite Pipeline Agent Query rules e.g. `queue=my-queue-name`
* **Parameter BuildkiteAgentToken**: A Buildkite Agent Registration token for your Buildkite account. See
the [Buildkite Agent Tokens Documentation](https://buildkite.com/docs/agent/v3/tokens) for details.
* **Parameter VpcSubnetIds**: An optional parameter. If you have an existing VPC you
want to schedule your agent containers in enter a comma separated list of subnet ids. If left blank
a simple two subnet VPC will be created.
* **Confirm changes before deploy**: If set to yes, any change sets will be shown to you before execution for manual review. If set to no, the AWS SAM CLI will automatically deploy changes.
* **Allow SAM CLI IAM role creation**: You must answer yes to this prompt. This SAM application creates an AWS IAM role for your ECS task definitions and roles for the AWS Lambda functions. These are scoped down to minimum required permissions.
* **Save arguments to samconfig.toml**: Set to yes so your choices are saved to a configuration file inside the project. In the future you can just re-run `sam deploy` without parameters to deploy changes.
