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

async function runTaskForBuildkiteJob(k8sApi, job) {
    console.log(`fn=runTaskForBuildkiteJob attempt=${attempt}`);
    
    for (var attempt = 1; attempt < 6; attempt++) {
        try {
            let ecs = new AWS.ECS({apiVersion: '2014-11-13'});
            let taskParams = await getEcsRunTaskParamsForJob(job);

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
