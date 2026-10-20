'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');
const {
  CorruptArchiveError,
  UnsafeArchiveEntryError,
  SubpathNotFoundError,
} = require('./download-errors');

const FILE_MODE = 0o644;
const DIR_MODE = 0o755;

const UNIX_HOST_BYTE = 3; // version-made-by high byte for "Unix"
const S_IFMT = 0xf000;
const S_IFLNK = 0xa000;
const S_IFREG = 0x8000;
const S_IFDIR = 0x4000;

// Reject symlink (and any other non-regular-file/non-directory) entries
// outright: this archive format has no legitimate use for them here, and
// a symlink entry is exactly how a zip-based link-escape attack plants its
// escape hatch (point a link outside destDir, then have a later entry
// write "through" it). Not extracting it at all is simpler and safer than
// trying to validate a link target.
function assertNotLinkOrSpecialEntry(entry) {
  const isUnix = (entry.versionMadeBy >> 8) === UNIX_HOST_BYTE;
  if (!isUnix) return; // no unix mode bits recorded; nothing to check
  const mode = entry.externalFileAttributes >>> 16;
  if (mode === 0) return; // some tools leave this zeroed for plain files
  const fileType = mode & S_IFMT;
  if (fileType === S_IFLNK) {
    throw new UnsafeArchiveEntryError(entry.fileName, 'symlink entries are not allowed');
  }
  if (fileType !== 0 && fileType !== S_IFREG && fileType !== S_IFDIR) {
    throw new UnsafeArchiveEntryError(entry.fileName, 'not a regular file or directory');
  }
}

// Independent of the entry-name string checks and of rejecting symlink
// entries above: walk every path component from destDir down to destPath
// and verify none of them is *already* a symlink on disk, so extraction
// never follows a link to escape destDir regardless of how that link got
// there (a no-follow containment check, not just a lexical one).
async function assertNoSymlinkAncestors(destDir, destPath) {
  const rel = path.relative(destDir, destPath);
  const segments = rel.split(path.sep).filter(Boolean);
  let current = destDir;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.promises.lstat(current);
    } catch {
      continue; // does not exist yet -- nothing to follow
    }
    if (stat.isSymbolicLink()) {
      throw new UnsafeArchiveEntryError(rel, `"${segment}" is a symlink`);
    }
  }
}

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
    yauzl.open(
      archivePath,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zipfile) => {
        if (err) return reject(new CorruptArchiveError(archivePath, err.message));
        resolve(zipfile);
      },
    );
  });
}

// yauzl (and its `validateEntrySizes` option) checks the extracted byte
// *count* against the entry's recorded size, but explicitly does not check
// the extracted bytes' CRC32 against the entry's recorded crc32 (see its
// README's "No CRC-32 checking" section) -- so a same-length payload whose
// bytes were corrupted in transit or on disk would otherwise pass silently.
// This computes the CRC32 of the bytes as they stream through, and fails
// the archive if it doesn't match the entry's declared crc32 once the
// stream ends -- independent of, and in addition to, yauzl's own size check.
function crcVerifyTransform(entry, archivePath) {
  let crc = 0;
  return new Transform({
    transform(chunk, _enc, callback) {
      crc = zlib.crc32(chunk, crc);
      callback(null, chunk);
    },
    flush(callback) {
      if (crc !== entry.crc32) {
        return callback(
          new CorruptArchiveError(
            archivePath,
            `CRC32 mismatch for "${entry.fileName}": expected ${entry.crc32.toString(16)}, got ${crc.toString(16)}`,
          ),
        );
      }
      callback();
    },
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
      // and reports an unsafe one (absolute, containing "..", or -- with
      // strictFileNames:true -- containing a backslash) through this same
      // generic error event, auto-closing the zipfile -- so an unsafe path
      // can surface here instead of from assertSafeEntryName below.
      // Distinguish it from an actually-corrupt archive by message, since
      // yauzl does not give these a distinct error type.
      const unsafePathPattern = /^(absolute path|invalid relative path|invalid characters in fileName): /;
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
        assertNotLinkOrSpecialEntry(entry);
        const destPath = resolveContained(destDir, entry.fileName);
        await assertNoSymlinkAncestors(destDir, destPath);

        if (entry.fileName.endsWith('/')) {
          await fs.promises.mkdir(destPath, { recursive: true, mode: DIR_MODE });
          zipfile.readEntry();
          return;
        }

        await fs.promises.mkdir(path.dirname(destPath), { recursive: true, mode: DIR_MODE });
        const stream = await readEntryStream(zipfile, entry);
        const writeStream = fs.createWriteStream(destPath, { mode: FILE_MODE, flags: 'wx' });
        // 'wx' means createWriteStream itself can fail with EEXIST (e.g. a
        // duplicate entry name, or anything else already at destPath) --
        // in that case this attempt never created a file, so the cleanup
        // below must not delete whatever is already there. Only treat
        // destPath as ours to remove once the fd has actually been opened
        // by this attempt.
        let created = false;
        writeStream.once('open', () => {
          created = true;
        });
        try {
          await pipeline(stream, crcVerifyTransform(entry, archivePath), writeStream);
        } catch (err) {
          // A CRC32 mismatch is only known once the write stream has
          // already received (and likely written) bytes -- remove the
          // partial file rather than leaving corrupt content on disk.
          if (created) {
            await fs.promises.rm(destPath, { force: true });
          }
          throw err;
        }
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
  await assertNoSymlinkAncestors(stagingDir, target);
  try {
    await fs.promises.access(target);
  } catch {
    throw new SubpathNotFoundError(subpath);
  }
  return target;
}

module.exports = { extractArchive, resolveSubpath };
