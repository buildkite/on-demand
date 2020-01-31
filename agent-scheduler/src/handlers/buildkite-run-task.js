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

function getEcsRunTaskParamsForJob(cluster, job) {
    let params = getDefaultEcsRunTaskParams(cluster, job);

    let taskDefinition = getAgentQueryRule("task-definition", job.agent_query_rules);
    if (taskDefinition != undefined) {
        // Task definition is overridden...

        console.log(`fn=getEcsRunTaskParamsForJob taskDefinition=${taskDefinition}`);
        params.taskDefinition = taskDefinition;
    }

    let taskRole = getAgentQueryRule("task-role", job.agent_query_rules);
    if (taskRole != undefined) {
        let taskRoleArn = `${process.env.TASK_ROLE_ARN_PREFIX}/${taskRole}`;

        console.log(`fn=getEcsRunTaskParamsForJob taskRoleArn=${taskRoleArn}`);
        params.overrides.taskRoleArn = taskRoleArn;
    }
    
    return params;
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
    
    let tasks = event.Records.map(record => {
        let { Cluster, Job } = JSON.parse(record.body);
        return runTaskForBuildkiteJob(Cluster, Job);
    });
    
    await Promise.all(tasks);

    return {
        statusCode: 200,
    };
};
