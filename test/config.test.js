'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { loadConfig } = require('../src/config');
const { ConfigError } = require('../src/errors');

function makeInstallDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-installdir-'));
}

function writeConfig(yamlText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-config-'));
  const configPath = path.join(dir, 'mugpacks.yaml');
  fs.writeFileSync(configPath, yamlText);
  return configPath;
}

function assertConfigError(fn, expectedMessage) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ConfigError, `expected a ConfigError, got ${err}`);
    assert.equal(err.message, expectedMessage);
    return true;
  });
}

test('valid two-char, two-stage config normalizes into an installation plan', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/archives/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
  - id: fixture-fighter-b
    type: char
    url: https://example.com/archives/fixture-fighter-b.zip
    subpath: fixture-fighter-b
  - id: fixture-stage-dojo
    type: stage
    url: https://example.com/archives/fixture-stage-dojo.zip
    subpath: ""
  - id: fixture-stage-arena
    type: stage
    url: https://example.com/archives/fixture-stage-arena.zip
    subpath: ""
`);

  const plan = loadConfig(configPath);

  assert.equal(plan.installDir, installDir);
  assert.equal(plan.items.length, 4);

  assert.deepEqual(plan.items[0], {
    id: 'fixture-fighter-a',
    type: 'char',
    url: 'https://example.com/archives/fixture-fighter-a.zip',
    subpath: 'fixture-fighter-a',
    destDir: path.join(installDir, 'chars', 'fixture-fighter-a'),
  });
  // A single trailing "/" is stripped; "kfm/" and "kfm" are equivalent.
  assert.equal(plan.items[1].subpath, 'fixture-fighter-b');
  assert.equal(plan.items[2].subpath, '');
  assert.equal(plan.items[2].destDir, path.join(installDir, 'stages', 'fixture-stage-dojo'));
  assert.equal(plan.items[3].destDir, path.join(installDir, 'stages', 'fixture-stage-arena'));
});

test('cannot read config: missing file', () => {
  const missingPath = path.join(os.tmpdir(), 'mugpacks-does-not-exist', 'mugpacks.yaml');
  assert.throws(() => loadConfig(missingPath), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /^cannot read config /);
    return true;
  });
});

test('cannot read config: invalid YAML', () => {
  const configPath = writeConfig('installDir: [this is not\n  closed');
  assert.throws(() => loadConfig(configPath), (err) => {
    assert.ok(err instanceof ConfigError);
    assert.match(err.message, /^cannot read config /);
    return true;
  });
});

test('missing installDir field', () => {
  const configPath = writeConfig(`
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  assertConfigError(() => loadConfig(configPath), 'config is missing required field "installDir"');
});

test('relative installDir is rejected', () => {
  const configPath = writeConfig(`
installDir: relative/path
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  assertConfigError(() => loadConfig(configPath), 'installDir "relative/path" must be an absolute path');
});

test('installDir that does not exist is rejected', () => {
  const missingDir = path.join(makeInstallDir(), 'does-not-exist');
  const configPath = writeConfig(`
installDir: ${missingDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  assertConfigError(() => loadConfig(configPath), `installDir "${missingDir}" does not exist or is not a directory`);
});

test('installDir that is a file, not a directory, is rejected', () => {
  const dir = makeInstallDir();
  const filePath = path.join(dir, 'not-a-directory');
  fs.writeFileSync(filePath, '');
  const configPath = writeConfig(`
installDir: ${filePath}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  assertConfigError(() => loadConfig(configPath), `installDir "${filePath}" does not exist or is not a directory`);
});

test('duplicate item id is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
  - id: fixture-fighter-a
    type: stage
    url: https://example.com/fixture-stage-dojo.zip
    subpath: ""
`);
  assertConfigError(() => loadConfig(configPath), 'duplicate item id "fixture-fighter-a"');
});

test('item type must be "char" or "stage"', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: costume
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": type must be "char" or "stage", got "costume"',
  );
});

test('item url must be http(s)', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: file:///etc/passwd
    subpath: fixture-fighter-a/
`);
  assertConfigError(() => loadConfig(configPath), 'item "fixture-fighter-a": url is not a valid http(s) URL');
});

test('item url that is not a URL at all is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: "not a url"
    subpath: fixture-fighter-a/
`);
  assertConfigError(() => loadConfig(configPath), 'item "fixture-fighter-a": url is not a valid http(s) URL');
});

test('item id containing a path separator is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: "../outside"
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "../outside": id is not a valid path segment (expected [A-Za-z0-9][A-Za-z0-9._-]*, no separators, cannot start with ".")',
  );
});

test('item id starting with "." is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: ".hidden"
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item ".hidden": id is not a valid path segment (expected [A-Za-z0-9][A-Za-z0-9._-]*, no separators, cannot start with ".")',
  );
});

test('subpath "" selects the archive root', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-stage-dojo
    type: stage
    url: https://example.com/fixture-stage-dojo.zip
    subpath: ""
`);
  const plan = loadConfig(configPath);
  assert.equal(plan.items[0].subpath, '');
});

test('subpath containing a NUL byte is rejected, not accepted as a valid path', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "bad\\u0000path"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('subpath "/" is rejected as absolute, not normalized to the root sentinel', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "/"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('subpath with a leading "/" is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "/etc/passwd"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('subpath with a Windows drive prefix is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "C:/evil"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('subpath with a UNC prefix is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "//server/share"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('subpath containing a backslash is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "kfm\\\\evil"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('subpath containing a ".." component is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "../outside"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('subpath with an internal empty component ("//") is rejected', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "kfm//evil"
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-a": subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)',
  );
});

test('a single trailing slash is stripped (kfm/ and kfm are equivalent)', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: "kfm/"
`);
  const plan = loadConfig(configPath);
  assert.equal(plan.items[0].subpath, 'kfm');
});

test('missing/invalid fields fail before any download would start (first item only)', () => {
  const installDir = makeInstallDir();
  const configPath = writeConfig(`
installDir: ${installDir}
items:
  - id: fixture-fighter-a
    type: char
    url: https://example.com/fixture-fighter-a.zip
    subpath: fixture-fighter-a/
  - id: fixture-fighter-b
    type: costume
    url: https://example.com/fixture-fighter-b.zip
    subpath: fixture-fighter-b/
`);
  assertConfigError(
    () => loadConfig(configPath),
    'item "fixture-fighter-b": type must be "char" or "stage", got "costume"',
  );
});
