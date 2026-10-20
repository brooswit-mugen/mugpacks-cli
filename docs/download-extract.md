# Download and extraction (MUGEN-7)

Implements the download/extract half of the `mugpacks install` pipeline
defined in MUGEN-5 (comments 49028, 49071, 49088, 49094). This module does
not parse config or install content into `installDir` -- see MUGEN-6 (config)
and MUGEN-8 (install/registration) for those.

## Modules

- `src/download.js` -- `downloadToFile(url, destPath)`: streams an http(s)
  URL to a file. Only `http:`/`https:` are followed (redirects included, up
  to 5 hops); anything else, a non-2xx response, or a network error throws
  `DownloadError` with the failing url and a short reason.
- `src/extract.js`:
  - `extractArchive(archivePath, destDir)`: extracts every entry of a zip
    archive into `destDir`.
  - `resolveSubpath(stagingDir, subpath)`: resolves a config item's
    `subpath` (`""` for the archive root, or a relative path) against an
    already-extracted staging directory.
- `src/staging.js` -- `fetchContent(url, subpath)`: the combined operation
  one config item needs -- download, extract, resolve subpath -- returning
  `{ contentPath, cleanup }` for the caller to copy `contentPath` into
  `installDir/{chars,stages}/<id>` and then `cleanup()` the staging
  directory.

## Supported archive layout

Only **zip** archives are supported (matching the MUGEN-9 fixture set).
Entries may be files or directories (directory entries end in `/`); no
other container format (tar, 7z, rar, ...) is handled, and an archive that
isn't a valid zip (e.g. truncated) fails as a `CorruptArchiveError`, not a
crash or stack trace.

## Safety model

Every stage of a fetch writes only inside a fresh, per-item staging
directory (`fs.mkdtemp`-created, never a fixed shared path) and never
touches `installDir`:

- **No traversal, absolute paths, or drive/UNC prefixes.** Each zip entry's
  own path is validated before anything is written: no `..` component, no
  leading `/`, no Windows drive prefix (`C:...`), no UNC prefix, no
  backslashes. This re-validates every entry independently of whatever
  `subpath` validation MUGEN-6 already ran -- an archive is untrusted input
  in its own right, regardless of what the config said about it.
- **Containment is re-derived from the real path, not just the string.**
  After the entry name passes the string checks, the join against the
  destination directory is resolved and checked again to still be
  underneath it, so the string validation is a fast-fail and not the only
  guard (same principle the MUGEN-5 contract states for `subpath`).
- **First unsafe or corrupt entry aborts the whole archive.** Nothing from
  an archive with a bad entry is left behind: extraction fails before, or
  instead of, writing any file that depended on that entry.
- **Never executed.** Extracted files are written with plain,
  non-executable permissions; nothing extracted is ever run, regardless of
  any executable bit recorded in the archive.
- **No symlinks, and no following them.** Any entry whose recorded Unix
  mode marks it as a symlink (or any other non-regular-file,
  non-directory special type -- FIFOs, devices, sockets) is rejected
  outright; nothing extracted from this module is ever a symlink.
  Independently of that, every path component from the staging directory
  down to each entry's destination is `lstat`-checked before it is
  written through -- so even a symlink that reached the staging directory
  by some other means (not just one declared by the archive itself) is
  never followed. Files are opened with exclusive (`wx`) creation, so
  writing never silently follows or replaces an existing path either.
- **Extracted bytes are checked against the entry's declared CRC32.**
  `yauzl` (the zip parser used here) validates each entry's declared byte
  *count* but, by its own documentation, never checks the declared CRC32
  against what it actually decompresses. This module computes the CRC32 of
  each entry's bytes as they stream to disk and fails the archive with
  `CorruptArchiveError` if it doesn't match, so a same-length payload
  corrupted in transit or on disk cannot be silently accepted as a
  successful extraction; the partial output file for that entry is removed.
- **Preserves existing content.** Because every write stays inside the
  throwaway staging directory until the caller explicitly copies
  `contentPath` out, a failed or unsafe fetch can never partially mutate
  `installDir` -- existing files there are left untouched by this module by
  construction, not by a separate check.
