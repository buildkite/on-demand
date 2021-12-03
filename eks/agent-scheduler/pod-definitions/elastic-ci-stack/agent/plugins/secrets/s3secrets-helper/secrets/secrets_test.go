package secrets_test

import (
	"bytes"
	"errors"
	"io"
	"log"
	"math/rand"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/buildkite/elastic-ci-stack-s3-secrets-hooks/s3secrets-helper/v2/secrets"
	"github.com/buildkite/elastic-ci-stack-s3-secrets-hooks/s3secrets-helper/v2/sentinel"
)

type FakeClient struct {
	t    *testing.T
	data map[string]FakeObject
}

type FakeObject struct {
	data []byte
	err  error
}

func (c *FakeClient) Get(bucket, key string) ([]byte, error) {
	time.Sleep(time.Duration(rand.Int()%100) * time.Millisecond)
	path := bucket + "/" + key
	if result, ok := c.data[path]; ok {
		c.t.Logf("FakeClient Get %s: %d bytes, error: %v", path, len(result.data), result.err)
		return result.data, result.err
	}
	c.t.Logf("FakeClient Get %s: Not Found", path)
	return nil, sentinel.ErrNotFound
}

func (c *FakeClient) BucketExists(bucket string) (bool, error) {
	return true, nil
}

type FakeAgent struct {
	t    *testing.T
	keys []string
	run  bool
}

func (a *FakeAgent) Run() (bool, error) {
	if a.run {
		return false, nil
	}
	a.run = true
	return true, nil
}

func (a *FakeAgent) Add(key []byte) error {
	if !a.run {
		return errors.New("Agent must Run() before Add()")
	}
	a.t.Logf("FakeAgent Add (%d bytes)", len(key))
	a.keys = append(a.keys, string(key))
	return nil
}

func (a *FakeAgent) Pid() int {
	return 42
}

func (a *FakeAgent) Stdout() io.Reader {
	if len(a.keys) == 0 {
		return strings.NewReader("")
	}
	return strings.NewReader(`SSH_AUTH_SOCK=/path/to/socket; export SSH_AUTH_SOCK;
SSH_AGENT_PID=42; export SSH_AGENT_PID;
echo Agent pid 42
`)
}

func TestRun(t *testing.T) {
	fakeData := map[string]FakeObject{
		"bkt/pipeline/private_ssh_key": {nil, sentinel.ErrNotFound},
		"bkt/pipeline/id_rsa_github":   {[]byte("pipeline key"), nil},
		"bkt/private_ssh_key":          {[]byte("general key"), nil},
		"bkt/id_rsa_github":            {nil, sentinel.ErrForbidden},

		"bkt/env":                  {[]byte("A=one\nB=two"), nil},
		"bkt/environment":          {nil, sentinel.ErrForbidden},
		"bkt/pipeline/env":         {nil, sentinel.ErrNotFound},
		"bkt/pipeline/environment": {[]byte("C=three"), nil},

		"bkt/git-credentials":          {[]byte("general git key"), nil},
		"bkt/pipeline/git-credentials": {[]byte("pipeline git key"), nil},
	}
	logbuf := &bytes.Buffer{}
	fakeAgent := &FakeAgent{t: t}
	envSink := &bytes.Buffer{}

	conf := secrets.Config{
		Repo:                "git@github.com:buildkite/bash-example.git",
		Bucket:              "bkt",
		Prefix:              "pipeline",
		Client:              &FakeClient{t: t, data: fakeData},
		Logger:              log.New(logbuf, "", log.LstdFlags),
		SSHAgent:            fakeAgent,
		EnvSink:             envSink,
		GitCredentialHelper: "/path/to/git-credential-s3-secrets",
	}
	if err := secrets.Run(conf); err != nil {
		t.Error(err)
	}

	// verify ssh-agent
	assertDeepEqual(t, []string{"pipeline key", "general key"}, fakeAgent.keys)

	// verify env
	gitCredentialHelpers := strings.Join([]string{
		`'credential.helper=/path/to/git-credential-s3-secrets bkt git-credentials'`,
		`'credential.helper=/path/to/git-credential-s3-secrets bkt pipeline/git-credentials'`,
	}, " ")
	expected := strings.Join([]string{
		// because an SSH key was found, ssh-agent was started:
		"SSH_AUTH_SOCK=/path/to/socket; export SSH_AUTH_SOCK;",
		"SSH_AGENT_PID=42; export SSH_AGENT_PID;",
		"echo Agent pid 42",
		// combined env files:
		"A=one",
		"B=two",
		"C=three",
		// because git-credentials were found:
		// (wrap in double quotes so that bash eval doesn't consume the inner single quote.
		`GIT_CONFIG_PARAMETERS="` + gitCredentialHelpers + `"`,
	}, "\n") + "\n"
	if actual := envSink.String(); expected != actual {
		t.Errorf("unexpected env written:\n-%q\n+%q", expected, actual)
	}
	t.Logf("hook log:\n%s", logbuf.String())
}

func TestNoneFound(t *testing.T) {
	fakeData := map[string]FakeObject{}
	logbuf := &bytes.Buffer{}
	fakeAgent := &FakeAgent{t: t, keys: []string{}}
	envSink := &bytes.Buffer{}

	conf := secrets.Config{
		Repo:     "git@github.com:buildkite/bash-example.git",
		Bucket:   "bkt",
		Prefix:   "pipeline",
		Logger:   log.New(logbuf, "", log.LstdFlags),
		Client:   &FakeClient{t: t, data: fakeData},
		SSHAgent: fakeAgent,
		EnvSink:  envSink,
	}
	if err := secrets.Run(conf); err != nil {
		t.Error(err)
	}
	assertDeepEqual(t, []string{}, fakeAgent.keys)
	if envSink.Len() != 0 {
		t.Errorf("expected envSink to be empty, got %q", envSink.String())
	}
	expectedWarning := "+++ :warning: Failed to find an SSH key in secret bucket"
	if !strings.Contains(logbuf.String(), expectedWarning) {
		t.Error("expected warning about no SSH keys for git@... repo")
	}
	t.Logf("hook log:\n%s", logbuf.String())
}

func assertDeepEqual(t *testing.T, expected, actual interface{}) {
	if !reflect.DeepEqual(expected, actual) {
		t.Errorf("expected %q, got %q", expected, actual)
	}
}
