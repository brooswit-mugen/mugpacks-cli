'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildZip } = require('../support/make-zip');
const { installItem, installPlan } = require('../../src/install');

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
    assert.match(
      fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
      /^\[Characters\]\nfixture-fighter-a, fixture-fighter-a\/fixture-fighter-a\.def\n$/,
    );
  });
});

test('installItem replaces a previous install of the same id, leaving no stale files from its old shape', async () => {
  const oldZip = await buildZip([{ name: 'stage/old-only.def', content: 'old' }]);
  const newZip = await buildZip([{ name: 'stage/new-only.def', content: 'new' }]);

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
    assert.equal(fs.existsSync(path.join(destDir, 'old-only.def')), true);

    await installItem(installDir, item({
      id: 'fixture-stage-arena',
      type: 'stage',
      subpath: 'stage/',
      url: `${base}/new.zip`,
      destDir,
    }));

    assert.equal(fs.existsSync(path.join(destDir, 'old-only.def')), false, 'stale file from the old shape must be gone');
    assert.equal(fs.existsSync(path.join(destDir, 'new-only.def')), true);

    // Repeat install of the same id must not duplicate its select.def line.
    const selectDef = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
    assert.equal(selectDef.match(/^fixture-stage-arena,/gm).length, 1);
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
    assert.match(
      fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
      /^\[Characters\]\nfixture-fighter-a,/,
    );
  });
});
