'use strict';

const path = require('path');

const { loadConfig } = require('./config');
const { ConfigError } = require('./errors');
const { DEFAULT_CONFIG_FILENAME } = require('./constants');

const EXIT_OK = 0;
const EXIT_ERROR = 1;

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (command !== 'install') {
    throw new ConfigError(`unknown command "${command || ''}"; expected "install"`);
  }

  let configPath = DEFAULT_CONFIG_FILENAME;
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i] === '--config') {
      const value = rest[i + 1];
      if (!value) {
        throw new ConfigError('--config requires a path argument');
      }
      configPath = value;
      i += 1;
    } else {
      throw new ConfigError(`unknown argument "${rest[i]}"`);
    }
  }

  return { command, configPath: path.resolve(configPath) };
}

// Runs the `mugpacks` CLI for one invocation. Returns the process exit
// code; writes human-readable `error: ...` lines to stderr.
//
// MUGEN-6's scope stops at producing a validated, normalized installation
// plan (see src/config.js) -- actually downloading/extracting archives and
// writing/registering installed content is MUGEN-7/MUGEN-8's extraction
// and registration work, not duplicated here.
function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  let configPath;
  try {
    ({ configPath } = parseArgs(argv));
  } catch (err) {
    if (err instanceof ConfigError) {
      stderr.write(`error: ${err.message}\n`);
      return EXIT_ERROR;
    }
    throw err;
  }

  let plan;
  try {
    plan = loadConfig(configPath);
  } catch (err) {
    if (err instanceof ConfigError) {
      stderr.write(`error: ${err.message}\n`);
      return EXIT_ERROR;
    }
    throw err;
  }

  stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return EXIT_OK;
}

module.exports = { run, parseArgs };
