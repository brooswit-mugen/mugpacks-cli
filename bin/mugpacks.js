#!/usr/bin/env node
'use strict';

const { run } = require('../src/cli');

run(process.argv.slice(2)).then((exitCode) => {
  process.exitCode = exitCode;
});
