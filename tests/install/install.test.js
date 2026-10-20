'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildZip } = require('../support/make-zip');
const { installItem, installPlan } = require('../../src/install');
const { UnsafeDestinationError } = require('../../src/path-safety');

async function withZipServer(routes, fn) {
  const server = http.createServer((req, res) => {
    const zip = routes[req.url];
    if (!zip) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/zip' });
    res.end(zip);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function makeInstallDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-install-test-'));
}

function item(overrides) {
  return {
    id: 'fixture-fighter-a',
    type: 'char',
    subpath: 'fixture-fighter-a/',
    ...overrides,
  };
}

test('installItem copies the resolved content into destDir and registers it', async () => {
  const zip = await buildZip([
    { name: 'fixture-fighter-a/fixture-fighter-a.def', content: '[Info]\nname = fixture\n' },
    { name: 'fixture-fighter-a/fixture-fighter-a.sff', content: 'sprite-bytes' },
  ]);

  await withZipServer({ '/a.zip': zip }, async (base) => {
    const installDir = makeInstallDir();
    const destDir = path.join(installDir, 'chars', 'fixture-fighter-a');
    const plannedItem = item({ url: `${base}/a.zip`, destDir });

    await installItem(installDir, plannedItem);

    assert.equal(
      fs.readFileSync(path.join(destDir, 'fixture-fighter-a.def'), 'utf8'),
      '[Info]\nname = fixture\n',
    );
    assert.equal(fs.readFileSync(path.join(destDir, 'fixture-fighter-a.sff'), 'utf8'), 'sprite-bytes');
    assert.equal(
      fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
      '[Characters]\nfixture-fighter-a/fixture-fighter-a.def, random\n',
    );
  });
});

test('installItem replaces a previous install of the same id, leaving no stale files from its old shape', async () => {
  const oldZip = await buildZip([{ name: 'stage/fixture-stage-arena.def', content: 'old' }]);
  const newZip = await buildZip([{ name: 'stage/fixture-stage-arena.def', content: 'new' }]);

  await withZipServer({ '/old.zip': oldZip, '/new.zip': newZip }, async (base) => {
    const installDir = makeInstallDir();
    const destDir = path.join(installDir, 'stages', 'fixture-stage-arena');

    await installItem(installDir, item({
      id: 'fixture-stage-arena',
      type: 'stage',
      subpath: 'stage/',
      url: `${base}/old.zip`,
      destDir,
    }));
    assert.equal(fs.readFileSync(path.join(destDir, 'fixture-stage-arena.def'), 'utf8'), 'old');

    // Simulate the old content having had an extra file that the new
    // archive version doesn't ship anymore.
    fs.writeFileSync(path.join(destDir, 'stale-extra-file.txt'), 'leftover');

    await installItem(installDir, item({
      id: 'fixture-stage-arena',
      type: 'stage',
      subpath: 'stage/',
      url: `${base}/new.zip`,
      destDir,
    }));

    assert.equal(fs.readFileSync(path.join(destDir, 'fixture-stage-arena.def'), 'utf8'), 'new');
    assert.equal(fs.existsSync(path.join(destDir, 'stale-extra-file.txt')), false, 'stale file from the old shape must be gone');

    // Repeat install of the same id must not duplicate its select.def line.
    const selectDef = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
    assert.equal(selectDef.match(/^stages\/fixture-stage-arena\//gm).length, 1);
  });
});

test('installPlan continues past a failed item and reports it without touching the successful one', async () => {
  const zip = await buildZip([
    { name: 'fixture-fighter-a/fixture-fighter-a.def', content: 'ok' },
  ]);

  await withZipServer({ '/a.zip': zip }, async (base) => {
    const installDir = makeInstallDir();
    const plan = {
      installDir,
      items: [
        item({
          id: 'fixture-fighter-a',
          url: `${base}/a.zip`,
          destDir: path.join(installDir, 'chars', 'fixture-fighter-a'),
        }),
        item({
          id: 'fixture-fighter-missing',
          url: `${base}/does-not-exist.zip`,
          destDir: path.join(installDir, 'chars', 'fixture-fighter-missing'),
        }),
      ],
    };

    const failures = await installPlan(plan);

    assert.equal(failures.length, 1);
    assert.equal(failures[0].id, 'fixture-fighter-missing');
    assert.equal(
      fs.existsSync(path.join(installDir, 'chars', 'fixture-fighter-a', 'fixture-fighter-a.def')),
      true,
      'the item that succeeded must stay installed',
    );
    assert.equal(fs.existsSync(path.join(installDir, 'chars', 'fixture-fighter-missing')), false);
    assert.equal(
      fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
      '[Characters]\nfixture-fighter-a/fixture-fighter-a.def, random\n',
    );
  });
});

test('refuses to install through a symlinked chars directory, and leaves its outside target untouched', async () => {
  const zip = await buildZip([{ name: 'fighter/fighter.def', content: 'malicious payload' }]);

  await withZipServer({ '/a.zip': zip }, async (base) => {
    const installDir = makeInstallDir();
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-install-outside-'));
    fs.writeFileSync(path.join(outsideDir, 'precious.txt'), 'do not touch');
    // installDir/chars itself is a symlink to a sibling directory outside installDir.
    fs.symlinkSync(outsideDir, path.join(installDir, 'chars'), 'dir');

    const destDir = path.join(installDir, 'chars', 'fighter');
    await assert.rejects(
      () => installItem(installDir, item({ id: 'fighter', subpath: 'fighter/', url: `${base}/a.zip`, destDir })),
      (err) => {
        assert.ok(err instanceof UnsafeDestinationError);
        return true;
      },
    );

    assert.equal(fs.readFileSync(path.join(outsideDir, 'precious.txt'), 'utf8'), 'do not touch', 'the outside file must survive untouched');
    assert.equal(fs.existsSync(path.join(outsideDir, 'fighter')), false, 'nothing must have been written through the symlink');
  });
});
