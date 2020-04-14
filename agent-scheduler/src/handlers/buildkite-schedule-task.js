const AWS = require('aws-sdk');
const https = require('https');

async function scheduleRunTaskForBuildkiteJob(job) {
    console.log(`fn=scheduleRunTaskForBuildkiteJob`);
    
    let sqs = new AWS.SQS({apiVersion: '2012-11-05'});
    let message = {
      MessageBody: JSON.stringify({
          Job: job,
      }),
      QueueUrl: process.env.SQS_QUEUE_URL,
    };
    return sqs.sendMessage(message).promise();
}

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

exports.handler = async (webhook) => {
    console.log(`fn=handler event=${JSON.stringify(webhook)}`);
    
    let job = webhook.job;

    let queue = getAgentQueryRule("queue", job.agent_query_rules);
    let expectedQueue = process.env.BUILDKITE_QUEUE;
    if (queue != expectedQueue) {
        console.log(`fn=handler at=job_ignored`);

        return {
            statusCode: 400,
            body: JSON.stringify({
                message: `ignoring this job, the agent query rules specify queue='${queue}' which doesn't match '${expectedQueue}'`,
            }),
        };
    }
    
    let runTask = await scheduleRunTaskForBuildkiteJob(job);
    console.log(`fn=handler at=job_scheduled`);
    
    return {
        statusCode: 201,
        body: JSON.stringify({
            message: "scheduled run task",
        }),
    };
};
