'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { downloadToFile } = require('./download');
const { extractArchive, resolveSubpath } = require('./extract');

/**
 * Download `url` and extract it into a fresh, isolated staging directory,
 * then resolve `subpath` inside it. Nothing outside the returned staging
 * directory is ever written to -- in particular this never touches
 * `installDir`, so a failed or unsafe item can never leave a partial trace
 * there (MUGEN-5's "fail fast, no partial mutation" contract) and existing
 * installDir content is always preserved. The downloaded archive is never
 * executed; it is only read as zip data and copied byte-for-byte.
 *
 * Resolves with `{ contentPath, cleanup }`:
 *   - contentPath: the path (inside the staging dir) that `subpath`
 *     resolved to -- the caller (MUGEN-8's install step) copies from here
 *     into installDir/{chars,stages}/<id>.
 *   - cleanup: removes the entire staging directory. Callers should call
 *     this once contentPath has been copied out, success or failure.
 *
 * Throws DownloadError, CorruptArchiveError, UnsafeArchiveEntryError, or
 * SubpathNotFoundError (see ./errors.js) on any failure; the staging
 * directory for a failed fetch is removed before the error propagates.
 */
async function fetchContent(url, subpath, { tmpRoot = os.tmpdir() } = {}) {
  const stagingDir = await fs.promises.mkdtemp(path.join(tmpRoot, 'mugpacks-staging-'));
  const cleanup = () => fs.promises.rm(stagingDir, { recursive: true, force: true });

  try {
    const archivePath = path.join(stagingDir, 'archive.download');
    await downloadToFile(url, archivePath);

    const extractedDir = path.join(stagingDir, 'extracted');
    await fs.promises.mkdir(extractedDir);
    await extractArchive(archivePath, extractedDir);

    const contentPath = await resolveSubpath(extractedDir, subpath);
    return { contentPath, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}

module.exports = { fetchContent };
