'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { buildZip } = require('../support/make-zip');
const { buildRawZip } = require('../support/raw-zip');
const { extractArchive, resolveSubpath } = require('../../src/extract');
const {
  CorruptArchiveError,
  UnsafeArchiveEntryError,
  SubpathNotFoundError,
} = require('../../src/errors');

async function tmpDirs() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mugpacks-extract-test-'));
  const archivePath = path.join(root, 'archive.zip');
  const destDir = path.join(root, 'extracted');
  await fs.promises.mkdir(destDir);
  return { archivePath, destDir };
}

test('extracts a well-formed archive with nested directories', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = await buildZip([
    { name: 'kfm/kfm.def', content: '[Info]\nname = "fixture"\n' },
    { name: 'kfm/sprites/kfm.sff', content: 'binary-ish' },
  ]);
  await fs.promises.writeFile(archivePath, zip);

  await extractArchive(archivePath, destDir);

  assert.equal(
    await fs.promises.readFile(path.join(destDir, 'kfm/kfm.def'), 'utf8'),
    '[Info]\nname = "fixture"\n',
  );
  assert.equal(
    await fs.promises.readFile(path.join(destDir, 'kfm/sprites/kfm.sff'), 'utf8'),
    'binary-ish',
  );
});

test('extracted files are not executable', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = await buildZip([{ name: 'run.sh', content: '#!/bin/sh\necho hi\n' }]);
  await fs.promises.writeFile(archivePath, zip);

  await extractArchive(archivePath, destDir);

  const mode = (await fs.promises.stat(path.join(destDir, 'run.sh'))).mode;
  assert.equal(mode & 0o111, 0, 'extracted file must not carry any executable bit');
});

test('rejects a zip-slip ("../") entry before writing it, and writes nothing outside destDir', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = buildRawZip([
    { name: 'kfm/kfm.def', content: 'ok' },
    { name: '../../../escaped.txt', content: 'should never land' },
  ]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );

  const root = path.dirname(destDir);
  assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escaped.txt')), false);
});

test('rejects an absolute-path entry', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const escapeTarget = path.join(os.tmpdir(), 'mugpacks-extract-absolute-escape.txt');
  await fs.promises.rm(escapeTarget, { force: true });
  const zip = buildRawZip([{ name: escapeTarget.replace(/\\/g, '/'), content: 'nope' }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );
  assert.equal(fs.existsSync(escapeTarget), false);
});

test('rejects a Windows drive-prefixed entry', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = buildRawZip([{ name: 'C:/Windows/evil.txt', content: 'nope' }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );
});

test('rejects a UNC-prefixed entry', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = buildRawZip([{ name: '//server/share/evil.txt', content: 'nope' }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );
});

test('rejects an entry containing a backslash', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = buildRawZip([{ name: 'kfm\\..\\evil.txt', content: 'nope' }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );
});

test('a truncated/corrupt archive fails with CorruptArchiveError, not a raw parser exception', async () => {
  const { archivePath, destDir } = await tmpDirs();
  await fs.promises.writeFile(archivePath, Buffer.from('this is not a zip file at all'));

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof CorruptArchiveError);
      return true;
    },
  );
});

test('resolveSubpath("") returns the extraction root', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = await buildZip([{ name: 'stage.def', content: '[Info]\n' }]);
  await fs.promises.writeFile(archivePath, zip);
  await extractArchive(archivePath, destDir);

  const resolved = await resolveSubpath(destDir, '');
  assert.equal(resolved, destDir);
});

test('resolveSubpath resolves a nested relative subpath', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = await buildZip([{ name: 'kfm/kfm.def', content: '[Info]\n' }]);
  await fs.promises.writeFile(archivePath, zip);
  await extractArchive(archivePath, destDir);

  const resolved = await resolveSubpath(destDir, 'kfm');
  assert.equal(fs.existsSync(path.join(resolved, 'kfm.def')), true);
});

test('resolveSubpath throws SubpathNotFoundError when the subpath is absent from the archive', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const zip = await buildZip([{ name: 'kfm/kfm.def', content: '[Info]\n' }]);
  await fs.promises.writeFile(archivePath, zip);
  await extractArchive(archivePath, destDir);

  await assert.rejects(
    () => resolveSubpath(destDir, 'does-not-exist'),
    (err) => {
      assert.ok(err instanceof SubpathNotFoundError);
      assert.equal(err.subpath, 'does-not-exist');
      return true;
    },
  );
});
