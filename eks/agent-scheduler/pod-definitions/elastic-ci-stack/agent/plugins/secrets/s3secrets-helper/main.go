package main

import (
	"fmt"
	"log"
	"os"

	"github.com/buildkite/elastic-ci-stack-s3-secrets-hooks/s3secrets-helper/v2/s3"
	"github.com/buildkite/elastic-ci-stack-s3-secrets-hooks/s3secrets-helper/v2/secrets"
	"github.com/buildkite/elastic-ci-stack-s3-secrets-hooks/s3secrets-helper/v2/sshagent"
)

const (
	envBucket     = "BUILDKITE_PLUGIN_S3_SECRETS_BUCKET"
	envPrefix     = "BUILDKITE_PLUGIN_S3_SECRETS_BUCKET_PREFIX"
	envPipeline   = "BUILDKITE_PIPELINE_SLUG"
	envRepo       = "BUILDKITE_REPO"
	envCredHelper = "BUILDKITE_PLUGIN_S3_SECRETS_CREDHELPER"
)

func main() {
	log := log.New(os.Stderr, "", log.Lmsgprefix)
	if err := mainWithError(log); err != nil {
		log.Fatalf("fatal error: %v", err)
	}
}

func mainWithError(log *log.Logger) error {
	bucket := os.Getenv(envBucket)
	if bucket == "" {
		return nil
	}

	prefix := os.Getenv(envPrefix)
	if prefix == "" {
		prefix = os.Getenv(envPipeline)
	}
	if prefix == "" {
		return fmt.Errorf("%s or %s required", envPrefix, envPipeline)
	}

	client, err := s3.New(log, bucket)
	if err != nil {
		return err
	}

	agent := &sshagent.Agent{}

	credHelper := os.Getenv(envCredHelper)
	if credHelper == "" {
		return fmt.Errorf("%s required", envCredHelper)
	}

	return secrets.Run(secrets.Config{
		Repo:                os.Getenv(envRepo),
		Bucket:              bucket,
		Prefix:              prefix,
		Client:              client,
		Logger:              log,
		SSHAgent:            agent,
		EnvSink:             os.Stdout,
		GitCredentialHelper: credHelper,
	})
}
