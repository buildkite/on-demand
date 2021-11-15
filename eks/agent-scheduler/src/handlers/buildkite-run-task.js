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

function range(start, stop) {
    if (typeof stop == 'undefined') {
        // one param defined
        stop = start;
        start = 0;
    }

    let step = 1024;

    var result = [];
    for (var i = start; step > 0 ? i <= stop : i > stop; i += step) {
        result.push(i);
    }

    return result;
}

function memoryRangeForCpu(cpu) {
    if (cpu == 256) {
        return [512, 1024, 2048];
    } else if (cpu == 512) {
        return range(1024, 4096);
    } else if (cpu == 1024) {
        return range(2048, 8192);
    } else if (cpu == 2048) {
        return range(4096, 16384);
    } else /* if cpu == 4096 */ {
        return range(8192, 30720);
    }
}

function cpuValues() {
    return [256, 512, 1024, 2048, 4096]
}

function supportedCpuMemoryValues() {
    return cpuValues()
        .flatMap(cpu => {
            return memoryRangeForCpu(cpu).map(memory => [cpu, memory])
        });
}

function atLeastCpuMemory(requestedCpu, requestedMemory) {
    let supported = supportedCpuMemoryValues();

    for (let [cpu, memory] of supported) {
        if (cpu < requestedCpu || memory < requestedMemory) {
            continue
        }

        return [cpu, memory]
    }

    return supported[supported.length - 1];
}

async function sleep(ms){
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    });
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
    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1EnvVar.ts#L19
    const agentVar = new k8s.V1EnvVar();
    agentVar.name = "BUILDKITE_AGENT_TOKEN"
    agentVar.value = process.env.BUILDKITE_AGENT_TOKEN;

    const jobVar = new k8s.V1EnvVar();
    jobVar.name = "BUILDKITE_AGENT_ACQUIRE_JOB";
    jobVar.value = buildkiteJob.uuid || buildkiteJob.id;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Container.ts#L27
    const buildkiteAgentContainer = new k8s.V1Container();
    buildkiteAgentContainer.name = "agent"
    buildkiteAgentContainer.image = "buildkite/agent:3"
    buildkiteAgentContainer.env = [
        agentToken,
        jobVar,
    ]
    buildkiteAgentContainer.command = [
        "start",
        "--disconnect-after-job",
        "--disconnect-after-idle-timeout=10"
    ]

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

async function scheduleKubernetesJobForBuildkiteJob(k8sApi, namespace, buildkiteJob) {
    let k8sJob = await kubernetesJobForBuildkiteJob(buildkiteJob);

    // https://kubernetes-client.github.io/javascript/classes/batchv1api.batchv1api-1.html#createnamespacedjob
    return k8sApi.createNamespacedJob(namespace, k8sJob)
}

async function runTaskForBuildkiteJob(k8sApi, namespace, job) {
    console.log(`fn=runTaskForBuildkiteJob attempt=${attempt}`);
    
    for (var attempt = 1; attempt < 6; attempt++) {
        try {
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask params=${JSON.stringify(taskParams)}`);
            let result = await scheduleKubernetesJobForBuildkiteJob(k8sApi, namespace, job);
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask result=${JSON.stringify(result)}`);

            return result;
        }
        catch (e) {
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=error error=${e}`);
            
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

    var base64 = Buffer.from(signedUrl, 'binary').toString('base64').replace(/=+$/g, '')
    base64 = base64.replace(/+/g, '-')
    base64 = base64.replace(/\//g, '_')
    base64 = base64.replace(/=/g, '.')

    return `k8s-aws-v1.${base64}`
}

exports.handler = async (event) => {
    console.log(`fn=handler event=${JSON.stringify(event)}`);

    let clusterIdentifier = process.env.KUBERNETES_CLUSTER_IDENTIFIER;
    let apiServer = process.env.KUBERNETES_API_SERVER_ENDPOINT;
    let namespace = process.env.KUBERNETES_NAMESPACE;

    const cluster = {
        name: 'my-server',
        server: apiServer,
    };

    const user = {
        name: 'my-user',
        password: getBearerToken(clusterIdentifier),
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
