FROM amazonlinux:2

ARG TARGETARCH
ARG TARGETVARIANT

RUN yum install -y curl tar gzip

ENV DOCKER_VERSION=20.10.9
ENV DOCKER_RELEASE=stable

RUN	case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") docker_arch=x86_64 ;; \
	"arm64/") docker_arch=aarch64 ;; \
	"*") echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
	esac && \
	cd /tmp && \
	curl --location --fail --silent --show-error --output docker.tgz "https://download.docker.com/linux/static/${DOCKER_RELEASE}/${docker_arch}/docker-${DOCKER_VERSION}.tgz" && \
	tar -xvzf docker.tgz && \
	mv docker/* /usr/bin && \
	rm docker.tgz

ENV DOCKER_COMPOSE_VERSION=2.1.1

RUN case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") compose_arch=amd64 ;; \
	"arm64/") compose_arch=arm64 ;; \
	"*")      echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
	esac && \
	curl --location --fail --silent --show-error --output /usr/local/bin/docker-compose "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${compose_arch}" && \
    chmod +x /usr/local/bin/docker-compose

ENV DOCKER_BUILDX_VERSION=0.5.1

RUN cli_dir=/usr/libexec/docker/cli-plugins && \
	mkdir -p "${cli_dir}" && \
	case "${TARGETARCH}/${TARGETVARIANT}" in \
  	"amd64/") buildx_arch="amd64" ;; \
  	"arm64/)  buildx_arch="aarch64" ;; \
    "*")      echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
    esac && \
	curl --location --fail --silent --output "${cli_dir}/docker-buildx" "https://github.com/docker/buildx/releases/download/v${DOCKER_BUILDX_VERSION}/buildx-v${DOCKER_BUILDX_VERSION}.linux-${buildx_arch}" && \
	chmod +x "${cli_dir}/docker-buildx"

RUN case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") agent_arch=x86_64 ;; \
	"arm64/") agent_arch=aarch64 ;; \
	"*") echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
	esac && \
	echo -e "[buildkite-agent]\nname = Buildkite Pty Ltd\nbaseurl = https://yum.buildkite.com/buildkite-agent/stable/${agent_arch}/\nenabled=1\ngpgcheck=0\npriority=1" > /etc/yum.repos.d/buildkite-agent.repo && \
	yum install -y buildkite-agent
