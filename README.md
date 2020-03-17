# buildkite on-demand

This repository contains the resources you need to configure Amazon AWS resources
to schedule and run Buildkite builds on-demand.

## agent-scheduler

[agent-scheduler](agent-scheduler) is an [AWS SAM](https://aws.amazon.com/serverless/sam/)
project which configures AWS resources to respond to Amazon EventBridge events
from Buildkite and schedule agents on ECS.

## agent-composer

[agent-composer](agent-composer) is a collection of AWS CloudFormation templates
to help create AWS ECS Task Definitions that can be scheduled on-demand by
[agent-scheduler](#agent-scheduler).

They are reusable patterns for constructing task definitions that you can
address in your Buildkite Pipelines that target the on-demand ECS cluster.