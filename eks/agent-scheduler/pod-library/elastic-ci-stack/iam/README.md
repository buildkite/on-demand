# Creating an IAM role and associating it with a kube service account

See https://docs.aws.amazon.com/eks/latest/userguide/iam-roles-for-service-accounts.html
for AWS docs on this.

## Deploying

First deploy the template.yml to create an IAM role with an
elastic-ci-stack like policy.

```
% sam deploy --guided
```

Then, create a service account:

```
% kubectl apply -f service-account.yml -n buildkite
```

Finally, associate the service account with the IAM role ARN from the CloudFormation
template:

```
kubectl annotate serviceaccount -n buildkite elastic-ci-stack eks.amazonaws.com/role-arn=arn:aws:iam::<ACCOUNT_ID>:role/<IAM_ROLE_NAME>
```
