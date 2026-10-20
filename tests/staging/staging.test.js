'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { test } = require('node:test');
const { buildZip } = require('../support/make-zip');
const { fetchContent } = require('../../src/staging');
const { DownloadError, SubpathNotFoundError } = require('../../src/errors');

async function withZipServer(zipBuffer, fn) {
  const server = http.createServer((req, res) => {
    if (req.url === '/kfm.zip') {
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.end(zipBuffer);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('fetchContent downloads, extracts, and resolves subpath end-to-end', async () => {
  const zip = await buildZip([
    { name: 'kfm/kfm.def', content: '[Info]\nname = "fixture"\n' },
    { name: 'kfm/kfm.sff', content: 'binary-ish' },
  ]);

  await withZipServer(zip, async (base) => {
    const { contentPath, cleanup } = await fetchContent(`${base}/kfm.zip`, 'kfm/');
    try {
      assert.equal(
        await fs.promises.readFile(`${contentPath}/kfm.def`, 'utf8'),
        '[Info]\nname = "fixture"\n',
      );
    } finally {
      await cleanup();
    }
    assert.equal(fs.existsSync(contentPath), false, 'cleanup must remove the staging dir');
  });
});

test('fetchContent with subpath "" resolves the archive root', async () => {
  const zip = await buildZip([{ name: 'stage.def', content: '[Info]\n' }]);

  await withZipServer(zip, async (base) => {
    const { contentPath, cleanup } = await fetchContent(`${base}/kfm.zip`, '');
    try {
      assert.equal(await fs.promises.readFile(`${contentPath}/stage.def`, 'utf8'), '[Info]\n');
    } finally {
      await cleanup();
    }
  });
});

test('fetchContent propagates a download failure and leaves no staging directory behind', async () => {
  await withZipServer(Buffer.from('unused'), async (base) => {
    await assert.rejects(
      () => fetchContent(`${base}/does-not-exist.zip`, ''),
      (err) => {
        assert.ok(err instanceof DownloadError);
        return true;
      },
    );
  });
});

test('fetchContent propagates SubpathNotFoundError and cleans up the staging directory', async () => {
  const zip = await buildZip([{ name: 'kfm/kfm.def', content: '[Info]\n' }]);

  await withZipServer(zip, async (base) => {
    await assert.rejects(
      () => fetchContent(`${base}/kfm.zip`, 'does-not-exist'),
      (err) => {
        assert.ok(err instanceof SubpathNotFoundError);
        return true;
      },
    );
  });
});
