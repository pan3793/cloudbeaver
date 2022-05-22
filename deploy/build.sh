#!/bin/bash
set -Eeuo pipefail

PROJECT_HOME="$(cd "`dirname "$0"`"/..; pwd)"

#command line arguments
CONFIGURATION_PATH="${PROJECT_HOME}/config/sample-databases/DefaultConfiguration"
SAMPLE_DATABASE_PATH=""

source ${PROJECT_HOME}/deploy/build-backend.sh 
source ${PROJECT_HOME}/deploy/build-frontend.sh
