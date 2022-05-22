FROM node:14-bullseye-slim

RUN set -x && \
    apt-get update -q && \
    apt-get install -yq wget curl unzip openjdk-11-jdk-headless maven && \
    if [ $(uname -m) = "aarch64" ]; then apt-get install -yq make g++ python3; fi && \
    rm -rf /var/lib/apt/lists/* && \
    npm install -g lerna

ENTRYPOINT [ "/bin/bash" ]
