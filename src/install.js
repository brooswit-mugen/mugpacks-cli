'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { fetchContent } = require('./staging');
const { registerSelections } = require('./registry');

const SELECT_DEF_RELATIVE_PATH = path.join('data', 'select.def');

// Replaces `destDir` with a fresh copy of `srcDir`'s contents. Removing
// destDir first (rather than merging into it) is what keeps a repeat
// install from leaving stale files behind when the same id's archive
// changed shape between runs. destDir's parent (installDir/chars or
// installDir/stages) is created on demand for a type installed for the
// first time.
async function replaceInstalledContent(srcDir, destDir) {
  await fs.promises.mkdir(path.dirname(destDir), { recursive: true });
  await fs.promises.rm(destDir, { recursive: true, force: true });
  await fs.promises.cp(srcDir, destDir, { recursive: true });
}

// Installs one already-validated plan item (see src/config.js):
// downloads/extracts/resolves its content (MUGEN-7), replaces
// installDir/{chars,stages}/<id> with it, then registers it in
// installDir/data/select.def (MUGEN-8). installDir is never touched until
// the fetch has fully succeeded, so a fetch failure leaves installDir
// exactly as it was for this item.
async function installItem(installDir, item) {
  const { contentPath, cleanup } = await fetchContent(item.url, item.subpath);
  try {
    await replaceInstalledContent(contentPath, item.destDir);
  } finally {
    await cleanup();
  }
  registerSelections(path.join(installDir, SELECT_DEF_RELATIVE_PATH), [item]);
}

// Installs every item in a normalized plan. Each item is attempted
// independently and in order: one item's download/extract/install failure
// does not stop, skip, or roll back any other item -- MUGEN-5's per-item
// contract explicitly does not require global rollback on a transport-
// stage failure, only validation errors (already fail-fast in
// src/config.js, before this function is ever called) get a "nothing
// installed at all" guarantee. Returns one { id, error } entry per failed
// item; an empty array means every item installed and registered.
async function installPlan(plan) {
  const failures = [];
  for (const item of plan.items) {
    try {
      await installItem(plan.installDir, item);
    } catch (error) {
      failures.push({ id: item.id, error });
    }
  }
  return failures;
}

module.exports = { installPlan, installItem, replaceInstalledContent };
