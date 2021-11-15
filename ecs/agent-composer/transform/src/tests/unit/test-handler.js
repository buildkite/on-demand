'use strict';

const app = require('../../app.js');
const chai = require('chai');
const expect = chai.expect;
var event = {
    region: "us-east-1",
    accountId: "$ACCOUNT_ID",
    fragment: {
        AWSTemplateFormatVersion: "2010-09-09",
        Globals: {

        },
        Resources: {
            Terraform: {
                Type: "Buildkite::ECS::Agent",
                Properties: {
                    Image: "hashicorp/terraform:light",
                    BuildkiteAgentImage: {
                         "Fn::GetAtt": "BuildAgentSidecar.Outputs.Image"
                    },
                    SshAgentBackend: {
                        "Fn::FindInMap": [
                            "AgentConfig",
                            {
                                "Ref": "AWS::Region"
                            },
                            "SshBackend"
                        ]
                    },
                    TaskFamily: "terraform"
                }
            }
        }
    },
    transformId: "$TRANSFORM_ID",
    params: {

    },
    requestId: "$REQUEST_ID",
    templateParameterValues: {

    },
};
var context;

describe('Tests index', function () {
    it('verifies successful response', async () => {
        const result = await app.handler(event, context)

        expect(result).to.be.an('object');
        expect(result.requestId).to.equal("$REQUEST_ID");
        expect(result.status).to.equal("success");
        expect(result.fragment).to.be.an('object');
        expect(result.fragment.Resources).to.be.an('object');

        expect(result.fragment.Resources['TerraformTaskDefinition']).to.be.an('object');
        expect(result.fragment.Resources['TerraformLogGroup']).to.be.an('object');
        expect(result.fragment.Resources['TerraformExecutionRole']).to.be.an('object');
        expect(result.fragment.Resources['TerraformTaskRole']).to.be.an('object');
    });
});
