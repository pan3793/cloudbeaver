FROM node:20-bullseye-slim

RUN set -x && \
    apt-get update -q && \
    apt-get install -yq wget curl unzip git openjdk-17-jdk-headless && \
    if [ $(uname -m) = "aarch64" ]; then apt-get install -yq make g++ python3; fi && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g lerna && \
    wget https://archive.apache.org/dist/maven/maven-3/3.9.6/binaries/apache-maven-3.9.6-bin.tar.gz && \
    tar -xzf apache-maven-3.9.6-bin.tar.gz -C /opt && \
    ln -s /opt/apache-maven-3.9.6/bin/mvn /usr/bin/mvn && \
    rm apache-maven-3.9.6-bin.tar.gz

ENTRYPOINT [ "/bin/bash" ]
