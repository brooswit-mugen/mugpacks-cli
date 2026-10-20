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
} = require('../../src/download-errors');

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

test('rejects an entry containing a backslash, isolated from any ".." segment', async () => {
  const { archivePath, destDir } = await tmpDirs();
  // No ".." anywhere in this name -- with strictFileNames:true this is
  // rejected purely for containing a backslash, not because some other
  // check (e.g. traversal) would also catch it.
  const zip = buildRawZip([{ name: 'kfm\\evil.txt', content: 'nope' }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );
});

test('rejects a symlink entry whose target points outside destDir, and writes nothing outside it', async () => {
  const { archivePath, destDir } = await tmpDirs();
  // A real zip-slip-via-symlink attack: entry 1 is a symlink named "link"
  // pointing at "../../../" (outside destDir); entry 2 writes a file
  // *through* that link name, which would land outside destDir if the
  // symlink were ever created and then followed.
  const zip = buildRawZip([
    { name: 'link', content: '../../../', unixMode: 0o120777 },
    { name: 'link/escaped.txt', content: 'should never land' },
  ]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );

  assert.equal(fs.existsSync(path.join(destDir, 'link')), false);
  const root = path.dirname(destDir);
  assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false);
  assert.equal(fs.existsSync(path.join(path.dirname(root), 'escaped.txt')), false);
});

test('rejects a Unix special-file entry (e.g. a FIFO) that is neither a regular file nor a directory', async () => {
  const { archivePath, destDir } = await tmpDirs();
  const S_IFIFO = 0o010000;
  const zip = buildRawZip([{ name: 'weird-pipe', content: '', unixMode: S_IFIFO | 0o644 }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );
});

test('refuses to write through a symlink that already exists on disk under destDir, independent of entry-type detection', async () => {
  const { archivePath, destDir } = await tmpDirs();
  // Simulate a pre-existing on-disk symlink under destDir (e.g. planted by
  // some other bug or a prior partial run) rather than one declared via
  // archive entry attributes -- this exercises the no-follow ancestor
  // check on its own, independent of assertNotLinkOrSpecialEntry.
  const escapeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mugpacks-extract-escape-'));
  await fs.promises.symlink(escapeDir, path.join(destDir, 'planted-link'));

  const zip = await buildZip([{ name: 'planted-link/evil.txt', content: 'should never land' }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof UnsafeArchiveEntryError);
      return true;
    },
  );

  assert.equal(fs.existsSync(path.join(escapeDir, 'evil.txt')), false);
});

test('rejects an entry whose extracted bytes do not match its declared CRC32, and leaves no partial file', async () => {
  const { archivePath, destDir } = await tmpDirs();
  // Same declared length and CRC32 as the original content, but the actual
  // stored bytes are corrupted -- yauzl's own validateEntrySizes only
  // checks byte *count*, so this must be caught by CRC32 verification,
  // not by size validation.
  const zip = buildRawZip([
    { name: 'kfm/kfm.def', content: '[Info]\nname = "fixture"\n', corruptPayload: true },
  ]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(
    () => extractArchive(archivePath, destDir),
    (err) => {
      assert.ok(err instanceof CorruptArchiveError);
      return true;
    },
  );

  assert.equal(fs.existsSync(path.join(destDir, 'kfm/kfm.def')), false);
});

test('a destination collision (EEXIST from the exclusive "wx" write) fails without deleting the pre-existing file', async () => {
  const { archivePath, destDir } = await tmpDirs();
  await fs.promises.mkdir(path.join(destDir, 'kfm'));
  const preExistingPath = path.join(destDir, 'kfm/kfm.def');
  await fs.promises.writeFile(preExistingPath, 'pre-existing, must survive');

  const zip = await buildZip([{ name: 'kfm/kfm.def', content: 'new content' }]);
  await fs.promises.writeFile(archivePath, zip);

  await assert.rejects(() => extractArchive(archivePath, destDir));

  // This attempt never created kfm/kfm.def (createWriteStream's 'wx' flag
  // failed with EEXIST before any byte was written) -- cleanup must not
  // delete a file it didn't create.
  assert.equal(await fs.promises.readFile(preExistingPath, 'utf8'), 'pre-existing, must survive');
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
