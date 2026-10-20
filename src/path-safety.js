'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Thrown when a destructive destination write (mkdir/rm/cp/writeFile)
// would have to pass through a symlink somewhere between the trusted base
// directory and the target path to get there.
class UnsafeDestinationError extends Error {
  constructor(targetPath, reason) {
    super(`unsafe destination "${targetPath}": ${reason}`);
    this.name = 'UnsafeDestinationError';
    this.targetPath = targetPath;
    this.reason = reason;
  }
}

// Verifies every path component from `baseDir` down to and including
// `targetPath` is not a symlink, so a destructive write at `targetPath`
// can never be redirected outside `baseDir` by a symlink planted anywhere
// in between -- e.g. installDir/chars itself replaced with a symlink to
// an unrelated directory, or installDir/data/select.def itself replaced
// with a symlink to an external file. `baseDir` itself is trusted (it is
// the user-supplied, already-validated `installDir`) and is not checked;
// only what lies inside it is untrusted. Mirrors src/extract.js's
// no-follow containment model (archive extraction's own destination-
// safety check), applied here to the installation destination instead.
async function assertNoSymlinkAncestors(baseDir, targetPath) {
  const rel = path.relative(baseDir, targetPath);
  const segments = rel.split(path.sep).filter(Boolean);
  let current = baseDir;
  for (const segment of segments) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.promises.lstat(current);
    } catch {
      continue; // does not exist yet -- nothing to follow
    }
    if (stat.isSymbolicLink()) {
      throw new UnsafeDestinationError(targetPath, `"${segment}" is a symlink`);
    }
  }
}

module.exports = { assertNoSymlinkAncestors, UnsafeDestinationError };
