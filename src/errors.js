'use strict';

// Structured errors for the download/extraction pipeline (MUGEN-7). Each
// carries the raw fields a caller (the CLI command, MUGEN-8) needs to render
// the one-line error forms from the MUGEN-5 contract (e.g.
// `error: item "<id>": download failed: <status/reason>`) without this
// module knowing about item ids or the overall config.

class DownloadError extends Error {
  constructor(url, reason) {
    super(`download failed for ${url}: ${reason}`);
    this.name = 'DownloadError';
    this.url = url;
    this.reason = reason;
  }
}

class CorruptArchiveError extends Error {
  constructor(archivePath, reason) {
    super(`corrupt archive ${archivePath}: ${reason}`);
    this.name = 'CorruptArchiveError';
    this.archivePath = archivePath;
    this.reason = reason;
  }
}

// Thrown when an archive entry's own path would escape the extraction root
// (zip-slip via "../" segments, an absolute path, or a Windows drive/UNC
// form) regardless of what any upstream subpath validation already checked.
class UnsafeArchiveEntryError extends Error {
  constructor(entryName, reason) {
    super(`unsafe archive entry "${entryName}": ${reason}`);
    this.name = 'UnsafeArchiveEntryError';
    this.entryName = entryName;
    this.reason = reason;
  }
}

class SubpathNotFoundError extends Error {
  constructor(subpath) {
    super(`subpath "${subpath}" not found in downloaded archive`);
    this.name = 'SubpathNotFoundError';
    this.subpath = subpath;
  }
}

module.exports = {
  DownloadError,
  CorruptArchiveError,
  UnsafeArchiveEntryError,
  SubpathNotFoundError,
};
