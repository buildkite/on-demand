# Buildkite On-Demand

Schedule single-shot Buildkite Agents, on-demand, on ECS.

Buildkite On-Demand is an event driven Buildkite Agent scheduler. Built on the
Buildkite AWS EventBridge integration, containerised Buildkite Agents are
scheduled using Amazon Elastic Container Service to run on AWS Fargate. An agent
is created for each build and exits immediately on completion. There are no
polling agents so you only pay for the compute time you use.

This repository contains resources and documentation to help you configure an
AWS account to schedule and run agents for your Buildkite Organization in
response to builds.

## Set-up Instructions

Before deploying Buildkite On-Demand to your AWS account, configure the Amazon
EventBridge integration between your Buildkite and AWS accounts. See the
[Buildkite Documentation](https://buildkite.com/docs/integrations/amazon-eventbridge)
for how to do this.

It is best practice to run your continuous integration in a separate AWS
account. Consider creating a new AWS account in your AWS Organization for the
EventBridge integration.

Once you have associated your Buildkite Partner Event Source with an Amazon
EventBridge bus, you are ready to deploy the on-demand stack to your AWS
Account. You can deploy this stack using the AWS CloudFormation Console in a
browser or the AWS CLI in your terminal.

### Deploy using the AWS CloudFormation web console

[![Launch AWS Stack](https://cdn.rawgit.com/buildkite/cloudformation-launch-stack-button-svg/master/launch-stack.svg)](https://console.aws.amazon.com/cloudformation/home#/stacks/new?stackName=buildkite-on-demand&templateURL=https://buildkite-on-demand-us-east-1.s3.amazonaws.com/on-demand/latest/template.yml)

### Deploy using the AWS CloudFormation command line interface

TBD

# Modular Design

The default On-Demand template combines several components to give you a simple
off the shelf experience. If you want to customise how these components are
combined, you can fork the [template repository](https://github.com/keithduncan/buildkite-on-demand-template). The default template includes:

- A simple VPC with two public subnets and an Internet Gateway.
	- You can override this behaviour by providing a comma separated list of
	VPC Subnet IDs in the optional `VpcSubnetIds` parameter.
	- For more complex VPC designs or you may want to swap out the entire VPC
	substack with something of your own design, or `!ImportValue` from an
	existing VPC CloudFormation stack.
- A `String` SSM Parameter for your Buildkite Agent Registration Token.
	- CloudFormation cannot currently create `SecureString` parameters, if you
	want to store this token securely you can create it yourself and pass a
	different parameter path to the `agent-scheduler` stack.
- An `agents` substack and CloudFormation Macro.
	- Using a substack to define your agent task definitions and task roles
	ensures your infrastructure is continuously deployable. The CloudFormation
	Macro makes writing these task definitions easy. This component is
	entirely optional, you could create your task definitions using the
	technology stack you are most comfortable with.

# Subprojects

## agent-scheduler

[agent-scheduler](agent-scheduler) is an [AWS SAM](https://aws.amazon.com/serverless/sam/)
project which configures the AWS resources needed to respond to Amazon
EventBridge events from Buildkite and schedule agents on ECS.

## agent-composer

[agent-composer](agent-composer) is a collection of AWS CloudFormation templates
to help create ECS Task Definitions that can be scheduled on-demand by
[agent-scheduler](#agent-scheduler).

### agent-composer/transform

[agent-composer/transform](agent-composer/transform) is an AWS CloudFormation
Macro that makes writing Buildkite Agent `AWS::ECS::TaskDefinitions` simple.
