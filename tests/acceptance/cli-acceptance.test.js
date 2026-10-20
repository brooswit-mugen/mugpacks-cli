// CLI acceptance contract for the "mugpacks install" command (MUGEN-1/4),
// written against the config/command/error contract delivered in MUGEN-5
// comment 49028, using the fixtures in ../../fixtures.
//
// These are `test.todo` on purpose: no CLI exists yet (MUGEN-6/7/8 are not
// built). This file IS the acceptance contract MUGEN-6/7/8 build against and
// MUGEN-10 flips from todo to real assertions once the tool exists -- it is
// not a placeholder to delete, and a `todo` here is not a failing test.
//
// Expected harness, to be filled in by whoever wires this up (MUGEN-10):
//   1. Copy fixtures/mugen-root to a fresh temp dir for every test (never
//      run against the checked-in copy -- see fixtures/mugen-root/README.md).
//   2. Serve fixtures/archives/** over http(s) (e.g. a local static server)
//      so config fixtures' __FIXTURE_SERVER__ placeholder resolves, and
//      rewrite __INSTALL_DIR__ to the temp installDir from step 1.
//   3. Invoke the built CLI (`mugpacks install --config <rewritten config>`)
//      and assert on exit code, stdout/stderr, and the resulting
//      installDir contents.
//
// Run with: node --test tests/acceptance
'use strict';

const { test } = require('node:test');

test.todo('valid-two-chars-two-stages.yaml installs both chars under installDir/chars/<id> and both stages under installDir/stages/<id>, exit code 0');
test.todo('valid-two-chars-two-stages.yaml registers all 4 items by adding exactly one [Characters] line per char and one [ExtraStages] line per stage to data/select.def');
test.todo('install preserves every pre-existing file/entry in fixtures/mugen-root (preexisting-char dir, and the pre-existing select.def [Characters] line) byte-for-byte');

test.todo('invalid-missing-installdir.yaml fails fast with "error: cannot read config <path>: <reason>" or equivalent missing-field error, exit code != 0, and installDir is left untouched (no partial mutation)');
test.todo('invalid-installdir-not-a-directory.yaml fails with \'error: installDir "<path>" does not exist or is not a directory\', exit code != 0');
test.todo('invalid-duplicate-id.yaml fails with \'error: duplicate item id "fixture-fighter-a"\', exit code != 0, before any download starts');
test.todo('invalid-bad-type.yaml fails with \'error: item "fixture-fighter-a": type must be "char" or "stage", got "costume"\', exit code != 0');
test.todo('invalid-bad-url.yaml fails with \'error: item "fixture-fighter-a": url is not a valid http(s) URL\', exit code != 0');

test.todo('download-failure.yaml (url 404s) fails with \'error: item "fixture-fighter-a": download failed: <status/reason>\', exit code != 0, installDir left untouched');

test.todo('unsafe-archive-zip-slip.yaml is rejected before any file is written outside installDir -- assert the would-be escape path (e.g. a file above installDir named by the archive\'s "../../../" entry) does not exist anywhere on disk after the run, exit code != 0');
test.todo('unsafe-archive-absolute-path.yaml is rejected before any file is written to its absolute destination -- assert that path does not exist after the run, exit code != 0');
test.todo('missing-subpath.yaml fails with \'error: item "fixture-fighter-a": subpath "fixture-fighter-a/" not found in downloaded archive\', exit code != 0');
test.todo('corrupt-archive.yaml fails with a clear extraction/decompression error (not a stack trace), exit code != 0');

test.todo('a config combining one otherwise-valid item with one item that fails VALIDATION (e.g. a duplicate id, caught before any download starts) fails before any item is downloaded, extracted, or installed -- installDir is left completely untouched, matching MUGEN-5 comment49028\'s "fail fast, no partial mutation on validation errors" guarantee');

test.todo('multi-item config where one item fails at the download/transport stage (one valid char + one download-failure item, both past validation) exits non-zero and prints one error line naming the failed item id, per MUGEN-5 comment49028\'s per-item download/extract/install contract ("Exit 0 only if every item installed; otherwise non-zero with one error line per failed item"); this does not require rolling back the item that had already finished downloading/extracting/installing successfully -- global rollback-on-transport-failure atomicity is not part of the agreed contract and is out of scope here');

test.todo('running valid-two-chars-two-stages.yaml a second time against the same installDir succeeds, exits 0, and does not duplicate the [Characters]/[ExtraStages] registration lines (select.def gains no new lines on the repeat run)');
test.todo('running valid-two-chars-two-stages.yaml a second time re-installs/overwrites installDir/chars/<id> and installDir/stages/<id> content without leaving stale files from a prior differently-shaped version of the same id');
