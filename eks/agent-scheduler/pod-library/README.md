# Pod Library

Buildkite On-Demand EKS loads pod definitions from a pod library stored in an
AWS S3 bucket.

Your pod library can contain as many named pod definitions as you want.

If present, a `default.yml` pod definition will be used when your Buildkite job
agent query rules do not specify a pod definition.

The files stored in the given bucket key prefix should contain a Kubernetes Pod
Spec in YAML. See [default.yml](default.yml) for the expected format. The pod
spec must have a `container` whose name is `agent`.

Pod specs defined in your pod definition library must be configured to supply
a Buildkite Agent token to the `buildkite-agent`. You might accomplish this
using an environment variable and `valueFrom` a [native Kubernetes secret](https://kubernetes.io/docs/tasks/configmap-secret/managing-secret-using-kubectl/),
or something like the [AWS Secrets and Configuration Provider driver](https://docs.aws.amazon.com/eks/latest/userguide/manage-secrets.html)
to expose AWS Secrets Manager and AWS SSM Parameter Store values to your pods.

See [`elastic-ci-stack`](elastic-ci-stack) for an example pod
definition that mimics the [Elastic CI Stack for AWS](https://github.com/buildkite/elastic-ci-stack-for-aws).
