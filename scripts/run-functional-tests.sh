#!/bin/sh

set -e

if [ ! -d test/functional ] || ! find test/functional -type f -name '*.test.ts' -print -quit | grep -q .; then
  echo 'No functional tests configured'
  exit 0
fi

exec cross-env NODE_PATH=. mocha --require ts-node/register 'test/functional/*.test.ts' --timeout 25000 --reporter spec --recursive --exit
