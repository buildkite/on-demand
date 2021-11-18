FROM amazonlinux:2

ARG TARGETARCH
ARG TARGETVARIANT

RUN yum update -y && \
	yum install -y curl tar zip gzip pigz git

ENV DOCKER_VERSION=20.10.9
ENV DOCKER_RELEASE=stable

RUN	case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") docker_arch=x86_64 ;; \
	"arm64/") docker_arch=aarch64 ;; \
	"*") echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
	esac && \
	cd /tmp && \
	curl --location --fail  --show-error --output docker.tgz "https://download.docker.com/linux/static/${DOCKER_RELEASE}/${docker_arch}/docker-${DOCKER_VERSION}.tgz" && \
	tar -xvzf docker.tgz && \
	mv docker/* /usr/bin && \
	rm docker.tgz

ENV DOCKER_COMPOSE_VERSION=2.1.1

RUN case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") compose_arch=x86_64 ;; \
	"arm64/") compose_arch=aarch64 ;; \
	"*")      echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
	esac && \
	curl --location --fail  --show-error --output /usr/local/bin/docker-compose "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${compose_arch}" && \
    chmod +x /usr/local/bin/docker-compose

ENV DOCKER_BUILDX_VERSION=0.7.0

RUN case "${TARGETARCH}/${TARGETVARIANT}" in \
  	"amd64/") buildx_arch=amd64 ;; \
  	"arm64/") buildx_arch=arm64 ;; \
    "*")      echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
    esac && \
    cli_dir=/usr/libexec/docker/cli-plugins && \
    mkdir -p "${cli_dir}" && \
	curl --location --fail  --output "${cli_dir}/docker-buildx" "https://github.com/docker/buildx/releases/download/v${DOCKER_BUILDX_VERSION}/buildx-v${DOCKER_BUILDX_VERSION}.linux-${buildx_arch}" && \
	chmod +x "${cli_dir}/docker-buildx"

RUN yum install -y unzip && \
	cd /tmp && \
	case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") aws_arch="x86_64" ;; \
	"arm64/") aws_arch="aarch64" ;; \
    "*")      echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
    esac && \
	curl --location --fail  --show-error --output awscliv2.zip "https://awscli.amazonaws.com/awscli-exe-linux-${aws_arch}.zip" && \
	unzip awscliv2.zip && \
	rm awscliv2.zip && \
	./aws/install && \
	rm -r ./aws && \
	aws configure set s3.signature_version s3v4

RUN yum install -y jq

ENV GIT_LFS_RELEASE=2.10.0

RUN case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") lfs_arch="amd64" ;; \
	"arm64/") lfs_arch="arm64" ;; \
    "*")      echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
    esac && \
    cd /tmp && \
    curl --location --fail  --show-error --output git-lfs.tgz https://github.com/git-lfs/git-lfs/releases/download/v${GIT_LFS_RELEASE}/git-lfs-linux-${lfs_arch}-v${GIT_LFS_RELEASE}.tar.gz && \
    mkdir git-lfs && \
    tar -xvzf git-lfs.tgz -C git-lfs && \
    chmod 755 git-lfs/git-lfs && \
    ./git-lfs/install.sh && \
    rm -rf git-lfs.tgz ./git-lfs && \
    git lfs install

RUN case "${TARGETARCH}/${TARGETVARIANT}" in \
	"amd64/") agent_arch=x86_64 ;; \
	"arm64/") agent_arch=aarch64 ;; \
	"*") echo "unknown target arch/variant $TARGETARCH/$TARGETVARIANT"; exit 1 ;; \
	esac && \
	echo -e "[buildkite-agent]\nname = Buildkite Pty Ltd\nbaseurl = https://yum.buildkite.com/buildkite-agent/stable/${agent_arch}/\nenabled=1\ngpgcheck=0\npriority=1" > /etc/yum.repos.d/buildkite-agent.repo && \
	yum install -y buildkite-agent
