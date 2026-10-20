'use strict';

const path = require('path');

const { loadConfig } = require('./config');
const { installPlan } = require('./install');
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

// Runs the `mugpacks` CLI for one invocation. Resolves with the process
// exit code; writes human-readable `error: ...` lines to stderr.
//
// Config parsing/validation (MUGEN-6) stays fail-fast and synchronous: any
// ConfigError is reported and nothing below it -- including every
// download, extraction, or installDir write (MUGEN-7/MUGEN-8) -- ever
// runs, so a bad config never partially mutates installDir. Once a plan
// is validated, each item is installed and registered independently;
// MUGEN-5's per-item contract does not require rolling back an item that
// already installed successfully just because a later item failed.
async function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
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

  const failures = await installPlan(plan);
  if (failures.length > 0) {
    for (const { id, error } of failures) {
      stderr.write(`error: item "${id}": ${error.message}\n`);
    }
    return EXIT_ERROR;
  }

  stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  return EXIT_OK;
}

module.exports = { run, parseArgs };
