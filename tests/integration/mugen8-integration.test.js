// Focused end-to-end demonstration of MUGEN-8's own acceptance criteria
// (two chars/two stages install, preservation of unrelated content, safe
// repeat invocation without duplicate registration, actionable per-item
// failure) using this repository's real MUGEN-9 fixtures end to end
// through the actual CLI. This is a focused test of this ticket's
// pipeline, not the reserved MUGEN-10 acceptance harness: it does not
// touch, flip, or duplicate tests/acceptance/cli-acceptance.test.js's
// `test.todo` list, which stays MUGEN-10's to turn into real assertions.
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { run } = require('../../src/cli');

const FIXTURES_ROOT = path.join(__dirname, '..', '..', 'fixtures');

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

async function withFixtureArchiveServer(fn) {
  const server = http.createServer((req, res) => {
    const filePath = path.join(FIXTURES_ROOT, 'archives', decodeURIComponent(req.url.replace(/^\/archives\//, '')));
    fs.readFile(filePath, (err, body) => {
      if (err) {
        res.writeHead(404);
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.end(body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function freshMugenRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-mugen-root-'));
  fs.cpSync(path.join(FIXTURES_ROOT, 'mugen-root'), dir, { recursive: true });
  return dir;
}

function writeRewrittenConfig(fixtureName, { installDir, fixtureServer }) {
  const template = fs.readFileSync(path.join(FIXTURES_ROOT, 'config', fixtureName), 'utf8');
  const rewritten = template
    .replaceAll('__INSTALL_DIR__', installDir)
    .replaceAll('__FIXTURE_SERVER__', fixtureServer);
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-config-'));
  const configPath = path.join(configDir, 'mugpacks.yaml');
  fs.writeFileSync(configPath, rewritten);
  return configPath;
}

test('installs two characters and two stages, preserves pre-existing content, and is idempotent on repeat', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const preexistingCharDef = fs.readFileSync(
      path.join(installDir, 'chars', 'preexisting-char', 'preexisting-char.def'),
    );
    const configPath = writeRewrittenConfig('valid-two-chars-two-stages.yaml', { installDir, fixtureServer });

    const firstRun = capture();
    const firstCode = await run(['install', '--config', configPath], firstRun);
    assert.equal(firstCode, 0, firstRun.err());

    for (const [type, id] of [
      ['chars', 'fixture-fighter-a'],
      ['chars', 'fixture-fighter-b'],
      ['stages', 'fixture-stage-dojo'],
      ['stages', 'fixture-stage-arena'],
    ]) {
      assert.equal(
        fs.existsSync(path.join(installDir, type, id, `${id}.def`)),
        true,
        `${type}/${id}/${id}.def should have been installed`,
      );
    }

    // Pre-existing content must survive byte-for-byte.
    assert.deepEqual(
      fs.readFileSync(path.join(installDir, 'chars', 'preexisting-char', 'preexisting-char.def')),
      preexistingCharDef,
    );

    const selectDefAfterFirstRun = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
    // Pre-existing content preserved byte-for-byte, typo and all -- not a
    // syntax this module imitates for the new lines it adds below.
    assert.match(selectDefAfterFirstRun, /^preexisting-char, preexisting-char\/preexisting-char\.def$/m);
    assert.match(selectDefAfterFirstRun, /^fixture-fighter-a\/fixture-fighter-a\.def, random$/m);
    assert.match(selectDefAfterFirstRun, /^fixture-fighter-b\/fixture-fighter-b\.def, random$/m);
    assert.match(selectDefAfterFirstRun, /^stages\/fixture-stage-dojo\/fixture-stage-dojo\.def$/m);
    assert.match(selectDefAfterFirstRun, /^stages\/fixture-stage-arena\/fixture-stage-arena\.def$/m);

    const secondRun = capture();
    const secondCode = await run(['install', '--config', configPath], secondRun);
    assert.equal(secondCode, 0, secondRun.err());

    const selectDefAfterSecondRun = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
    assert.equal(
      selectDefAfterSecondRun,
      selectDefAfterFirstRun,
      'repeat invocation must not add any new or duplicate registration lines',
    );
  });
});

test('one item failing at the download stage reports that item and does not block the others', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-config-'));
    const configPath = path.join(configDir, 'mugpacks.yaml');
    fs.writeFileSync(
      configPath,
      [
        `installDir: ${installDir}`,
        'items:',
        '  - id: fixture-fighter-a',
        '    type: char',
        `    url: ${fixtureServer}/archives/characters/fixture-fighter-a.zip`,
        '    subpath: fixture-fighter-a/',
        '  - id: fixture-fighter-missing',
        '    type: char',
        `    url: ${fixtureServer}/archives/characters/does-not-exist.zip`,
        '    subpath: fixture-fighter-missing/',
        '',
      ].join('\n'),
    );

    const io = capture();
    const code = await run(['install', '--config', configPath], io);

    assert.equal(code, 1);
    assert.equal(io.out(), '');
    assert.match(io.err(), /^error: item "fixture-fighter-missing": /);
    assert.equal(
      fs.existsSync(path.join(installDir, 'chars', 'fixture-fighter-a', 'fixture-fighter-a.def')),
      true,
      'the item that succeeded must still be installed even though the other item failed',
    );
    assert.match(
      fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
      /^fixture-fighter-a\/fixture-fighter-a\.def, random$/m,
    );
  });
});
