// CLI acceptance contract for the "mugpacks install" command (MUGEN-1/4),
// written against the config/command/error contract delivered in MUGEN-5
// comment 49028, using the fixtures in ../../fixtures.
//
// MUGEN-10 wires this up: the harness below (copy fixtures/mugen-root to a
// fresh temp dir per test, serve fixtures/archives/** over a local http
// server, rewrite __INSTALL_DIR__/__FIXTURE_SERVER__ in the fixture
// configs, and invoke the real CLI via src/cli.js's `run`) replaces the
// `test.todo` placeholders this file used to hold with real assertions on
// exit code, stdout/stderr, and the resulting installDir contents.
//
// Run with: node --test tests/acceptance
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

// Serves fixtures/archives/** over a local http server so a config's
// __FIXTURE_SERVER__ placeholder resolves to a real, downloadable URL.
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

// A fresh, throwaway copy of fixtures/mugen-root -- never run a test
// against the checked-in copy directly (see its own README).
function freshMugenRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-mugen-root-'));
  fs.cpSync(path.join(FIXTURES_ROOT, 'mugen-root'), dir, { recursive: true });
  return dir;
}

function writeConfig(contents) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-config-'));
  const configPath = path.join(configDir, 'mugpacks.yaml');
  fs.writeFileSync(configPath, contents);
  return configPath;
}

function writeRewrittenConfig(fixtureName, { installDir, fixtureServer }) {
  const template = fs.readFileSync(path.join(FIXTURES_ROOT, 'config', fixtureName), 'utf8');
  const rewritten = template
    .replaceAll('__INSTALL_DIR__', installDir)
    .replaceAll('__FIXTURE_SERVER__', fixtureServer);
  return writeConfig(rewritten);
}

// Recursively snapshots every regular file under `dir` as relative-path ->
// content Buffer, so a later snapshot can be compared for byte-for-byte
// equality (used to assert "installDir is left untouched").
function snapshotDir(dir) {
  const snapshot = new Map();
  const walk = (current, rel) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryRel = rel ? path.join(rel, entry.name) : entry.name;
      const entryAbs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(entryAbs, entryRel);
      } else if (entry.isFile()) {
        snapshot.set(entryRel, fs.readFileSync(entryAbs));
      }
    }
  };
  walk(dir, '');
  return snapshot;
}

function assertSameSnapshot(before, after, message) {
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), message);
  for (const [relPath, contents] of before) {
    assert.deepEqual(after.get(relPath), contents, `${message} (${relPath} changed)`);
  }
}

test('valid-two-chars-two-stages.yaml installs both chars under installDir/chars/<id> and both stages under installDir/stages/<id>, exit code 0', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeRewrittenConfig('valid-two-chars-two-stages.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);
    assert.equal(code, 0, io.err());

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
  });
});

test('valid-two-chars-two-stages.yaml registers all 4 items by adding exactly one [Characters] line per char and one [ExtraStages] line per stage to data/select.def', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeRewrittenConfig('valid-two-chars-two-stages.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);
    assert.equal(code, 0, io.err());

    const selectDef = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
    for (const expectedLine of [
      'fixture-fighter-a/fixture-fighter-a.def, random',
      'fixture-fighter-b/fixture-fighter-b.def, random',
      'stages/fixture-stage-dojo/fixture-stage-dojo.def',
      'stages/fixture-stage-arena/fixture-stage-arena.def',
    ]) {
      const occurrences = selectDef.split('\n').filter((line) => line.trim() === expectedLine).length;
      assert.equal(occurrences, 1, `expected exactly one line "${expectedLine}", found ${occurrences}`);
    }
  });
});

test('install preserves every pre-existing file/entry in fixtures/mugen-root (preexisting-char dir, and the pre-existing select.def [Characters] line) byte-for-byte', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const preexistingCharDef = fs.readFileSync(
      path.join(installDir, 'chars', 'preexisting-char', 'preexisting-char.def'),
    );
    const configPath = writeRewrittenConfig('valid-two-chars-two-stages.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);
    assert.equal(code, 0, io.err());

    assert.deepEqual(
      fs.readFileSync(path.join(installDir, 'chars', 'preexisting-char', 'preexisting-char.def')),
      preexistingCharDef,
      'preexisting-char must survive byte-for-byte',
    );

    const selectDef = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
    assert.match(
      selectDef,
      /^preexisting-char, preexisting-char\/preexisting-char\.def$/m,
      'the pre-existing select.def line must be preserved, typo and all',
    );
  });
});

test('invalid-missing-installdir.yaml fails fast with "error: cannot read config <path>: <reason>" or equivalent missing-field error, exit code != 0, and installDir is left untouched (no partial mutation)', async () => {
  const installDir = freshMugenRoot();
  const before = snapshotDir(installDir);
  const configPath = writeRewrittenConfig('invalid-missing-installdir.yaml', {
    installDir,
    fixtureServer: 'http://127.0.0.1:1',
  });

  const io = capture();
  const code = await run(['install', '--config', configPath], io);

  assert.notEqual(code, 0);
  assert.equal(io.err(), 'error: config is missing required field "installDir"\n');
  assertSameSnapshot(before, snapshotDir(installDir), 'installDir must be untouched');
});

test('invalid-installdir-not-a-directory.yaml fails with \'error: installDir "<path>" does not exist or is not a directory\', exit code != 0', async () => {
  const installDir = freshMugenRoot();
  const configPath = writeRewrittenConfig('invalid-installdir-not-a-directory.yaml', {
    installDir,
    fixtureServer: 'http://127.0.0.1:1',
  });

  const io = capture();
  const code = await run(['install', '--config', configPath], io);

  assert.notEqual(code, 0);
  assert.equal(
    io.err(),
    `error: installDir "${path.join(installDir, 'does-not-exist')}" does not exist or is not a directory\n`,
  );
});

test('invalid-duplicate-id.yaml fails with \'error: duplicate item id "fixture-fighter-a"\', exit code != 0, before any download starts', async () => {
  const installDir = freshMugenRoot();
  // No archive server is started for this test: validation must fail
  // before any download is ever attempted, so nothing here needs one.
  const configPath = writeRewrittenConfig('invalid-duplicate-id.yaml', {
    installDir,
    fixtureServer: 'http://127.0.0.1:1',
  });

  const io = capture();
  const code = await run(['install', '--config', configPath], io);

  assert.notEqual(code, 0);
  assert.equal(io.err(), 'error: duplicate item id "fixture-fighter-a"\n');
});

test('invalid-bad-type.yaml fails with \'error: item "fixture-fighter-a": type must be "char" or "stage", got "costume"\', exit code != 0', async () => {
  const installDir = freshMugenRoot();
  const configPath = writeRewrittenConfig('invalid-bad-type.yaml', {
    installDir,
    fixtureServer: 'http://127.0.0.1:1',
  });

  const io = capture();
  const code = await run(['install', '--config', configPath], io);

  assert.notEqual(code, 0);
  assert.equal(io.err(), 'error: item "fixture-fighter-a": type must be "char" or "stage", got "costume"\n');
});

test('invalid-bad-url.yaml fails with \'error: item "fixture-fighter-a": url is not a valid http(s) URL\', exit code != 0', async () => {
  const installDir = freshMugenRoot();
  const configPath = writeRewrittenConfig('invalid-bad-url.yaml', {
    installDir,
    fixtureServer: 'http://127.0.0.1:1',
  });

  const io = capture();
  const code = await run(['install', '--config', configPath], io);

  assert.notEqual(code, 0);
  assert.equal(io.err(), 'error: item "fixture-fighter-a": url is not a valid http(s) URL\n');
});

test('download-failure.yaml (url 404s) fails with \'error: item "fixture-fighter-a": download failed: <status/reason>\', exit code != 0, installDir left untouched', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const before = snapshotDir(installDir);
    const configPath = writeRewrittenConfig('download-failure.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);

    assert.notEqual(code, 0);
    assert.match(io.err(), /^error: item "fixture-fighter-a": download failed for .*: HTTP 404/);
    assertSameSnapshot(before, snapshotDir(installDir), 'installDir must be untouched by a download failure');
  });
});

test('unsafe-archive-zip-slip.yaml is rejected before any file is written outside installDir -- assert the would-be escape path (e.g. a file above installDir named by the archive\'s "../../../" entry) does not exist anywhere on disk after the run, exit code != 0', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeRewrittenConfig('unsafe-archive-zip-slip.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);

    assert.notEqual(code, 0);
    assert.match(io.err(), /^error: item "fixture-fighter-a": /);
    // The archive's own traversal entry is "../../../tmp/mugen9-zipslip-pwned.txt",
    // escaping three levels above the staging directory under os.tmpdir().
    const wouldBeEscapePath = path.join(path.dirname(os.tmpdir()), 'tmp', 'mugen9-zipslip-pwned.txt');
    assert.equal(fs.existsSync(wouldBeEscapePath), false, 'the zip-slip target must never be written');
  });
});

test('unsafe-archive-absolute-path.yaml is rejected before any file is written to its absolute destination -- assert that path does not exist after the run, exit code != 0', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeRewrittenConfig('unsafe-archive-absolute-path.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);

    assert.notEqual(code, 0);
    assert.match(io.err(), /^error: item "fixture-fighter-a": /);
    // The archive's own absolute-path entry is "/etc/mugen9-pwned.txt".
    assert.equal(fs.existsSync('/etc/mugen9-pwned.txt'), false, 'the absolute-path target must never be written');
  });
});

test('missing-subpath.yaml fails with \'error: item "fixture-fighter-a": subpath "fixture-fighter-a/" not found in downloaded archive\', exit code != 0', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeRewrittenConfig('missing-subpath.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);

    assert.notEqual(code, 0);
    // The config's "fixture-fighter-a/" subpath is normalized (trailing
    // slash stripped) by MUGEN-6's own validation before it ever reaches
    // the archive-resolution step, so the normalized form is what the
    // error names.
    assert.equal(io.err(), 'error: item "fixture-fighter-a": subpath "fixture-fighter-a" not found in downloaded archive\n');
  });
});

test('corrupt-archive.yaml fails with a clear extraction/decompression error (not a stack trace), exit code != 0', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeRewrittenConfig('corrupt-archive.yaml', { installDir, fixtureServer });

    const io = capture();
    const code = await run(['install', '--config', configPath], io);

    assert.notEqual(code, 0);
    assert.match(io.err(), /^error: item "fixture-fighter-a": corrupt archive /);
    assert.doesNotMatch(io.err(), /at .*\(.*:\d+:\d+\)/, 'error output must not contain a stack trace');
  });
});

test('a config combining one otherwise-valid item with one item that fails VALIDATION (e.g. a duplicate id, caught before any download starts) fails before any item is downloaded, extracted, or installed -- installDir is left completely untouched, matching MUGEN-5 comment49028\'s "fail fast, no partial mutation on validation errors" guarantee', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const before = snapshotDir(installDir);
    const configPath = writeConfig(
      [
        `installDir: ${installDir}`,
        'items:',
        '  - id: fixture-fighter-a',
        '    type: char',
        `    url: ${fixtureServer}/archives/characters/fixture-fighter-a.zip`,
        '    subpath: fixture-fighter-a/',
        '  - id: fixture-fighter-a',
        '    type: stage',
        `    url: ${fixtureServer}/archives/stages/fixture-stage-dojo.zip`,
        '    subpath: ""',
        '',
      ].join('\n'),
    );

    const io = capture();
    const code = await run(['install', '--config', configPath], io);

    assert.notEqual(code, 0);
    assert.equal(io.err(), 'error: duplicate item id "fixture-fighter-a"\n');
    assertSameSnapshot(before, snapshotDir(installDir), 'installDir must stay completely untouched on a validation failure');
  });
});

test('multi-item config where one item fails at the download/transport stage (one valid char + one download-failure item, both past validation) exits non-zero and prints one error line naming the failed item id, and does not require rolling back the item that had already installed successfully', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeConfig(
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

    assert.notEqual(code, 0);
    assert.equal(io.out(), '');
    const errorLines = io.err().trim().split('\n');
    assert.equal(errorLines.length, 1, 'exactly one error line, naming the failed item');
    assert.match(errorLines[0], /^error: item "fixture-fighter-missing": /);

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

test('running valid-two-chars-two-stages.yaml a second time against the same installDir succeeds, exits 0, and does not duplicate the [Characters]/[ExtraStages] registration lines (select.def gains no new lines on the repeat run)', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const configPath = writeRewrittenConfig('valid-two-chars-two-stages.yaml', { installDir, fixtureServer });

    const first = capture();
    assert.equal(await run(['install', '--config', configPath], first), 0, first.err());
    const selectDefAfterFirstRun = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');

    const second = capture();
    assert.equal(await run(['install', '--config', configPath], second), 0, second.err());
    const selectDefAfterSecondRun = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');

    assert.equal(
      selectDefAfterSecondRun,
      selectDefAfterFirstRun,
      'repeat invocation must not add any new or duplicate registration lines',
    );
  });
});

test('running valid-two-chars-two-stages.yaml a second time re-installs/overwrites installDir/chars/<id> and installDir/stages/<id> content without leaving stale files from a prior differently-shaped version of the same id', async () => {
  await withFixtureArchiveServer(async (fixtureServer) => {
    const installDir = freshMugenRoot();
    const firstConfigPath = writeRewrittenConfig('valid-two-chars-two-stages.yaml', { installDir, fixtureServer });

    const first = capture();
    assert.equal(await run(['install', '--config', firstConfigPath], first), 0, first.err());
    assert.equal(
      fs.existsSync(path.join(installDir, 'chars', 'fixture-fighter-a', 'fixture-fighter-a.def')),
      true,
    );

    // Reinstall the same id ("fixture-fighter-a") from a differently-shaped
    // archive (fixture-fighter-b's content, under fixture-fighter-b's own
    // subpath/def filename) to simulate a changed upstream package.
    const secondConfigPath = writeConfig(
      [
        `installDir: ${installDir}`,
        'items:',
        '  - id: fixture-fighter-a',
        '    type: char',
        `    url: ${fixtureServer}/archives/characters/fixture-fighter-b.zip`,
        '    subpath: fixture-fighter-b/',
        '',
      ].join('\n'),
    );

    const second = capture();
    assert.equal(await run(['install', '--config', secondConfigPath], second), 0, second.err());

    assert.equal(
      fs.existsSync(path.join(installDir, 'chars', 'fixture-fighter-a', 'fixture-fighter-a.def')),
      false,
      'the stale fixture-fighter-a.def from the prior version must not remain',
    );
    assert.equal(
      fs.existsSync(path.join(installDir, 'chars', 'fixture-fighter-a', 'fixture-fighter-b.def')),
      true,
      'the new version content must be installed in its place',
    );

    const selectDef = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
    assert.doesNotMatch(selectDef, /^fixture-fighter-a\/fixture-fighter-a\.def, random$/m);
    assert.match(selectDef, /^fixture-fighter-a\/fixture-fighter-b\.def, random$/m);
  });
});
