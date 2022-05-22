#!/bin/bash
set -Eeuo pipefail

PROJECT_HOME="$(cd "`dirname "$0"`"/..; pwd)"

echo "Build static content"

cd ${PROJECT_HOME}/webapp

yarn
yarn lerna run bootstrap
yarn lerna run bundle --no-bail --stream --scope=@cloudbeaver/product-default #-- -- --env source-map
if [[ "$?" -ne 0 ]] ; then
  echo 'Application build failed'; exit $rc
fi

cd ${PROJECT_HOME}/deploy

echo "Copy static content"

cp -rp ${PROJECT_HOME}/webapp/packages/product-default/lib/* ${PROJECT_HOME}/deploy/cloudbeaver/web

echo "Cloudbeaver is ready. Run run-server.bat in cloudbeaver folder to start the server."
