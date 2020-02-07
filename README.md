# buildkite on-demand

This repository contains the resources you need to configure Amazon AWS resources
to schedule and run Buildkite builds on-demand.

## agent-scheduler

[agent-scheduler](agent-scheduler) is an [AWS SAM](https://aws.amazon.com/serverless/sam/)
project which configures AWS resources to respond to Amazon EventBridge events
from Buildkite and schedule agents on ECS.
