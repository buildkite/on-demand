const AWS = require('aws-sdk');

exports.handler = async (event) => {
    console.log(`fn=handler event=${JSON.stringify(event)}`);

    /*
        Docs on request and response schema:
        https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/template-macros.html
    */

    let {
        region,
        accountId,
        fragment,
        transformId,
        params,
        requestId,
        templateParameterValues,
    } = event;

    console.log(`doing processing...`);

    let Globals = fragment.Globals || {};
    delete fragment.Globals;

    let GlobalsTaskDefinition = Globals.TaskDefinition || {};

    let resources = {};

    for (let resourceName in fragment['Resources']) {
        let resource = fragment['Resources'][resourceName];

        if (resource['Type'] != 'Buildkite::ECS::Agent' && resource['Type'] != 'Buildkite::ECS::TaskDefinition') {
            resources[resourceName] = resource;
            continue;
        }

        let properties = resource['Properties'];

        let taskDefinitionLogicalName = `${resourceName}TaskDefinition`;
        let logGroupLogicalName = `${resourceName}LogGroup`;
        let executionRoleLogicalName = `${resourceName}ExecutionRole`;
        let taskRoleLogicalName = `${resourceName}TaskRole`;

        var {
            Image,
            BuildkiteAgentImage,
            SshAgentBackend,
            Secrets,
            Environment,
            TaskFamily,
            TaskMemory,
            TaskCpu,
            TaskRoleArn,
            ...Rest
        } = properties;

        if (Object.keys(Rest).length != 0) {
            return {
                requestId: requestId,
                status: "error",
                message: `${resourceName} has unsupported parameters: ${Object.keys(Rest)}`,
            };
        }

        if (TaskCpu == undefined) {
            TaskCpu = 256;
        }
        if (TaskMemory == undefined) {
            TaskMemory = 512;
        }

        resources[logGroupLogicalName] = {
            Type: 'AWS::Logs::LogGroup',
            DependsOn: taskDefinitionLogicalName,
            Properties: {
                LogGroupName: {
                    "Fn::Sub": [
                        '/aws/ecs/${TaskFamily}',
                        {
                            TaskFamily: TaskFamily,
                        },
                    ],
                },
                RetentionInDays: 1,
            },
        };

        let BuildkiteAgentTokenParameterPath = GlobalsTaskDefinition.BuildkiteAgentTokenParameterPath || '/buildkite/agent-token';

        var containerSecrets = [
            {
                Name: 'BUILDKITE_AGENT_TOKEN',
                ValueFrom: BuildkiteAgentTokenParameterPath,
            }
        ];
        if (Secrets != undefined) {
            containerSecrets = containerSecrets.concat(Secrets);
        }

        // Construct a list of SSM parameters to give the container access
        // to based on containerSecrets
        var ssmParameters = containerSecrets.map((secret) => {
            // Secret is Object with Name, ValueFrom
            return {
                "Fn::Sub": [
                    'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter${ValueFrom}',
                    {
                        ValueFrom: secret['ValueFrom'],
                    }
                ]
            };
        });

        resources[executionRoleLogicalName] = {
            Type: 'AWS::IAM::Role',
            Properties: {
                AssumeRolePolicyDocument: {
                    Statement: [
                        {
                            Effect: 'Allow',
                            Principal: {
                                Service: [
                                    'ecs-tasks.amazonaws.com',
                                ],
                            },
                            Action: [
                                'sts:AssumeRole'
                            ],
                        }
                    ]
                },
                Path: '/BuildkiteTaskExecutionRole/',
                ManagedPolicyArns: [
                    'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
                ],
                Policies: [
                    {
                        PolicyName: 'FetchDecryptSecrets',
                        PolicyDocument: {
                            Statement: [
                                {
                                    Effect: 'Allow',
                                    Action: [
                                        'ssm:GetParameter',
                                        'ssm:GetParameters',
                                    ],
                                    Resource: ssmParameters,
                                },
                                {
                                    Effect: 'Allow',
                                    Action: 'kms:Decrypt',
                                    Resource: [
                                        { "Fn::Sub": "arn:aws:kms:${AWS::Region}:${AWS::AccountId}:key/aws/ssm" }
                                    ]
                                }
                            ]
                        }
                    }
                ]
            },
        };
        let ExecutionRoleArn = { "Fn::GetAtt": [ executionRoleLogicalName, "Arn" ] };

        // Optional parameter, create a task role if unspecified
        if (TaskRoleArn == undefined) {
            var taskRole = {
                Type: 'AWS::IAM::Role',
                Properties: {
                    AssumeRolePolicyDocument: {
                        Statement: [
                            {
                                Effect: 'Allow',
                                Principal: {
                                    Service: [
                                        'ecs-tasks.amazonaws.com',
                                    ],
                                },
                                Action: [
                                    'sts:AssumeRole'
                                ],
                            }
                        ]
                    },
                    Path: '/BuildkiteAgentTask/',
                    Policies: []
                },
            };

            if (SshAgentBackend != undefined) {
                taskRole['Properties']['Policies'].push({
                    PolicyName: 'SshAgentApi',
                    PolicyDocument: {
                        Statement: [
                            {
                                Effect: 'Allow',
                                Action: [
                                    'execute-api:Invoke',
                                ],
                                Resource: [
                                    {
                                        "Fn::Sub": [
                                            '${SshAgentBackend}/*/*',
                                            {
                                                SshAgentBackend: SshAgentBackend,
                                            }
                                        ]
                                    }
                                ],
                            },
                        ]
                    }
                });
            }

            resources[taskRoleLogicalName] = taskRole;

            TaskRoleArn = {
                "Fn::GetAtt": [ taskRoleLogicalName, "Arn" ]
            };
        }

        let includeBuildkiteAgent = (BuildkiteAgentImage != undefined);
        let includeSshAgent = (SshAgentBackend != undefined);

        let aboutPlatform = {
            "Fn::Sub": [
                "ECS Task\nTask Family: ${TaskFamily}\nImage: ${Image}\nRole: ${TaskRole}",
                {
                    TaskFamily: TaskFamily,
                    Image: Image,
                    TaskRole: TaskRoleArn,
                }
            ]
        };

        var containerEnvironment = [
            includeBuildkiteAgent ? { Name: "BUILDKITE_BUILD_PATH", Value: "/buildkite/builds" } : { "Ref": "AWS::NoValue" },
            includeBuildkiteAgent ? { Name: "BUILDKITE_HOOKS_PATH", Value: "/buildkite/hooks" } : { "Ref": "AWS::NoValue" },
            includeBuildkiteAgent ? { Name: "BUILDKITE_PLUGINS_PATH", Value: "/buildkite/plugins" } : { "Ref": "AWS::NoValue" },
            includeSshAgent ? { Name: "SSH_AUTH_SOCK", Value: "/ssh/socket" } : { "Ref": "AWS::NoValue" },
            { Name: "BUILDKITE_ABOUT_PLATFORM", Value: aboutPlatform },
        ];
        if (Environment != undefined) {
            containerEnvironment = containerEnvironment.concat(Environment);
        }

        var taskDefinition = {
            Type: "AWS::ECS::TaskDefinition",
            Properties: {
                ContainerDefinitions: [
                    {
                        Name: 'agent',
                        EntryPoint: includeBuildkiteAgent ? [ '/buildkite/bin/buildkite-agent' ] : [ 'buildkite-agent' ],
                        Command: [ 'start' ],
                        Essential: true,
                        Image: Image,
                        LogConfiguration: {
                            LogDriver: 'awslogs',
                            Options: {
                                'awslogs-region': { Ref: "AWS::Region" },
                                'awslogs-group': {
                                    "Fn::Sub": [
                                        '/aws/ecs/${TaskFamily}',
                                        {
                                            TaskFamily: TaskFamily,
                                        },
                                    ],
                                },
                                'awslogs-stream-prefix': 'ecs',
                            }
                        },
                        Environment: containerEnvironment,
                        Secrets: containerSecrets,
                        DependsOn: [
                            includeBuildkiteAgent ? { Condition: "COMPLETE", ContainerName: "agent-init" } : { "Ref": "AWS::NoValue" },
                            includeSshAgent ? { Condition: "HEALTHY", ContainerName: "ssh-agent" } : { "Ref": "AWS::NoValue" },
                        ],
                        MountPoints: [
                            includeSshAgent ? { ContainerPath: "/ssh", SourceVolume: "ssh-agent" } : { "Ref": "AWS::NoValue" },
                        ],
                        VolumesFrom: [
                            includeBuildkiteAgent ? { SourceContainer: "agent-init" } : { "Ref": "AWS::NoValue" },
                        ]
                    },
                ],
                Cpu: TaskCpu,
                Memory: TaskMemory,
                Family: TaskFamily,
                NetworkMode: 'awsvpc',
                ExecutionRoleArn: ExecutionRoleArn,
                TaskRoleArn: TaskRoleArn,
                RequiresCompatibilities: [
                    "FARGATE",
                ],
                Volumes: [
                    includeSshAgent ? { Name: 'ssh-agent' } : { "Ref": "AWS::NoValue" },
                ],
            }
        };

        if (includeBuildkiteAgent) {
            taskDefinition['Properties']['ContainerDefinitions'].push({
                Name: 'agent-init',
                EntryPoint: [
                    '/bin/sh',
                    '-c'
                ],
                Command: [
                    'echo container=agent-init at=initalised',
                ],
                Essential: false,
                Image: BuildkiteAgentImage,
                LogConfiguration: {
                    LogDriver: 'awslogs',
                    Options: {
                        'awslogs-region': { "Ref": "AWS::Region" },
                        'awslogs-group': {
                            "Fn::Sub": [
                                '/aws/ecs/${TaskFamily}',
                                {
                                    TaskFamily: TaskFamily,
                                },
                            ],
                        },
                        'awslogs-stream-prefix': 'ecs',
                    },
                },
            });
        }

        if (includeSshAgent) {
            let sshAgentUrl = {
                "Fn::Sub": [
                    "https://${ApiId}.execute-api.${Region}.amazonaws.com/${Stage}",
                    {
                        ApiId: {
                            "Fn::Select": [
                                5,
                                { "Fn::Split": [ ":", { "Fn::Select": [ 0, { "Fn::Split": [ "/", SshAgentBackend ] } ] } ] }
                            ]
                        },
                        Region: {
                            "Fn::Select": [
                                3,
                                { "Fn::Split": [ ":", { "Fn::Select": [ 0, { "Fn::Split": [ "/", SshAgentBackend ] } ] } ] }
                            ]
                        },
                        Stage: {
                            "Fn::Select": [
                                1,
                                { "Fn::Split": [ "/", SshAgentBackend ] }
                            ]
                        },
                    },
                ]
            };

            taskDefinition['Properties']['ContainerDefinitions'].push({
                Name: 'ssh-agent',
                Command: [
                    'iam-ssh-agent',
                    'daemon',
                    '--bind-to=/ssh/socket',
                ],
                Essential: true,
                Image: 'keithduncan/iam-ssh-agent',
                Environment: [
                    {
                        Name: 'IAM_SSH_AGENT_BACKEND_URL',
                        Value: sshAgentUrl,
                    }
                ],
                LogConfiguration: {
                    LogDriver: 'awslogs',
                    Options: {
                        'awslogs-region': { "Ref": "AWS::Region" },
                        'awslogs-group': {
                            "Fn::Sub": [
                                '/aws/ecs/${TaskFamily}',
                                {
                                    TaskFamily: TaskFamily,
                                },
                            ],
                        },
                        'awslogs-stream-prefix': 'ecs',
                    },
                },
                HealthCheck: {
                    Command: [
                        'test',
                        '-S',
                        '/ssh/socket',
                    ],
                },
                MountPoints: [
                    {
                        ContainerPath: '/ssh',
                        SourceVolume: 'ssh-agent',
                    }
                ]
            });
        }

        resources[taskDefinitionLogicalName] = taskDefinition;
    }

    fragment['Resources'] = resources;

    return {
        requestId: requestId,
        status: "success",
        fragment: fragment,
    };
};
