#!/bin/bash
set -eu
npm pack
cd test-package
rm -rf ts/test/*.test.ts package.tgz
npm un promise-batcher
cat ../package.json | sed -r 's/("name": ")[^"]+/\1test-package/' > package.json
cp ../package-lock.json .
npm i
cp ../*.tgz package.tgz
npm i package.tgz
cp ../ts/test/*.test.ts ts/test/
npm test