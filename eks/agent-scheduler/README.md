# agent-scheduler

This project contains source code and supporting files for scheduling one-shot
Buildkite Agents using AWS Elastic Kubernetes Service in response to jobs.

- `src` - Code for the Lambda functions.
- `template.yml` - A CloudFormation template that defines the AWS resources.

## Prerequisites

This stack has the following prerequisites that must be deployed beforehand:

* **Buildkite Agent Registration Token SSM Parameter**: A `String` parameter
that stores an agent registration token for your Buildkite account.
* **EventBridge Bus**: A AWS EventBridge bus that is associated with a Buildkite
partner event source.
* **EKS Cluster**: An EKS Cluster that will be used to schedule jobs.
* **Kubernetes namespace**: A kubernetes namespace to schedule jobs in.
* **Kubernetes compute**: A kubernetes Node Group or Fategate Profile for pods
in your given namespace to execute on.

## Deploying

### Build the Lambda code

First you must download the npm packages necessary for the Lambda code. In the
`src/handlers/` directory run the following command in your shell:

```
npm install
```

### Deploy the Lambda code

Next, you must deploy the Lambda function using the AWS Serverless Application
Model CLI. The AWS SAM CLI is an extension of the AWS CLI that adds
functionality for building and testing Lambda applications. See the Amazon
documentation for help [installing the AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html).
These instructions were written using SAM Version 1.33.0.

To deploy `agent-scheduler` for the first time, run the following in your shell
from this directory:

```bash
sam deploy --guided
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
stores a Buildkite Agent Registration token for this deployment to use. This
must be be a `String` parameter and must already exist. See the
[Buildkite Agent Tokens Documentation](https://buildkite.com/docs/agent/v3/tokens)
for details.
* **Parameter KubernetesClusterIdentifier**: The cluster name to schedule agent
jobs on.
* **Parameter KubernetesNamespace**: The cluster namespace to schedule agent
jobs in. This namespace must already exist.
* **Parameter KubernetesApiServerEndpoint**: The EKS cluster HTTPS endpoint to
use for kubernetes API requests. This can be found on the EKS Dashboard under
*<Your-Cluster>* > *Configuration* > *Details* > *API server endpoint*.
* **Parameter KubernetesCertificateAuthorityData**: The EKS cluster Certificate
authority data. This can be found on the EKS Dashboard under *<Your-Cluster>* >
*Configuration* > *Details* > *Certificate authority*.
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

Subsequent deploys can be run using `sam deploy`.

### Grant Kubernetes RBAC permissions

Once you have deployed the `agent-scheduler` you must grant the Lambda’s IAM
Role permission to create jobs in your Kubernetes cluster.

These commands use the [eksctl](https://docs.aws.amazon.com/eks/latest/userguide/eksctl.html)
and [kubectl](https://docs.aws.amazon.com/eks/latest/userguide/install-kubectl.html)
command line utilities.

Once you have installed `eksctl` and `kubectl`, verify that the `aws-auth`
config map exists with the following command:

```
eksctl get iamidentitymapping --cluster <YOUR-CLUSTER> --region <YOUR-REGION>
```

Next, create an IAM mapping for the Lambda’s IAM Role. The Lambda’s IAM role
ARN can be retrieved using the AWS Lambda Console.

```
eksctl create iamidentitymapping --cluster <YOUR-CLUSTER> --region <YOUR-REGION> --arn <YOUR-AGENT-SCHEDULER-ROLE-ARN> --username buildkite-on-demand-agent-scheduler
```

Finally, using the `kubectl` apply a `Role` and `RoleBinding` to grant the
`buildkite-on-demand-agent-scheduler` user permission to create jobs:

```
eksctl utils write-kubeconfig --cluster <YOUR-CLUSTER> --region <YOUR-REGION>
kubectl create namespace buildkite
kubectl apply -f buildkite-role.yaml --namespace <YOUR-KUBERNETES-NAMESPACE>
```

### Create an IAM role, policy, and service account mapping for the elastic-ci-stack pod definition

See [pod-definitions/elastic-ci-stack/iam](pod-definitions/elastic-ci-stack/iam)
for instructions.

TODO

Docs on mixing fargate and ec2, elastic-ci-stack pod definition will
address namespace:$namespace,platform:ec2 compute, the default pod
does not address a label and thus can run across fargate or ec2. Ensure
your Fargate profile has a platform:fargate label that will prevent it
pulling platform:ec2 pods.

Add something like https://github.com/nrmitchi/k8s-controller-sidecars
that will terminate sidecar containers if the "main" / agent container
in a pod has exited.

Add way to stamp out multiple different 'elastic-ci-stack' pod definitions
each with their own service account and IAM role, likely using terraform
for multi-provider operations.
