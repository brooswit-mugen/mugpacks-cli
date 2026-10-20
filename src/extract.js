'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const {
  CorruptArchiveError,
  UnsafeArchiveEntryError,
  SubpathNotFoundError,
} = require('./errors');

const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

// Reject anything that isn't a plain, relative, forward-slash zip entry
// path. This is independent of whatever the config's `subpath` validation
// already did (MUGEN-5 49071/49088/49094) -- extraction owns its own
// containment boundary and must not trust that an upstream check ran, or
// ran correctly, on every entry name inside an untrusted archive.
function assertSafeEntryName(entryName) {
  if (entryName.length === 0) {
    throw new UnsafeArchiveEntryError(entryName, 'empty entry name');
  }
  if (entryName.includes('\\')) {
    throw new UnsafeArchiveEntryError(entryName, 'contains a backslash');
  }
  if (entryName.startsWith('/') || entryName.startsWith('//')) {
    throw new UnsafeArchiveEntryError(entryName, 'absolute path');
  }
  if (/^[A-Za-z]:/.test(entryName)) {
    throw new UnsafeArchiveEntryError(entryName, 'Windows drive-prefixed path');
  }

  const isDir = entryName.endsWith('/');
  const segments = entryName.split('/');
  if (isDir) segments.pop(); // trailing "" from the directory marker

  for (const segment of segments) {
    if (segment === '' || segment === '.') {
      throw new UnsafeArchiveEntryError(entryName, 'empty or "." path component');
    }
    if (segment === '..') {
      throw new UnsafeArchiveEntryError(entryName, 'traversal ("..") path component');
    }
  }
}

// Join `entryName` under `destDir` and verify the resolved path is still
// contained within destDir. String-level validation above should already
// guarantee this, but extraction re-derives and re-checks the real
// filesystem path rather than trusting that validation alone (same
// "fast-fail, not the only guard" principle MUGEN-5 states for subpath).
function resolveContained(destDir, entryName) {
  const resolved = path.resolve(destDir, entryName);
  const base = destDir.endsWith(path.sep) ? destDir : destDir + path.sep;
  if (resolved !== destDir && !resolved.startsWith(base)) {
    throw new UnsafeArchiveEntryError(entryName, 'escapes the extraction root');
  }
  return resolved;
}

function openZip(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true, validateEntrySizes: true }, (err, zipfile) => {
      if (err) return reject(new CorruptArchiveError(archivePath, err.message));
      resolve(zipfile);
    });
  });
}

function readEntryStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      resolve(stream);
    });
  });
}

/**
 * Extract every entry of the zip archive at `archivePath` into `destDir`
 * (an empty, caller-owned staging directory -- this function never touches
 * anything outside it). Rejects the whole archive on the first unsafe or
 * corrupt entry, before any further files are written from it.
 *
 * Extracted files are written with plain, non-executable permissions: this
 * function only ever writes bytes, it never chmods anything executable or
 * invokes extracted content, regardless of what mode bits the archive
 * itself records.
 */
async function extractArchive(archivePath, destDir) {
  const zipfile = await openZip(archivePath);

  await new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      zipfile.close();
      reject(err);
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    zipfile.on('error', (err) => {
      // yauzl validates each entry's own fileName before emitting 'entry'
      // and reports an unsafe one (absolute, or containing "..") through
      // this same generic error event, auto-closing the zipfile -- so an
      // unsafe path can surface here instead of from assertSafeEntryName
      // below. Distinguish it from an actually-corrupt archive by message,
      // since yauzl does not give these a distinct error type.
      const unsafePathPattern = /^(absolute path|invalid relative path): /;
      fail(
        unsafePathPattern.test(err.message)
          ? new UnsafeArchiveEntryError(archivePath, err.message)
          : new CorruptArchiveError(archivePath, err.message),
      );
    });
    zipfile.on('end', succeed);

    zipfile.on('entry', (entry) => {
      (async () => {
        assertSafeEntryName(entry.fileName);
        const destPath = resolveContained(destDir, entry.fileName);

        if (entry.fileName.endsWith('/')) {
          await fs.promises.mkdir(destPath, { recursive: true, mode: DIR_MODE });
          zipfile.readEntry();
          return;
        }

        await fs.promises.mkdir(path.dirname(destPath), { recursive: true, mode: DIR_MODE });
        const stream = await readEntryStream(zipfile, entry);
        await pipeline(stream, fs.createWriteStream(destPath, { mode: FILE_MODE }));
        zipfile.readEntry();
      })().catch((err) => {
        fail(err instanceof CorruptArchiveError || err instanceof UnsafeArchiveEntryError
          ? err
          : new CorruptArchiveError(archivePath, err.message));
      });
    });

    zipfile.readEntry();
  });
}

/**
 * Resolve the config's `subpath` against an already-extracted staging
 * directory. `subpath` is expected to already be the normalized,
 * contract-validated value from MUGEN-5/MUGEN-6 ("" for archive root, or a
 * safe relative path) -- this still re-checks containment itself rather
 * than assuming the caller validated it.
 *
 * Throws SubpathNotFoundError if nothing exists at that path.
 */
async function resolveSubpath(stagingDir, subpath) {
  const target = subpath === '' ? stagingDir : resolveContained(stagingDir, subpath);
  try {
    await fs.promises.access(target);
  } catch {
    throw new SubpathNotFoundError(subpath);
  }
  return target;
}

module.exports = { extractArchive, resolveSubpath };
