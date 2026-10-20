# MugPacks CLI

A minimal command-line tool for installing M.U.G.E.N. characters and stages listed in a configuration file into a specified M.U.G.E.N. directory.

## Initial scope

- Read and validate the configuration.
- Download the listed character and stage packages.
- Install their contents into the configured destination with clear results and errors.
- Provide tests and usage documentation.

This repository is initialized for development. The CLI entrypoint/config
parsing (MUGEN-6) and install/registration (MUGEN-8) are not implemented
yet. Deployment and operation of a live M.U.G.E.N. setup are outside the
tool-building scope.

## Status

- Download + archive extraction (MUGEN-7): implemented, see
  `docs/download-extract.md` and `src/{download,extract,staging}.js`.

## Development

```
npm install
npm test
```
