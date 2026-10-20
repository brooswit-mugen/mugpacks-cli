'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { run } = require('../src/cli');

function makeInstallDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-installdir-'));
}

function writeConfig(yamlText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-config-'));
  const configPath = path.join(dir, 'mugpacks.yaml');
  fs.writeFileSync(configPath, yamlText);
  return configPath;
}

function capture() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (chunk) => out.push(chunk) },
    stderr: { write: (chunk) => err.push(chunk) },
    out: () => out.join(''),
    err: () => err.join(''),
  };
}

test('install defaults to ./mugpacks.yaml when --config is omitted', async () => {
  const io = capture();
  const code = await run(['install'], io);
  assert.equal(code, 1);
  assert.match(io.err(), /^error: cannot read config /);
});

test('install with an invalid config exits non-zero with a single error line, before any install is attempted', async () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: costume
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  const io = capture();
  const code = await run(['install', '--config', configPath], io);
  assert.equal(code, 1);
  assert.equal(io.out(), '');
  assert.equal(io.err(), 'error: item "fixture-fighter-a": type must be "char" or "stage", got "costume"\n');
});

test('install with a NUL-containing subpath exits non-zero and never prints a plan', async () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "bad\\u0000path"
`);
  const io = capture();
  const code = await run(['install', '--config', configPath], io);
  assert.equal(code, 1);
  assert.equal(io.out(), '');
  assert.match(io.err(), /subpath is not a safe relative path/);
});

test('unknown command exits non-zero with a usage error', async () => {
  const io = capture();
  const code = await run(['bogus'], io);
  assert.equal(code, 1);
  assert.match(io.err(), /^error: unknown command "bogus"/);
});

test('--config without a value exits non-zero with a usage error', async () => {
  const io = capture();
  const code = await run(['install', '--config'], io);
  assert.equal(code, 1);
  assert.match(io.err(), /^error: --config requires a path argument/);
});
