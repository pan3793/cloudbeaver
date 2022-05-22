#!/bin/bash
set -Eeo pipefail
set +u

PROJECT_HOME="$(cd "`dirname "$0"`"/..; pwd)"

# #command line arguments
# CONFIGURATION_PATH=${1-"${PROJECT_HOME}/config/sample-databases/DefaultConfiguration"}
# SAMPLE_DATABASE_PATH=${2-""}

# echo $CONFIGURATION_PATH
# echo $SAMPLE_DATABASE_PATH
echo "Clone and build Cloudbeaver"

rm -rf ${PROJECT_HOME}/deploy/drivers
rm -rf ${PROJECT_HOME}/deploy/cloudbeaver
mkdir ${PROJECT_HOME}/deploy/cloudbeaver
mkdir ${PROJECT_HOME}/deploy/cloudbeaver/server
mkdir ${PROJECT_HOME}/deploy/cloudbeaver/conf
mkdir ${PROJECT_HOME}/deploy/cloudbeaver/workspace
mkdir ${PROJECT_HOME}/deploy/cloudbeaver/web

echo "Pull cloudbeaver platform"

cd ${PROJECT_HOME}/..

echo "Pull dbeaver platform"
[ ! -d dbeaver ] && git clone https://github.com/dbeaver/dbeaver.git

cd "${PROJECT_HOME}/deploy"

echo "Build CloudBeaver server"

cd ${PROJECT_HOME}/server/product/aggregate
mvn clean verify $MAVEN_COMMON_OPTS -Dheadless-platform
if [[ "$?" -ne 0 ]] ; then
  echo 'Could not perform package'; exit $rc
fi
cd ${PROJECT_HOME}/deploy

echo "Copy server packages"

cp -rp ${PROJECT_HOME}/server/product/web-server/target/products/io.cloudbeaver.product/all/all/all/* ${PROJECT_HOME}/deploy/cloudbeaver/server
cp -p ${PROJECT_HOME}/deploy/scripts/* ${PROJECT_HOME}/deploy/cloudbeaver
mkdir ${PROJECT_HOME}/deploy/cloudbeaver/samples

if [[ -z $SAMPLE_DATABASE_PATH  ]]; then
  SAMPLE_DATABASE_PATH=""
else
  mkdir ${PROJECT_HOME}/deploy/cloudbeaver/samples/db
  cp -rp "${SAMPLE_DATABASE_PATH}" ${PROJECT_HOME}/deploy/cloudbeaver/samples/
fi

if [[ -z "$CONFIGURATION_PATH" ]]; then
  CONFIGURATION_PATH="${PROJECT_HOME}/config/sample-databases/DefaultConfiguration"
fi

cp -rp  ${PROJECT_HOME}/config/core/* ${PROJECT_HOME}/deploy/cloudbeaver/conf
cp -rp "${CONFIGURATION_PATH}"/GlobalConfiguration/.dbeaver/data-sources.json ${PROJECT_HOME}/deploy/cloudbeaver/conf/initial-data-sources.conf
cp -p "${CONFIGURATION_PATH}"/*.conf ${PROJECT_HOME}/deploy/cloudbeaver/conf/
mv ${PROJECT_HOME}/deploy/drivers ${PROJECT_HOME}/deploy/cloudbeaver

echo "End of backend build"