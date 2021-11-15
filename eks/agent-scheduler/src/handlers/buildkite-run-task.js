const AWS = require('aws-sdk');
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

function getDefaultEcsRunTaskParams(cluster, job) {
    let jobId = job.uuid || job.id;
    let subnets = process.env.VPC_SUBNETS.split(",");

    let vpcConfiguration;
    let launchType = process.env.LAUNCH_TYPE;
    switch (launchType) {
        case "FARGATE":
            // Scheduled in a public or private subnet with a 0.0.0.0/0 gateway
            // route.
            vpcConfiguration = {
                assignPublicIp: "ENABLED",
                subnets: subnets,
            };
            break;
        case "EC2":
            // Scheduled in a private subnet with a 0.0.0.0/0 NAT gateway route.
            vpcConfiguration = {
                subnets: subnets,
            };
            break;
        default:
            throw `unsupported LAUNCH_TYPE environment variable: ${launchType}`;
            break;
    }
    
    let params = {
        cluster: cluster,
        count: 1,
        launchType: launchType,
        networkConfiguration: {
            awsvpcConfiguration: vpcConfiguration,
        },
        overrides: {
            containerOverrides: [
                {
                    name: "agent",
                    command: [
                        "start",
                        "--disconnect-after-job",
                        "--disconnect-after-idle-timeout=10"
                    ],
                    environment: [
                        {
                            "name": "BUILDKITE_AGENT_ACQUIRE_JOB",
                            "value": jobId,
                        },
                    ]
                }
            ],
        },
        taskDefinition: "buildkite",
    };
    
    return params;
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

async function getEcsRunTaskParamsForJob(cluster, job) {
    let taskParams = getDefaultEcsRunTaskParams(cluster, job);

    let taskDefinition = getAgentQueryRule("task-definition", job.agent_query_rules);
    if (taskDefinition != undefined) {
        // Task definition is overridden...

        console.log(`fn=getEcsRunTaskParamsForJob taskDefinition=${taskDefinition}`);
        taskParams.taskDefinition = taskDefinition;
    } else {
        let image = getAgentQueryRule("image", job.agent_query_rules);
        if (image != undefined) {
            let requestedCpu = parseInt(getAgentQueryRule("cpu", job.agent_query_rules) || 256);
            let requestedMemory = parseInt(getAgentQueryRule("memory", job.agent_query_rules) || 512);

            /*
                Find the supported cpu memory combination that is at least
                the cpu and memory requested.
            */
            let [cpu, memory] = atLeastCpuMemory(requestedCpu, requestedMemory);

            console.log(`fn=getEcsRunTaskParamsForJob image=${image} cpu=${cpu} memory=${memory}`);

            /*
                Synthesise a task definition for this image, cpu and memory.
                
                1. Generate a task definition name.
                2. Call ecs:RegisterTaskDefinition with agent sidecar (and iam-ssh-agent sidecar)
            */

            /*
                Generate a name for this task family.

                Up to 255 letters (uppercase and lowercase), numbers, and
                hyphens are allowed.

                Image could be:
                012345678910.dkr.ecr.us-east-1.amazonaws.com/agent/buildkite:latest
                quay.io/organization/image
                keithduncan/agent@sha256:94afd1f2e64d908bc90dbca0035a5b567EXAMPLE
            */

            /*
                Sticking the year and month in the name gives us 1,000,000 per
                month or ~32,000 builds per image tag per day. More than enough
                for anyone!

                If anyone needs more significant bits we can add the day.
            */
            let date = new Date;
            let year = (new Intl.DateTimeFormat('en-US-POSIX', { year: 'numeric' })).format(date);
            let month = (new Intl.DateTimeFormat('en-US-POSIX', { month: '2-digit' })).format(date);

            let taskFamily = `ondemand-${year}${month}-${image.replace(/[^a-zA-Z0-9]/gi, '')}`.substring(0, 255);

            let logConfiguration = {
                logDriver: "awslogs",
                options: {
                    "awslogs-region": process.env.AWS_REGION,
                    // Log group names can be up to 512 characters,
                    // including / a-z A-Z.
                    "awslogs-group": `/aws/ecs/${taskFamily}`,
                    "awslogs-stream-prefix": "ecs",
                    "awslogs-create-group": "true",
                }
            };

            let params = {
                family: taskFamily,
                executionRoleArn: process.env.DEFAULT_EXECUTION_ROLE_ARN,
                networkMode: "awsvpc",
                cpu: `${cpu}`,
                memory: `${memory}`,
                containerDefinitions: [
                    {
                        name: "agent-init",
                        image: "keithduncan/buildkite-sidecar",
                        essential: false,
                        entryPoint: [
                            '/bin/sh',
                            '-c',
                        ],
                        command: [
                            'echo container=agent-init at=initalised',
                        ],
                        logConfiguration: logConfiguration,
                    },
                ],
                volumes: [],
                requiresCompatibilities: [
                    "FARGATE",
                ],
            }

            let iamSshAgentBackendUrl = process.env.IAM_SSH_AGENT_BACKEND_URL;
            let includeSshAgent = (iamSshAgentBackendUrl != undefined);

            if (includeSshAgent) {
                params.containerDefinitions.push({
                    name: "ssh-agent",
                    image: "keithduncan/iam-ssh-agent:0.2",
                    essential: true,
                    command: [
                        'iam-ssh-agent',
                        'daemon',
                        '--bind-to=/ssh/socket',
                    ],
                    logConfiguration: logConfiguration,
                    environment: [
                        {
                            name: "IAM_SSH_AGENT_BACKEND_URL",
                            value: iamSshAgentBackendUrl,
                        }
                    ],
                    healthCheck: {
                        command: [
                            'test',
                            '-S',
                            '/ssh/socket',
                        ],
                    },
                    mountPoints: [
                        {
                            sourceVolume: "ssh-agent",
                            containerPath: "/ssh",
                        }
                    ],
                });

                params.volumes.push({
                    name: "ssh-agent",
                });
            }

            let agentContainer = {
                name: "agent",
                image: image,
                essential: true,
                entryPoint: [
                    "/buildkite/bin/buildkite-agent"
                ],
                command: [
                    "start",
                ],
                environment: [
                    {
                        name: "BUILDKITE_BUILD_PATH",
                        value: "/buildkite/builds",
                    },
                    {
                        name: "BUILDKITE_HOOKS_PATH",
                        value: "/buildkite/hooks",
                    },
                    {
                        name: "BUILDKITE_PLUGINS_PATH",
                        value: "/buildkite/plugins",
                    },
                ],
                secrets: [
                    {
                        name: "BUILDKITE_AGENT_TOKEN",
                        valueFrom: process.env.BUILDKITE_AGENT_TOKEN_PARAMETER_PATH,
                    }
                ],
                volumesFrom: [
                    {
                        sourceContainer: "agent-init",
                    }
                ],
                dependsOn: [
                    {
                        containerName: "agent-init",
                        condition: "SUCCESS",
                    }
                ],
                logConfiguration: logConfiguration,
                mountPoints: [],
            };
            if (includeSshAgent) {
                agentContainer.environment.push({
                    name: "SSH_AUTH_SOCK",
                    value: "/ssh/socket"
                });
                agentContainer.mountPoints.push({
                    sourceVolume: "ssh-agent",
                    containerPath: "/ssh",
                });
                agentContainer.dependsOn.push({
                    containerName: "ssh-agent",
                    condition: "HEALTHY",
                });
            }
            params.containerDefinitions.push(agentContainer);

            /*
                AWS will store up to 1,000,000 task definition revisions.

                https://docs.aws.amazon.com/general/latest/gr/ecs-service.html#limits_ecs

                The docs say unregistering does nothing for this limit.

                To escape the limit the naming scheme needs a random element.
            */
            let ecs = new AWS.ECS({apiVersion: '2014-11-13'});
            let result = await ecs.registerTaskDefinition(params).promise();

            let taskDefinition = `${result.taskDefinition.family}:${result.taskDefinition.revision}`;
            console.log(`fn=getEcsRunTaskParamsForJob image=${image} taskDefinition=${taskDefinition}`);
            taskParams.taskDefinition = taskDefinition;
        }
    }

    let taskRole = getAgentQueryRule("task-role", job.agent_query_rules);
    if (taskRole != undefined) {
        let taskRoleArn = `${process.env.TASK_ROLE_ARN_PREFIX}${taskRole}`;

        console.log(`fn=getEcsRunTaskParamsForJob taskRoleArn=${taskRoleArn}`);
        taskParams.overrides.taskRoleArn = taskRoleArn;
    }
    
    return taskParams;
}

async function sleep(ms){
    return new Promise(resolve => {
        setTimeout(resolve, ms)
    });
}

async function runTaskForBuildkiteJob(k8sApi, job) {
    console.log(`fn=runTaskForBuildkiteJob attempt=${attempt}`);
    
    for (var attempt = 1; attempt < 6; attempt++) {
        try {
            let ecs = new AWS.ECS({apiVersion: '2014-11-13'});
            let taskParams = await getEcsRunTaskParamsForJob(cluster, job);

            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask params=${JSON.stringify(taskParams)}`);
            let result = await ecs.runTask(taskParams).promise();
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask result=${JSON.stringify(result)}`);

            return result;
        }
        catch (e) {
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=error error=${e}`);
            
            await sleep(1000 * Math.pow(attempt, 2));
            
            continue;
        }
    }
    
    throw new Error("Couldn't start ECS task after 5 attempts");
}

exports.handler = async (event) => {
    console.log(`fn=handler event=${JSON.stringify(event)}`);

    let apiServer = process.env.KUBERNETES_API_SERVER_ENDPOINT;

    const cluster = {
        name: 'my-server',
        server: apiServer,
    };

    const user = {
        name: 'my-user',
        password: 'some-password',
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
    
    let tasks = event.Records.map(record => {
        let { job } = JSON.parse(record.body);
        return runTaskForBuildkiteJob(k8sApi, job);
    });
    
    await Promise.all(tasks);

    return {
        statusCode: 200,
    };
};
