const AWS = require('aws-sdk');

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
    
    let params = {
        cluster: cluster,
        count: 1,
        launchType: "FARGATE",
        networkConfiguration: {
            awsvpcConfiguration: {
                assignPublicIp: "ENABLED",
                subnets: subnets
            }
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

// cpu is user input, make sure this is a real cpu value
function atLeastCpu(cpu) {
    if cpu <= 256 {
        return 256
    } else if cpu <= 512 {
        return 512
    } else if cpu <= 1024 {
        return 1024
    } else if cpu <= 2048 {
        return 2048
    } else {
        return 4096
    }
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
    if cpu == 256 {
        return [512, 1024, 2048];
    } else if cpu == 512 {
        return range(1024, 4096);
    } else if cpu == 1024 {
        return range(2048, 8192);
    } else if cpu == 2048 {
        return range(4096, 16384);
    } else /* if cpu == 4096 */ {
        return range(8192, 30720);
    }
}

function atLeastMemoryForCpu(memory, cpu) {
    // Find the first memory figure >= requested memory, otherwise the last
    // memory amount.

    let supported = memoryRangeForCpu(cpu);

    for (let amount of supported) {
        if amount >= memory {
            return amount
        }
    }

    return supported[supported.length - 1]
}

function getEcsRunTaskParamsForJob(cluster, job) {
    let taskParams = getDefaultEcsRunTaskParams(cluster, job);

    let taskDefinition = getAgentQueryRule("task-definition", job.agent_query_rules);
    if (taskDefinition != undefined) {
        // Task definition is overridden...

        console.log(`fn=getEcsRunTaskParamsForJob taskDefinition=${taskDefinition}`);
        taskParams.taskDefinition = taskDefinition;
    } else {
        let image = getAgentQueryRule("image", job.agent_query_rules);
        if (image != undefined) {
            let cpu = atLeastCpu(parseInt(getAgentQueryRule("cpu", job.agent_query_rules)) || 256);
            let memory = atLeastMemoryForCpu(parseInt(getAgentQueryRule("memory", job.agent_query_rules)) || 512, cpu);

            console.log(`fn=getEcsRunTaskParamsForJob image=${image} cpu=${cpu} memory=${memory}`);

            /*
                Synthesise a task definition
                
                1. Generate a task definition name.
                2. Call ecs:RegisterTaskDefinition with agent sidecar (and iam-ssh-agent sidecar)

                Check whether it exists first and then create?
                or
                Create first and handle duplicate task family error?
            */

            // Up to 255 letters (uppercase and lowercase), numbers, and hyphens are allowed.

            /*
                Image could be:
                012345678910.dkr.ecr.us-east-1.amazonaws.com/agent/buildkite:latest
                quay.io/organization/image
                keithduncan/agent@sha256:94afd1f2e64d908bc90dbca0035a5b567EXAMPLE
            */

            let taskFamily = `ondemand-${image.replace(/[^a-zA-Z0-9]/, '')}`.substring(0, 255);

            // TODO add support for an iam-ssh-agent sidecar
            let ecs = new AWS.ECS({apiVersion: '2014-11-13'});
            let params = {
                family: taskFamily,
                executionRoleArn: process.env.DEFAULT_EXECUTION_ROLE_ARN,
                networkMode: "awsvpc",
                cpu: cpu,
                memory: memory,
                containerDefinitions: [
                    {
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
                        ]
                        secrets: [
                            {
                                name: "BUILDKITE_AGENT_TOKEN",
                                valueFrom: "/buildkite/agent-token",
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
                        logConfiguration: {
                            logDriver: "awslogs",
                            options: {
                                "awslogs-region": process.env.AWS_REGION,
                                // TODO give this new task definition a log group
                                "awslogs-group": "/aws/ecs/buildkite",
                                "awslogs-stream-prefix": "ecs",
                            }
                        }
                    },
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
                    }
                ],
                requiresCompatibilities: [
                    "FARGATE",
                ],
            };

            // TODO handle error if the task definition already exists
            let result = await ecs.registerTaskDefinition(params).promise();
            console.log(`${JSON.stringify(result)}`);

            console.log(`fn=getEcsRunTaskParamsForJob image=${image} taskDefinition=${taskFamily}`);
            taskParams.taskDefinition = taskFamily;
        }
    }

    let taskRole = getAgentQueryRule("task-role", job.agent_query_rules);
    if (taskRole != undefined) {
        let taskRoleArn = `${process.env.TASK_ROLE_ARN_PREFIX}/${taskRole}`;

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

async function runTaskForBuildkiteJob(cluster, job) {
    console.log(`fn=runTaskForBuildkiteJob attempt=${attempt}`);
    
    for (var attempt = 1; attempt < 6; attempt++) {
        try {
            let ecs = new AWS.ECS({apiVersion: '2014-11-13'});
            let taskParams = getEcsRunTaskParamsForJob(cluster, job);

            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask params=${JSON.stringify(taskParams)}`);
            let result = await ecs.runTask(taskParams).promise();
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=runTask result=${JSON.stringify(result)}`);

            return result;
        }
        catch (e) {
            console.log(`fn=runTaskForBuildkiteJob attempt=${attempt} at=error error=${JSON.stringify(e)}`);
            
            await sleep(1000 * Math.pow(attempt, 2));
            
            continue;
        }
    }
    
    throw new Error("Couldn't start ECS task after 5 attempts");
}

exports.handler = async (event) => {
    console.log(`fn=handler event=${JSON.stringify(event)}`);

    let cluster = process.env.ECS_CLUSTER_NAME;
    
    let tasks = event.Records.map(record => {
        let { Job } = JSON.parse(record.body);
        return runTaskForBuildkiteJob(cluster, Job);
    });
    
    await Promise.all(tasks);

    return {
        statusCode: 200,
    };
};
