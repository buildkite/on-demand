# Pod Library

Buildkite On-Demand EKS loads pod definitions from a pod library stored in an
AWS S3 bucket.

Your pod library can contain as many named pod definitions as you want.

If present, a `default.yml` pod definition will be used when your Buildkite job
agent query rules do not specify a pod definition.
