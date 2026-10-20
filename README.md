# MugPacks CLI

A minimal command-line tool for installing M.U.G.E.N. characters and stages listed in a configuration file into a specified M.U.G.E.N. directory.

## Initial scope

- Read and validate the configuration.
- Download the listed character and stage packages.
- Install their contents into the configured destination with clear results and errors.
- Provide tests and usage documentation.

This repository is initialized for development. Deployment and operation of a live M.U.G.E.N. setup are outside the tool-building scope.

## Status

- Config parsing and CLI validation (MUGEN-6): implemented. A bad config fails fast with a single `error: ...` line and exit code 1, before any download is attempted (`src/config.js`).
- Download + archive extraction (MUGEN-7): implemented, see `docs/download-extract.md` and `src/{download,extract,staging}.js`.
- Installing content and updating M.U.G.E.N.'s registration files (MUGEN-8): implemented, see `docs/install-registration.md` and `src/{install,registry}.js`. `mugpacks install [--config mugpacks.yaml]` downloads/extracts/installs every item into `installDir/{chars,stages}/<id>` and registers it in `installDir/data/select.def`, printing the normalized plan and exiting `0` only if every item installed; otherwise it exits non-zero and prints one `error: item "<id>": ...` line per failed item, without rolling back any item that already installed successfully.

The CLI/config/error contract is defined in Jira MUGEN-5 (comments 49028, 49071, 49088, 49094).

## Config schema (`mugpacks.yaml`)

```yaml
installDir: /abs/path/to/existing/mugen/install   # required; must already exist as a directory
items:
  - id: kfm                                        # required, unique; a single safe path segment
    type: char                                     # required: "char" | "stage"
    url: https://example.com/kfm.zip                # required, http(s) only
    subpath: kfm/                                   # required (may be ""); content root inside the archive
  - id: stage0
    type: stage
    url: https://example.com/stage0.zip
    subpath: ""
```

`char` items install to `installDir/chars/<id>`; `stage` items install to `installDir/stages/<id>`.

## Usage

```sh
npm install
npx mugpacks install                       # reads ./mugpacks.yaml
npx mugpacks install --config path/to/my-mugpacks.yaml
```

On success, the CLI prints the normalized install plan (JSON) to stdout and
exits `0`. On any failure it exits non-zero and writes one or more
`error: ...` lines to stderr instead:

- A config/validation problem (bad or missing field, duplicate id, `installDir`
  missing or not a directory, ...) prints a single `error: ...` line and exits
  before anything is downloaded or `installDir` is touched at all.
- A per-item failure past validation (download error, corrupt/unsafe archive,
  missing subpath, ...) prints one `error: item "<id>": ...` line per failed
  item; every other item in the same config still installs and registers
  normally (see "Known limitations" below).

`tests/acceptance/cli-acceptance.test.js` (`node --test tests/acceptance`) is
a runnable, fixture-driven demonstration of this contract end to end: it
copies `fixtures/mugen-root` to a throwaway directory, serves
`fixtures/archives/**` over a local HTTP server, and runs the real CLI
against `fixtures/config/*.yaml` for the happy path, every documented error,
repeat-install idempotency, and preserved pre-existing content.

## Known limitations

- Only **zip** archives are supported (matching the fixture set); no tar,
  7z, or rar.
- No global rollback: in a multi-item config, an item that fails to
  download/extract/install does not undo any other item that already
  installed and registered successfully in the same run (MUGEN-5's agreed
  per-item contract; see `docs/install-registration.md`).
- No symlink-based archive-traversal fixture is exercised (zip symlink
  entries are platform/tool-dependent to author reliably) -- only `../`
  path-traversal and absolute-path entries are covered. See `FIXTURES.md`.
- An item's content must contain exactly one top-level `.def` file (or, if
  several, one named `<id>.def`); otherwise that item's install fails with
  a clear error rather than guessing (`src/install-errors.js`).
- Build/test tool only: this repository does not deploy to a live
  M.U.G.E.N. installation, install the engine, or launch anything.

## Development

```sh
npm install
npm test
```
