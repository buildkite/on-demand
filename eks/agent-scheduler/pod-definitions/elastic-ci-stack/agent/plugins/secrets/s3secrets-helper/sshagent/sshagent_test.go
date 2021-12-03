package sshagent

import "testing"

func TestParseOutputSock(t *testing.T) {
	out := `SSH_AUTH_SOCK=/path/to/socket; export SSH_AUTH_SOCK;
SSH_AGENT_PID=42; export SSH_AGENT_PID;
echo Agent pid 42
`
	sock, err := parseOutputSock(out)
	if err != nil {
		t.Error(err)
	}
	if expected, actual := "/path/to/socket", sock; expected != actual {
		t.Errorf("sock expected %q, got %q", expected, actual)
	}
}

func TestParseOutputPid(t *testing.T) {
	out := `SSH_AUTH_SOCK=/path/to/socket; export SSH_AUTH_SOCK;
SSH_AGENT_PID=42; export SSH_AGENT_PID;
echo Agent pid 42
`
	pid, err := parseOutputPid(out)
	if err != nil {
		t.Error(err)
	}
	if expected, actual := 42, pid; expected != actual {
		t.Errorf("pid expected %d, got %d", expected, actual)
	}
}
