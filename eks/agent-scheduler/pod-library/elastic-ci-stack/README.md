# elastic-ci-stack pod template

The `elastic-ci-stack` pod template mimics the
[Elastic CI Stack for AWS](https://github.com/buildkite/elastic-ci-stack-for-aws).

This directory contains:

- [`agent/`](agent) a `Dockerfile` and the scripts necessary to build an image
for this pod template.
- [`elastic-ci-stack`](elastic-ci-stack) the Kubernetes pod template YAML
- [`iam/`](iam) Kubernetes YAML and a CloudFormation template to deploy a
service account and IAM role for this pod template.

## Image

The image built in [`agent/Dockerfile`](agent/Dockerfile) includes most of the
same tools that are found in the
[Elastic CI Stack for AWS](https://github.com/buildkite/elastic-ci-stack-for-aws)
AMI:

- Docker (run as Docker in Docker)
- docker-compose
- Docker buildx
- AWS CLI
- git lfs
- Buildkite Agent plug-ins: ecr-login, docker-login, s3secrets

## IAM Resources

This pod template requires an
[AWS IAM OIDC Identity Provider](https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_create_oidc.html).
Using that the pod’s Kubernetes service account’s credentials the AWS CLI will
automatically retrieve AWS credentials using `sts:AssumeRoleWithWebIdentity`.

See the [IAM README](iam) for instructions on creating the service account and
IAM role needed.

## Compute

As this pod template includes a Docker in Docker container, it can only be
scheduled on an EC2 Node Group where `privileged` mode is permitted.

Addionally, as Docker in Docker is run as a container adjacent to the
`buildkite-agent`, and Kubernetes does not yet include a way to describe sidecar
container lifecycles, you must separately arrange for this container to be
terminated when the agent container exits. The example pod template uses the
annotations from https://github.com/nrmitchi/k8s-controller-sidecars though you
must arrange for this to be deployed to your cluster for them to have any
effect.

## Deploying

Once you have deployed the pre-requisites, you must customise this pod
template, you should:

- Replace the pod spec’s `.containers[.name = 'agent'].image` field with an
image repository you control
- Update the values of the `.containers[.name = 'agent'].env` field to match
your requirements. In particular: `BUILDKITE_QUEUE`, `BUILDKITE_SECRETS_BUCKET`,
`AWS_DEFAULT_REGION`, `AWS_REGION`, and `BUILDKITE_AGENT_TOKEN_PATH`
- Replace `.nodeSelector` to ensure affinity with your EC2 Node Group
- Replace `serviceAccountName` to match the service account your pod should have
in order to retrieve its IAM credentials

Once you have a pod spec YAML that meets your requirements, copy it to your
[pod library](../) for the `agent-scheduler` Lambda to use when scheduling
workloads on your cluster.
