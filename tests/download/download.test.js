'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { downloadToFile } = require('../../src/download');
const { DownloadError } = require('../../src/download-errors');

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function tmpFile() {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mugpacks-download-test-'));
  return path.join(dir, 'out.bin');
}

test('downloads a 200 response byte-for-byte to destPath', async () => {
  const body = Buffer.from('fixture archive bytes, not really a zip');
  await withServer(
    (req, res) => {
      res.writeHead(200, { 'content-type': 'application/zip' });
      res.end(body);
    },
    async (base) => {
      const dest = await tmpFile();
      const result = await downloadToFile(`${base}/kfm.zip`, dest);
      assert.equal(result, dest);
      assert.deepEqual(await fs.promises.readFile(dest), body);
    },
  );
});

test('follows a redirect to the final location', async () => {
  const body = Buffer.from('redirected bytes');
  await withServer(
    (req, res) => {
      if (req.url === '/first') {
        res.writeHead(302, { location: '/second' });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end(body);
    },
    async (base) => {
      const dest = await tmpFile();
      await downloadToFile(`${base}/first`, dest);
      assert.deepEqual(await fs.promises.readFile(dest), body);
    },
  );
});

test('a 404 response throws DownloadError naming the status, and leaves no partial file', async () => {
  await withServer(
    (req, res) => {
      res.writeHead(404, 'Not Found');
      res.end('nope');
    },
    async (base) => {
      const dest = await tmpFile();
      await assert.rejects(
        () => downloadToFile(`${base}/missing.zip`, dest),
        (err) => {
          assert.ok(err instanceof DownloadError);
          assert.match(err.reason, /404/);
          return true;
        },
      );
      assert.equal(fs.existsSync(dest), false);
    },
  );
});

test('a connection failure throws DownloadError, not a raw network exception', async () => {
  const dest = await tmpFile();
  // Nothing is listening on this port.
  await assert.rejects(
    () => downloadToFile('http://127.0.0.1:1/unreachable.zip', dest),
    (err) => {
      assert.ok(err instanceof DownloadError);
      return true;
    },
  );
});

test('a non-http(s) URL is rejected without attempting a connection', async () => {
  const dest = await tmpFile();
  await assert.rejects(
    () => downloadToFile('ftp://example.com/kfm.zip', dest),
    (err) => {
      assert.ok(err instanceof DownloadError);
      assert.match(err.reason, /protocol/);
      return true;
    },
  );
});
