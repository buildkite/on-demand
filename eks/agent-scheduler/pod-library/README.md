# Pod Library

Buildkite On-Demand EKS loads pod definitions from a pod library stored in an
AWS S3 bucket.

Your pod library can contain as many named pod definitions as you want.

If present, a `default.yml` pod definition will be used when your Buildkite job
agent query rules do not specify a pod definition.

The files stored in the given bucket key prefix should contain a Kubernetes Pod
Spec in YAML. See [default.yml](default.yml) for the expected format. The pod
spec must have a `container` whose name is `agent`.
