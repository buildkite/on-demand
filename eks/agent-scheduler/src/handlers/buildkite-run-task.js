const AWS = require('aws-sdk');
const aws4 = require('aws4');
const k8s = require('@kubernetes/client-node');

function getAgentQueryRule(rule, agentQueryRules) {
    let taskDefinition = agentQueryRules.filter(query_rule => {
            return query_rule.startsWith(`${rule}=`);
        })
        .map(query_rule => {
            return query_rule.split("=")[1];
        })
        .shift();
    
    return taskDefinition;
}

async function sleep(ms){
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    });
}

async function defaultKubernetesJobForBuildkiteJob(buildkiteJob) {
    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1EnvVar.ts#L19

    // TODO: ideally this would not be stored in plaintext in the env, but
    // supporting arbitrary containers and AssumeRole from k8s roles to get
    // ssm:GetParameter support might not be possible
    const agentTokenVar = new k8s.V1EnvVar();
    agentTokenVar.name = "BUILDKITE_AGENT_TOKEN"
    agentTokenVar.value = process.env.BUILDKITE_AGENT_TOKEN;

    const jobIdVar = new k8s.V1EnvVar();
    jobIdVar.name = "BUILDKITE_AGENT_ACQUIRE_JOB";
    jobIdVar.value = buildkiteJob.uuid || buildkiteJob.id;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Container.ts#L27
    const buildkiteAgentContainer = new k8s.V1Container();
    buildkiteAgentContainer.name = "agent"
    buildkiteAgentContainer.image = "buildkite/agent:3"
    buildkiteAgentContainer.env = [
        agentTokenVar,
        jobIdVar,
    ]
    buildkiteAgentContainer.args = [
        "start",
        "--disconnect-after-job",
        "--disconnect-after-idle-timeout=10"
    ]

    let cpuRequest = getAgentQueryRule("cpu", buildkiteJob.agent_query_rules);
    let memoryRequest = getAgentQueryRule("memory", buildkiteJob.agent_query_rules);

    if (cpuRequest != undefined || memoryRequest != undefined) {
        let requests = {}

        // These use the k8s native request units
        // https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#resource-units-in-kubernetes
        if (cpuRequest != undefined) {
            requests.cpu = cpuRequest
        }
        if (memoryRequest != undefined) {
            requests.memory = memoryRequest
        }

        // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1ResourceRequirements.ts#L18
        const buildkiteAgentResources = new k8s.V1ResourceRequirements()
        buildkiteAgentResources.requests = requests

        // When using a Fargate Profile, it natively rounds up to the required
        // cpu:memory profile needed.
        //
        // https://docs.aws.amazon.com/eks/latest/userguide/fargate-pod-configuration.html
        buildkiteAgentContainer.resources = buildkiteAgentResources
    }

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1PodSpec.ts#L29
    const podSpec = new k8s.V1PodSpec();
    podSpec.containers = [
        buildkiteAgentContainer,
    ];
    podSpec.restartPolicy = "Never"

    const podTemplate = new k8s.V1PodTemplateSpec();
    podTemplate.spec = podSpec;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1JobSpec.ts
    const jobSpec = new k8s.V1JobSpec();
    jobSpec.template = podTemplate;
    // Automatically clean up completed jobs after 10 minutes
    jobSpec.ttlSecondsAfterFinished = 10 * 60;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1ObjectMeta.ts
    const metadata = new k8s.V1ObjectMeta();
    metadata.name = buildkiteJob.uuid || buildkiteJob.id

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Job.ts
    const k8sJob = new k8s.V1Job();
    k8sJob.apiVersion = 'batch/v1';
    k8sJob.kind = 'Job';
    k8sJob.metadata = metadata;
    k8sJob.spec = jobSpec;

    return k8sJob
}

async function elasticCiStackKubernetesJobForBuildkiteJob(buildkiteJob) {
    /*
        Things to support in the image:

        amazonlinux:2 base image

        buildkite-agent
        docker (dind sidecar)
        aws-cli
        jq
        git lfs
        cloudwatch logs
        aws ssm

        environment hook
        - s3-secrets plugin
        - docker-login plugin
        - ecr-login plugin

        Things to support at boot time:

        bootstrap script
        customise buildkite-agent config
        sshd? + authorized keys param
        git-mirrors
        edge agent install?

        k8s role -> IAM role assume (in init-container), requires cluster OIDC
        setup and configured IAM Role ARN
        init-container creds could expire, may need a pod sidecar that pretends
        to be the imds and returns live creds based on k8s -> IAM assume role

        Things for polling agents:

        - Add buildkite-agent-scaler analogue that drives a horizontal pod
        autoscaler
    */

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1EnvVar.ts#L19
    // TODO generate this from a CloudFormation JSON parameter file?
    const secretsEnabledVar = new k8s.V1EnvVar()
    secretsEnabledVar.name = "SECRETS_PLUGIN_ENABLED"
    secretsEnabledVar.value = "true"
    const ecrEnabledVar = new k8s.V1EnvVar()
    ecrEnabledVar.name = "ECR_PLUGIN_ENABLED"
    ecrEnabledVar.value = "true"
    const dockerLoginEnabledVar = new k8s.V1EnvVar()
    dockerLoginEnabledVar.name = "DOCKER_LOGIN_PLUGIN_ENABLED"
    dockerLoginEnabledVar.value = "true"
    const agentsPerInstanceVar = new k8s.V1EnvVar()
    agentsPerInstanceVar.name = "BUILDKITE_AGENTS_PER_INSTANCE"
    agentsPerInstanceVar.value = "1"
    const ecrPolicyVar = new k8s.V1EnvVar()
    ecrPolicyVar.name = "BUILDKITE_ECR_POLICY"
    ecrPolicyVar.value = "full"
    const secretsBucketVar = new k8s.V1EnvVar()
    secretsBucketVar.name = "BUILDKITE_SECRETS_BUCKET"
    secretsBucketVar.value = "buildkite-crossregiontest"
    const stackNameVar = new k8s.V1EnvVar()
    stackNameVar.name = "BUILDKITE_STACK_NAME"
    stackNameVar.value = "buildkite-on-demand-eks-elastic-ci-stack"
    const stackVersionVar = new k8s.V1EnvVar()
    stackVersionVar.name = "BUILDKITE_STACK_VERSION"
    stackVersionVar.value = "0.0.0"
    const dockerExperimentalVar = new k8s.V1EnvVar()
    dockerExperimentalVar.name = "DOCKER_EXPERIMENTAL"
    dockerExperimentalVar.value = "true"
    const regionVar = new k8s.V1EnvVar()
    regionVar.name = "AWS_REGION"
    regionVar.value = process.env.AWS_REGION
    const defaultRegionVar = new k8s.V1EnvVar()
    defaultRegionVar.name = "AWS_DEFAULT_REGION"
    defaultRegionVar.value = process.env.AWS_REGION
    const buildkiteQueueVar = new k8s.V1EnvVar()
    buildkiteQueueVar.name = "BUILDKITE_QUEUE"
    buildkiteQueueVar.value = "eks"
    const buildkiteAgentTagsVar = new k8s.V1EnvVar()
    buildkiteAgentTagsVar.name = "BUILDKITE_AGENT_TAGS"
    buildkiteAgentTagsVar.value = "kubernetes=true"
    const instanceIdVarFieldRef = new k8s.V1ObjectFieldSelector()
    instanceIdVarFieldRef.fieldPath = "metadata.name"
    const instanceIdVarSource = new k8s.V1EnvVarSource()
    instanceIdVarSource.fieldRef = instanceIdVarFieldRef
    const instanceIdVar = new k8s.V1EnvVar()
    instanceIdVar.name = "INSTANCE_ID"
    instanceIdVar.valueFrom = instanceIdVarSource
    const timestampLinesVar = new k8s.V1EnvVar()
    timestampLinesVar.name = "BUILDKITE_AGENT_TIMESTAMP_LINES"
    timestampLinesVar.value = "false"
    const experimentsVar = new k8s.V1EnvVar()
    experimentsVar.name = "BUILDKITE_AGENT_EXPERIMENTS"
    experimentsVar.value = ""
    const bootstrapScriptVar = new k8s.V1EnvVar()
    bootstrapScriptVar.name = "BUILDKITE_ELASTIC_BOOTSTRAP_SCRIPT"
    bootstrapScriptVar.value = ""
    const buildkiteAgentTokenPathVar = new k8s.V1EnvVar()
    buildkiteAgentTokenPathVar.name = "BUILDKITE_AGENT_TOKEN_PATH"
    buildkiteAgentTokenPathVar.value = "/buildkite-aws-stack-testing/buildkite/agent-token"

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Volume.ts
    const dockerSocketVolume = new k8s.V1Volume();
    dockerSocketVolume.name = "docker-socket";
    dockerSocketVolume.emptyDir = new k8s.V1EmptyDirVolumeSource();

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1EnvVar.ts#L19
    const jobIdVar = new k8s.V1EnvVar();
    jobIdVar.name = "BUILDKITE_AGENT_ACQUIRE_JOB";
    jobIdVar.value = buildkiteJob.uuid || buildkiteJob.id;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Container.ts#L27
    const agentMainContainer = new k8s.V1Container();
    agentMainContainer.name = "main"
    agentMainContainer.image = "keithduncan/elastic-ci-stack:latest"
    agentMainContainer.env = [
        secretsEnabledVar,
        ecrEnabledVar,
        dockerLoginEnabledVar,
        agentsPerInstanceVar,
        ecrPolicyVar,
        secretsBucketVar,
        stackNameVar,
        stackVersionVar,
        dockerExperimentalVar,
        regionVar,
        defaultRegionVar,
        buildkiteQueueVar,
        buildkiteAgentTagsVar,
        instanceIdVar,
        timestampLinesVar,
        experimentsVar,
        bootstrapScriptVar,
        buildkiteAgentTokenPathVar,
        jobIdVar,
    ]
    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1VolumeMount.ts
    const agentDockerMount = new k8s.V1VolumeMount();
    agentDockerMount.mountPath = "/var/run/"
    agentDockerMount.name = dockerSocketVolume.name
    agentMainContainer.volumeMounts = [
        agentDockerMount,
    ]

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1SecurityContext.ts
    const dindSecurityContext = new k8s.V1SecurityContext();
    dindSecurityContext.privileged = true

    const dindContainer = new k8s.V1Container();
    dindContainer.name = "dockerd"
    dindContainer.image = "docker:20-dind"
    dindContainer.securityContext = dindSecurityContext;
    dindContainer.command = [
        "dockerd"
    ]
    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1VolumeMount.ts
    const dockerDockerMount = new k8s.V1VolumeMount();
    dockerDockerMount.name = dockerSocketVolume.name
    dockerDockerMount.mountPath = "/var/run/"
    dindContainer.volumeMounts = [
        dockerDockerMount,
    ]

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1PodSpec.ts#L29
    const podSpec = new k8s.V1PodSpec();
    podSpec.containers = [
        agentMainContainer,
        dindContainer,
    ]
    podSpec.volumes = [
        dockerSocketVolume,
    ]
    podSpec.nodeSelector = {
        "platform": "ec2",
    }
    podSpec.serviceAccountName = "elastic-ci-stack"
    podSpec.restartPolicy = "Never"

    const podTemplate = new k8s.V1PodTemplateSpec();
    podTemplate.spec = podSpec;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1JobSpec.ts
    const jobSpec = new k8s.V1JobSpec();
    jobSpec.template = podTemplate;
    // Automatically clean up completed jobs after 10 minutes
    jobSpec.ttlSecondsAfterFinished = 10 * 60;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1ObjectMeta.ts
    const metadata = new k8s.V1ObjectMeta();
    metadata.name = buildkiteJob.uuid || buildkiteJob.id

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Job.ts
    const k8sJob = new k8s.V1Job();
    k8sJob.apiVersion = 'batch/v1';
    k8sJob.kind = 'Job';
    k8sJob.metadata = metadata;
    k8sJob.spec = jobSpec;

    return k8sJob
}

/*
    Statically compute a k8s job for a buildkite job.

    This is where you would implement custom k8s job spec look up based on the
    Buildkite Job’s agent query rules.

    Presently all jobs are run inside the buildkite/agent:3 image with no
    sidecar containers.

    Some ideas for where you could keep your library of named pod specs:

    - inside this Lambda function, deploying a new version whenever you update a
      pod spec
    - in a git repository, fetching them by name/path at runtime
    - on s3, fetching them by key at runtime

    Some ideas for how this function could be adapted:

    - add support for single container dynamic `image` using agent query rules
    - map `cpu` and `memory` agent query rules to pod/container resource
      requests
    - add support for pod roles which can be mapped to IAM Roles outside the
      cluster using OIDC
*/
async function kubernetesJobForBuildkiteJob(buildkiteJob) {
    let podDefinition = getAgentQueryRule("pod-definition", buildkiteJob.agent_query_rules);

    if (podDefinition == "elastic-ci-stack") {
        return elasticCiStackKubernetesJobForBuildkiteJob(buildkiteJob)
    }

    return defaultKubernetesJobForBuildkiteJob(buildkiteJob)
}

async function scheduleKubernetesJobForBuildkiteJob(k8sApi, namespace, buildkiteJob) {
    let k8sJob = await kubernetesJobForBuildkiteJob(buildkiteJob);

    // https://kubernetes-client.github.io/javascript/classes/batchv1api.batchv1api-1.html#createnamespacedjob
    return k8sApi.createNamespacedJob(namespace, k8sJob)
}

async function runTaskForBuildkiteJob(k8sApi, namespace, job) {
    console.log(`fn=runTaskForBuildkiteJob attempt=${attempt}`);
    
    for (var attempt = 1; attempt < 6; attempt++) {
        try {
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask`);
            let result = await scheduleKubernetesJobForBuildkiteJob(k8sApi, namespace, job);
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask result=${JSON.stringify(result)}`);

            return result;
        }
        catch (e) {
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=error error=${JSON.stringify(e)}`);
            
            await sleep(1000 * Math.pow(attempt, 2));
            
            continue;
        }
    }
    
    throw new Error("Couldn't schedule kubernetes job after 5 attempts");
}

// https://github.com/kubernetes-sigs/aws-iam-authenticator#api-authorization-from-outside-a-cluster
function getBearerToken(clusterId) {
    let region = AWS.config.region;
    let credentials = AWS.config.credentials;

    let params = {
        host: `sts.${region}.amazonaws.com`,
        path: "/?Action=GetCallerIdentity&Version=2011-06-15&X-Amz-Expires=60",
        headers: {
            'x-k8s-aws-id': clusterId,
        },
        signQuery: true,
    }
    let signature = aws4.sign(params);

    let signedUrl = `https://${signature.host}${signature.path}`

    /*
        This encoding matches aws-iam-authenticator

        https://github.com/kubernetes-sigs/aws-iam-authenticator/blob/02a86a549cee91b37baff12d2528f185594fb98c/pkg/token/token.go#L335
        https://pkg.go.dev/encoding/base64#pkg-variables
        https://www.rfc-editor.org/rfc/rfc4648.html#section-5
    */
    var base64 = Buffer.from(signedUrl, 'binary').toString('base64').replace(/=+$/g, '')
    base64 = base64.replace(/\+/g, '-')
    base64 = base64.replace(/\//g, '_')

    return `k8s-aws-v1.${base64}`
}

exports.handler = async (event) => {
    console.log(`fn=handler event=${JSON.stringify(event)}`);

    let clusterIdentifier = process.env.KUBERNETES_CLUSTER_IDENTIFIER;
    let apiServer = process.env.KUBERNETES_API_SERVER_ENDPOINT;
    let namespace = process.env.KUBERNETES_NAMESPACE;
    let caData = process.env.KUBERNETES_CERTIFICATE_AUTHORITY_DATA;

    const cluster = {
        name: 'my-server',
        server: apiServer,
        caData: caData,
    };

    const user = {
        name: 'my-user',
        token: getBearerToken(clusterIdentifier),
    };

    const context = {
        name: 'my-context',
        user: user.name,
        cluster: cluster.name,
    };

    const kc = new k8s.KubeConfig();
    kc.loadFromOptions({
        clusters: [cluster],
        users: [user],
        contexts: [context],
        currentContext: context.name,
    });

    const k8sApi = kc.makeApiClient(k8s.CoreV1Api);
    const batchV1Api = kc.makeApiClient(k8s.BatchV1Api);
    
    let tasks = event.Records.map(record => {
        let { job } = JSON.parse(record.body);
        return runTaskForBuildkiteJob(batchV1Api, namespace, job);
    });
    
    await Promise.all(tasks);

    return {
        statusCode: 200,
    };
};
