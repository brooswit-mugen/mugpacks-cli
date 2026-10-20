# Install and registration (MUGEN-8)

Implements the install/registration half of the `mugpacks install` pipeline
defined in MUGEN-5 (comments 49028, 49071, 49088, 49094), building on
MUGEN-6's normalized plan (`src/config.js`) and MUGEN-7's safe
download/extraction (`src/{download,extract,staging}.js`).

## Modules

- `src/install.js`:
  - `installItem(installDir, item)` -- fetches one normalized plan item's
    content (MUGEN-7), replaces `installDir/{chars,stages}/<id>` with it,
    and registers it in `installDir/data/select.def` (MUGEN-8). `installDir`
    is never touched until the fetch has fully succeeded.
  - `installPlan(plan)` -- installs every item in a normalized plan, one at
    a time. Each item is independent: one item's download/extract/install
    failure does not stop, skip, or roll back any other item. Returns
    `[{ id, error }, ...]` for the items that failed; an empty array means
    every item installed and registered.
- `src/registry.js` -- `registerSelections(installDir, items)`: adds
  exactly one `[Characters]` line per `char` item and one `[ExtraStages]`
  line per `stage` item to `installDir/data/select.def`, without
  disturbing any other line already there. Idempotent: registering the
  same items again is a no-op, which is what keeps a repeat
  `mugpacks install` from duplicating lines.
- `src/path-safety.js` -- `assertNoSymlinkAncestors(baseDir, targetPath)`:
  rejects a destructive write at `targetPath` if any component between
  `baseDir` and `targetPath` (inclusive) is a symlink, so neither
  `installDir/{chars,stages}/<id>` nor `installDir/data/select.def` can be
  redirected outside `installDir` by a symlink planted at any point along
  the way.

## Contract notes

- **Validation stays fail-fast and mutation-free.** A config/CLI validation
  error (MUGEN-6) is still caught before `installPlan` ever runs, so an
  invalid config leaves `installDir` completely untouched -- this is
  unrelated to, and stricter than, the per-item behavior below.
- **No global rollback on a transport-stage failure.** If one item in an
  otherwise-valid multi-item config fails to download, extract, or resolve
  its subpath, the CLI still installs and registers every other item that
  succeeds, then exits non-zero and prints one `error: item "<id>": ...`
  line per failed item. This matches MUGEN-5's per-item contract; a global
  rollback requirement was explicitly not part of that agreement.
- **A repeat install replaces, not merges.** Re-running the same config
  removes whatever was previously installed at `installDir/{chars,stages}/<id>`
  before copying the newly staged content in, so a repeat install never
  leaves stale files behind from an older, differently-shaped version of
  the same item.
- **`select.def` line format.** Follows the real engine syntax documented
  in the distributed `select.def`'s own comments (e.g.
  https://raw.githubusercontent.com/fanyer/mugen/master/data/select.def):
  a `[Characters]` line is `<id>/<def-file>, <stagefilename-or-"random">`
  (this CLI has no per-item stage assignment in its config contract, so it
  always uses `random`, which the engine's own docs call out as a valid
  value); an `[ExtraStages]` line is just the stage's path on its own,
  `stages/<id>/<def-file>`, with no name field at all. `<def-file>` is
  resolved by reading the actual installed directory for its one
  top-level `.def` file (`registry.js`'s `resolveDefFile`) rather than
  assumed to be `<id>.def` -- an installed archive's content is not
  guaranteed to name its def file after the config's `id`.
  `fixtures/mugen-root/data/select.def`'s pre-existing
  `preexisting-char, preexisting-char/preexisting-char.def` line predates
  this and does not follow it (its second field is a char-relative def
  path, not a stage); that line is pre-existing content and is preserved
  byte-for-byte, not a syntax this module imitates for new entries.
