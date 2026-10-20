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

## Development

```sh
npm install
npm test
```
