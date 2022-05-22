#!/bin/bash
set -Eeuo pipefail

PROJECT_HOME="$(cd "`dirname "$0"`"/..; pwd)"

#command line arguments
CONFIGURATION_PATH="${PROJECT_HOME}/config/sample-databases/SQLiteConfiguration"
SAMPLE_DATABASE_PATH="${PROJECT_HOME}/config/sample-databases/db"

source build-backend.sh 
source build-frontend.sh
