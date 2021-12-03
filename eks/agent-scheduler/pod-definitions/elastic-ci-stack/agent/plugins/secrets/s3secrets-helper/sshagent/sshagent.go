package sshagent

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
)

const (
	envPID  = "SSH_AGENT_PID"
	envSock = "SSH_AUTH_SOCK"
)

var (
	regexpSock = regexp.MustCompile("(?m)^SSH_AUTH_SOCK=(.*); export SSH_AUTH_SOCK;$")
	regexpPid  = regexp.MustCompile("(?m)^SSH_AGENT_PID=(.*); export SSH_AGENT_PID;$")
)

// Agent represents an ssh-agent
type Agent struct {
	pid  int
	sock string
	out  []byte
}

// Run ensures an ssh-agent is running.
// If ssh-agent has already been started, do nothing.
// If SSH_AUTH_SOCK & SSH_AGENT_PID are set, adopt those.
// Otherwise, start an ssh-agent, which produces output like:
//     SSH_AUTH_SOCK=/path/to/socket; export SSH_AUTH_SOCK;
//     SSH_AGENT_PID=42; export SSH_AGENT_PID;
//     echo Agent pid 42
// The output is captured verbatim, and also parsed for those values.
// The SSH_AUTH_SOCK in either case is used for subsequent Add()
// The bool return value indicates whether the call started the agent.
func (a *Agent) Run() (bool, error) {
	if a.pid != 0 && a.sock != "" {
		return false, nil
	}
	if s, p := os.Getenv(envSock), os.Getenv(envPID); s != "" && p != "" {
		// already running before us
		pid, err := strconv.ParseInt(p, 10, 32)
		if err != nil {
			return false, fmt.Errorf("%s: %w", envPID, err)
		}
		a.sock = s
		a.pid = int(pid)
		return false, nil
	}
	cmd := exec.Command("ssh-agent", "-s")
	stdout, err := cmd.Output()
	if err != nil {
		return false, fmt.Errorf("running ssh-agent: %w", err)
	}
	sock, err := parseOutputSock(string(stdout))
	if err != nil {
		return false, err
	}
	pid, err := parseOutputPid(string(stdout))
	if err != nil {
		return false, err
	}
	a.out = stdout
	a.sock = sock
	a.pid = pid
	return true, nil
}

// Add wraps `ssh-agent add`
func (a *Agent) Add(key []byte) error {
	if a.pid == 0 || a.sock == "" {
		return errors.New("Agent must Run() before Add()")
	}
	cmd := exec.Command("ssh-add", "-")
	key = append(key, '\n')
	cmd.Stdin = bytes.NewReader(key)
	cmd.Env = []string{
		"SSH_AGENT_PID=" + strconv.Itoa(a.pid),
		"SSH_AUTH_SOCK=" + a.sock,
		"SSH_ASKPASS=/bin/false",
	}
	return cmd.Run()
}

// Pid is the process ID of the ssh-agent, either found in existing
// environment, or started by us.
func (a *Agent) Pid() int {
	return a.pid
}

// Stdout of the `ssh-agent -s` command.
func (a *Agent) Stdout() io.Reader {
	return bytes.NewReader(a.out)
}

// parseOutput returns the socket and pid from `ssh-agent -s` output, e.g:
func parseOutputSock(output string) (string, error) {
	match := regexpSock.FindStringSubmatch(output)
	if match == nil {
		return "", fmt.Errorf("%s not found in ssh-agent output", envSock)
	}
	return match[1], nil
}

func parseOutputPid(output string) (int, error) {
	match := regexpPid.FindStringSubmatch(output)
	if match == nil {
		return 0, fmt.Errorf("%s not found in ssh-agent output", envPID)
	}
	pid, err := strconv.ParseInt(match[1], 10, 32)
	if err != nil {
		return 0, fmt.Errorf("error parsing %s=%q as integer: %w", envPID, match[1], err)
	}
	return int(pid), nil
}
