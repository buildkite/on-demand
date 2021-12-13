const AWS = require('aws-sdk');
const aws4 = require('aws4');
const k8s = require('@kubernetes/client-node');
const yaml = require('yaml');
const path = require('path');

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

async function fetchPodTemplateFromLibrary(templateName) {
    console.log(`fn=fetchPodTemplateFromLibrary templateName=${templateName}`);

    // "arn:aws:s3:us-east-1::foo-bucket/prefix/baz/bar"
    const bucketArn = process.env.POD_LIBRARY_BUCKET;
    if (bucketArn == undefined || bucketArn == "") {
        throw `Cannot load pod template from library without the POD_LIBRARY_BUCKET environment variable`
    }

    console.log(`fn=fetchPodTemplateFromLibrary bucketArn=${bucketArn}`)

    const partition = bucketArn.split(":")[1]                     // "aws"
    var   bucketRegion = bucketArn.split(":")[3]                  // "us-east-1" or ""
    const bucketPath = bucketArn.split(":")[5]                    // "foo-bucket/prefix/baz/bar"
    const bucketName = bucketPath.split("/")[0]                   // "foo-bucket"
    const bucketPrefix = bucketPath.split("/").slice(1).join("/") // "prefix/baz/bar" or ""

    console.log(`fn=fetchPodTemplateFromLibrary partition=${partition} region=${bucketRegion} name=${bucketName} prefix=${bucketPrefix}`)

    if (bucketRegion == "") {
        console.log(`fn=fetchPodTemplateFromLibrary at=region-discovery`)

        const s3manager = new AWS.S3({apiVersion: '2006-03-01'})
        bucketRegion = (await s3manager.getBucketLocation({
            Bucket: bucketName
        }).promise()).LocationConstraint || 'us-east-1'

        console.log(`fn=fetchPodTemplateFromLibrary at=region-discovery region=${bucketRegion}`)
    }

    const podTemplatePath = path.join(bucketPrefix, templateName)

    console.log(`fn=fetchPodTemplateFromLibrary at=get-object s3-path=${podTemplatePath} s3-bucket=${bucketName} s3-region=${bucketRegion}`);

    const s3 = new AWS.S3({
        apiVersion: '2006-03-01',
        region: bucketRegion,
    })

    const object = await s3.getObject({
        Bucket: bucketName,
        Key: podTemplatePath,
    }).promise()

    return object.Body
}

function defaultPodTemplate() {
    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Container.ts#L27
    const buildkiteAgentContainer = new k8s.V1Container();
    buildkiteAgentContainer.name = "agent"
    buildkiteAgentContainer.image = "buildkite/agent:3"
    buildkiteAgentContainer.args = [
        "start",
        "--disconnect-after-job",
        "--disconnect-after-idle-timeout=10"
    ]

    // TODO: ideally this would not be stored in plaintext in the env, but
    // supporting arbitrary containers and AssumeRole from k8s roles to get
    // ssm:GetParameter support might not be possible
    const agentTokenVar = new k8s.V1EnvVar();
    agentTokenVar.name = "BUILDKITE_AGENT_TOKEN"
    agentTokenVar.value = process.env.BUILDKITE_AGENT_TOKEN;

    buildkiteAgentContainer.env = [
        agentTokenVar,
        agentTagsVar,
    ]

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1PodSpec.ts#L29
    const podSpec = new k8s.V1PodSpec();
    podSpec.containers = [
        buildkiteAgentContainer,
    ];
    podSpec.restartPolicy = "Never"

    const template = new k8s.V1PodTemplateSpec()
    template.spec = podSpec
    return template
}

async function podLibraryDefaultPodTemplate() {
    let defaultPodTemplateBuffer = await fetchPodTemplateFromLibrary('default.yml')
    let defaultPodTemplate = new String(defaultPodTemplateBuffer)
    return yaml.parse(defaultPodTemplate)
}

async function kubernetesJobForPodTemplateAndBuildkiteJob(templateName, podTemplate, buildkiteJob) {
    let buildkiteAgentContainer = podTemplate.spec.containers.find(container => container.name == "agent")
    if (buildkiteAgentContainer == undefined) {
        throw `Cannot find the agent container in the ${templateName} pod template. A pod template must include a container with "name: agent" for one-shot scheduling in a Kubernetes Job.`
    }

    buildkiteAgentContainer.env = (buildkiteAgentContainer.env || [])

    const jobIdVarValue = buildkiteJob.uuid || buildkiteJob.id

    var acquireJobVar = buildkiteAgentContainer.env.find(envVar => envVar.name == "BUILDKITE_AGENT_ACQUIRE_JOB")
    if (acquireJobVar == undefined) {
        acquireJobVar = new k8s.V1EnvVar()
        acquireJobVar.name = "BUILDKITE_AGENT_ACQUIRE_JOB"
        acquireJobVar.value = jobIdVarValue
        buildkiteAgentContainer.env.push(acquireJobVar)
    } else {
        acquireJobVar.value = jobIdVarValue
    }

    // TODO make buildkite-eks-stack hold the version of the stack
    const tagsVarValue = `buildkite-eks-stack=true,pod-template=${templateName}`
    var tagsVar = buildkiteAgentContainer.env.find(envVar => envVar.name == "BUILDKITE_AGENT_TAGS")
    if (tagsVar == undefined) {
        tagsVar = new k8s.V1EnvVar()
        tagsVar.name = "BUILDKITE_AGENT_TAGS"
        tagsVar.value = tagsVarValue
        buildkiteAgentContainer.env.push(tagsVar)
    } else {
        tagsVar.value = `${tagsVar.value},${tagsVarValue}`
    }

    let cpuRequest = getAgentQueryRule("cpu", buildkiteJob.agent_query_rules);
    let memoryRequest = getAgentQueryRule("memory", buildkiteJob.agent_query_rules);

    if (cpuRequest != undefined || memoryRequest != undefined) {
        // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1ResourceRequirements.ts#L18
        var resources = buildkiteAgentContainer.resources
        if (resources == undefined) {
            resources = new k8s.V1ResourceRequirements()
            buildkiteAgentContainer.resources = resources
        }

        var requests = buildkiteAgentResources.requests
        if (requests == undefined) {
            requests = {}
            buildkiteAgentResources.requests = requests
        }

        // These use the k8s native request units
        // https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/#resource-units-in-kubernetes
        if (cpuRequest != undefined) {
            requests.cpu = cpuRequest
        }
        if (memoryRequest != undefined) {
            requests.memory = memoryRequest
        }
    }

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

async function kubernetesJobForPodTemplateNameAndBuildkiteJob(templateName, buildkiteJob) {
    let podTemplateBuffer = await fetchPodTemplateFromLibrary(templateName)
    let podTemplate = yaml.parse(new String(podTemplateBuffer))
    return kubernetesJobForPodTemplateAndBuildkiteJob(templateName, podTemplate, buildkiteJob)
}

function injectAgentSidecarIntoPodTemplateContainers(templateName, podTemplate, containerName, image) {
    /*
        1. A volume is shared between the init container and the "agent"
           container
        2. An init container with "buildkite/agent:3-sidecar" is added, it
           copies the contents of /buildkite to /buildkite-init
        3 The "agent" container image is replaced with the given image
        4. Re-write the agent container's entrypoint to /buildkite/bin/buildkite-agent
        5. Add the buildkite agent config vars to the main container
    */

    let buildkiteAgentContainer = podTemplate.spec.containers.find(container => container.name == containerName)
    if (buildkiteAgentContainer == undefined) {
        throw `Cannot find the ${containerName} container in the ${templateName} pod template. A pod template must include a container with "name: ${containerName}" for agent sideloading.`
    }

    let podSpec = podTemplate.spec;

    // https://github.com/kubernetes-client/javascript/blob/6b713dc83f494e03845fca194b84e6bfbd86f31c/src/gen/model/v1Volume.ts#L47
    const buildkiteVolume = new k8s.V1Volume()
    // TODO technically this name could collide, append random suffix?
    buildkiteVolume.name = "agent-sidecar"
    buildkiteVolume.emptyDir = new k8s.V1EmptyDirVolumeSource()

    podSpec.volumes = podSpec.volumes || [];
    podSpec.volumes.push(buildkiteVolume)

    const sidecarContainer = new k8s.V1Container()
    // TODO technically this name could collide, append random suffix?
    sidecarContainer.name = "agent-init"
    sidecarContainer.image = "buildkite/agent:3-sidecar"
    sidecarContainer.workingDir = "/buildkite"
    sidecarContainer.args = [
        "cp",
        "-R",
        ".",
        "/buildkite-init",
    ]
    const sidecarBuildkiteVolumeMount = new k8s.V1VolumeMount()
    sidecarBuildkiteVolumeMount.mountPath = "/buildkite-init"
    sidecarBuildkiteVolumeMount.name = buildkiteVolume.name
    sidecarContainer.volumeMounts = [
        sidecarBuildkiteVolumeMount,
    ]

    podSpec.initContainers = podSpec.initContainers || []
    podSpec.initContainers.push(sidecarContainer)

    buildkiteAgentContainer.image = image

    const agentBuildkiteVolumeMount = new k8s.V1VolumeMount()
    agentBuildkiteVolumeMount.mountPath = "/buildkite"
    agentBuildkiteVolumeMount.name = buildkiteVolume.name
    buildkiteAgentContainer.volumeMounts = buildkiteAgentContainer.volumeMounts || []
    buildkiteAgentContainer.volumeMounts.push(
        agentBuildkiteVolumeMount,
    )

    buildkiteAgentContainer.command = [
        "/buildkite/bin/buildkite-agent"
    ]

    var buildsPath = "/buildkite/builds"
    var buildsPathVar = buildkiteAgentContainer.env.find(envVar => envVar.name == "BUILDKITE_BUILD_PATH")
    if (buildsPathVar == undefined) {
        buildsPathVar = new k8s.V1EnvVar()
        buildsPathVar.name = "BUILDKITE_BUILD_PATH"
        buildsPathVar.value = buildsPath
        buildkiteAgentContainer.env.push(buildsPathVar)
    } else {
        buildsPathVar.value = buildsPath
    }

    var hooksPath = "/buildkite/hooks"
    var hooksPathVar = buildkiteAgentContainer.env.find(envVar => envVar.name == "BUILDKITE_HOOKS_PATH")
    if (hooksPathVar == undefined) {
        hooksPathVar = new k8s.V1EnvVar()
        hooksPathVar.name = "BUILDKITE_HOOKS_PATH"
        hooksPathVar.value = hooksPath
        buildkiteAgentContainer.env.push(hooksPathVar)
    } else {
        hooksPathVar.value = hooksPath
    }

    var pluginsPath = "/buildkite/plugins"
    var pluginsPathVar = buildkiteAgentContainer.env.find(envVar => envVar.name == "BUILDKITE_PLUGINS_PATH")
    if (pluginsPathVar == undefined) {
        pluginsPathVar = new k8s.V1EnvVar()
        pluginsPathVar.name = "BUILDKITE_PLUGINS_PATH"
        pluginsPathVar.value = pluginsPath
        buildkiteAgentContainer.env.push(pluginsPathVar)
    } else {
        pluginsPathVar.value = pluginsPath
    }
}

async function kubernetesJobForDefaultPodTemplateAndBuildkiteJob(buildkiteJob) {
    var templateName = undefined
    var podTemplate = undefined

    try {
        templateName = "default.yml"
        podTemplate = await podLibraryDefaultPodTemplate()
    }
    catch (e) {
        console.log(`fn=kubernetesJobForDefaultPodTemplateAndBuildkiteJob at=error error=${e} error=${JSON.stringify(e)}`)

        templateName = "defaultPodSpec"
        podTemplate = defaultPodTemplate()
    }

    /*
        The default pod spec (loaded from S3 or static) can have its image
        changed, pod templates i.e. named pod-specs cannot
    */

    let image = getAgentQueryRule("image", buildkiteJob.agent_query_rules);
    if (image != undefined) {
        injectAgentSidecarIntoPodTemplateContainers(templateName, podTemplate, "agent", image)
    }

    return kubernetesJobForPodTemplateAndBuildkiteJob(templateName, podTemplate, buildkiteJob)
}

/*
    Statically compute a k8s job for a buildkite job.

    This is where you would implement custom k8s job spec look up based on the
    Buildkite Job’s agent query rules.

    Some ideas for where you could keep your library of named pod specs:

    - inside this Lambda function, deploying a new version whenever you update a
      pod spec
    - in a git repository, fetching them by name/path at runtime
    - on s3, fetching them by key at runtime

    Some ideas for how this function could be adapted:

    - add support for dynamic service account overrides which can be mapped to
      IAM Roles outside the cluster using OIDC
*/
async function kubernetesJobForBuildkiteJob(buildkiteJob) {
    let podTemplate = getAgentQueryRule("pod-template", buildkiteJob.agent_query_rules);
    if (podTemplate != undefined) {
        console.log(`fn=kubernetesJobForBuildkiteJob podTemplate=${podTemplate}`)

        return kubernetesJobForPodTemplateNameAndBuildkiteJob(podTemplate, buildkiteJob)
    }

    return kubernetesJobForDefaultPodTemplateAndBuildkiteJob(buildkiteJob)
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
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=error error=${e} error=${JSON.stringify(e)}`);
            
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
