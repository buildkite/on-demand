# Buildkite On-Demand EKS

Schedule Buildkite Agents on AWS EKS.

Buildkite On-Demand EKS is a Buildkite Agent scheduler. Built on
the Buildkite AWS EventBridge integration, containerised Buildkite Agents are
scheduled using Amazon Elastic Kubernetes Service to run on AWS Fargate or EC2.

This repository contains resources and documentation to help you configure an
AWS account to schedule and run agents for your Buildkite Organization.

Buildkite On-Demand EKS is an AWS EKS / Kubernetes specific implementation
of the Buildkite-On Demand pattern.

## Definitions

Buildkite Agents are scheduled in **pods**.

Pod definitions are loaded from a **pod library**.

Pod definitions include the software and services required
for your Buildkite Jobs to run in their **containers** e.g.
Postgres, Redis, memcached.

Pod definitions can be scheduled in **one-shot** or
~**long polling**~ mode using Jobs and Deployments respectively.
NB: **long polling** scheduling mode is not yet implemented.

An **elastic-ci-stack** pod definition is included which mimics
Buildkite’s [Elastic CI Stack for AWS](https://github.com/buildkite/elastic-ci-stack-for-aws). This pod definition includes Docker in Docker
allowing you to transfer existing Elastic CI Stack for AWS pipelines
to a new On-Demand EKS deployment. This pod definition requires the use
of EC2 Node Groups, and privileged pods for Docker in Docker.

## EKS Specific Components

The **one-shot** pod scheduler currently runs as an AWS Lambda
that is invoked via AWS EventBridge. This can be made generic
by running the Lambda code in a pod on the Kubernetes cluster directly,
configuring and exposing a publicly routed load balancer for the pod
scheduler, setting up a webhook between your Buildkite Organisation and
the pod scheduler load balancer, coordinating and configuring the webhook 
authentication between Buildkite and the pod scheduler, and enabling
"Job Scheduled" events for your webhook.

The **one-shot** pod scheduler currently uses IAM Authentication and
the [aws-iam-authenticator](https://github.com/kubernetes-sigs/aws-iam-authenticator)
webhook authenticator that is present out of the box on AWS EKS.
This can be made generic when running on Kubernetes directly
by using Kubernetes native pod service accounts, Roles, and
RoleBindings, to give the pod scheduler the necessary permissions
to self-schedule pods on the hosting cluster.

The **elastic-ci-stack** pod definition is necessarily AWS specific
by nature and mimics the EC2-based Elastic CI Stack for AWS. It
uses AWS S3 to retrieve secrets, and can be configured to login to AWS ECR.
In order to authenticate access to these services, an IAM IdP provider
for the EKS OpenID Connect service must be configured, and a mapping
between the pod’s service account and an IAM Role provided.
While these services would not be subject to change, it would be
possible to host this pod definition on a non-EKS (even non-AWS)
Kubernetes cluster so long as the necessary service account to IAM Role
mapping can be established.

## Compute

Buildkite On-Demand EKS supports both Fargate Profiles, and EC2 Node Group
compute.

If you want to mix both compute types in one cluster and namespace, ensure your
pod definition affinity or node labels attract EC2-specific pods to your EC2
node group(s) and do not match the selectors of your Fargate Profile(s). It
isn’t possible to use anti-affinity with Fargate Profiles to repel pods that
can’t be scheduled there.

The `elastic-ci-stack` pod defintion must be scheduled on an EC2 instance due to
the use of privileged mode enabling Docker in Docker.

For example, you might create a Fargate Profile for the `buildkite` namespace
with a pod selector match label of `platform: fargate`, and an EC2 Node Group
with a Kubernetes label of `platform: ec2`.

Pods that do not specify a `platform` in their `nodeSelector` or `affinity`
rules may be scheduled on either compute platform. Pods that specify
`platform: ec2`, such as the `elastic-ci-stack` pod definition, will only be
scheduled on an EC2 Node Group.