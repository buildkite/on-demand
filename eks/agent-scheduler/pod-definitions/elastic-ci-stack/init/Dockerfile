FROM amazonlinux:2

RUN yum update -y && \
	yum install -y curl tar zip gzip pigz git

COPY install-elastic-ci-stack.sh /usr/local/bin/
COPY bk-fetch.sh /usr/local/bin/
