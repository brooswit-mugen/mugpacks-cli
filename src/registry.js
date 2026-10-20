'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertNoSymlinkAncestors } = require('./path-safety');
const { MissingDefFileError, AmbiguousDefFileError, UnsafeDefFileNameError } = require('./install-errors');

// MUGEN-8: how a normalized plan item (see src/config.js) is registered in
// installDir/data/select.def, per the real engine syntax documented in
// select.def's own distributed [Characters]/[ExtraStages] comments (e.g.
// https://raw.githubusercontent.com/fanyer/mugen/master/data/select.def):
//   [Characters]  "<chars-relative-path-to-def>, <stagefilename-or-random>"
//   [ExtraStages] "<installdir-relative-path-to-def>" (no name field at all)
// Note fixtures/mugen-root/data/select.def's pre-existing
// "preexisting-char, preexisting-char/preexisting-char.def" line does NOT
// follow this -- its second field is a char-relative def path, not a
// stage, which the real engine would read as (and fail to find) a stage
// def named that. That pre-existing line is left untouched (MUGEN-8 must
// preserve whatever was already there byte-for-byte), but new lines this
// module adds follow the real engine syntax above, not that pre-existing
// typo.
const SECTION_FOR_TYPE = Object.freeze({
  char: 'Characters',
  stage: 'ExtraStages',
});

const SELECT_DEF_RELATIVE_PATH = path.join('data', 'select.def');

// No specific per-item stage assignment is part of this CLI's config
// contract, so every installed character gets a random stage on select,
// which the engine's own select.def syntax explicitly supports as a
// stagefilename value.
const DEFAULT_CHARACTER_STAGE = 'random';

// select.def's own grammar reserves "," as the field separator and ";" as
// the comment-start character, and no control character has a sane
// meaning in it either. An extracted archive is free to name its .def
// file anything, so a name containing any of these must be rejected
// before it is ever interpolated into a line -- a semicolon would turn
// the rest of that line into a comment (install reports success while
// select.def silently points nowhere), and a comma or newline would
// split into the wrong number of fields or lines.
const UNSAFE_DEF_FILENAME_PATTERN = /[,;\x00-\x1f\x7f]/;

function assertSafeDefFileName(id, defFile) {
  if (UNSAFE_DEF_FILENAME_PATTERN.test(defFile)) {
    throw new UnsafeDefFileNameError(id, defFile);
  }
}

// Resolves the single top-level `.def` file inside `contentDir` -- the
// installed content's filename is not guaranteed to be `<id>.def` (an
// archive's content can be named anything), so this reads the actual
// staged/installed directory rather than assuming filename == id. Also
// validates the resolved name against select.def's grammar (see
// UNSAFE_DEF_FILENAME_PATTERN above) before returning it, so an
// unrepresentable name is caught here -- while `contentDir` is still the
// staged content, before src/install.js's caller ever replaces the
// previous install with it -- rather than surfacing only once it's
// already interpolated into select.def.
async function resolveDefFile(id, contentDir) {
  const entries = await fs.promises.readdir(contentDir, { withFileTypes: true });
  const defFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.def'))
    .map((entry) => entry.name)
    .sort();

  if (defFiles.length === 0) {
    throw new MissingDefFileError(id, contentDir);
  }

  let defFile;
  if (defFiles.length === 1) {
    defFile = defFiles[0];
  } else {
    const preferred = `${id}.def`;
    if (!defFiles.includes(preferred)) {
      throw new AmbiguousDefFileError(id, contentDir, defFiles);
    }
    defFile = preferred;
  }

  assertSafeDefFileName(id, defFile);
  return defFile;
}

// The select.def row prefix that uniquely belongs to this item: a
// previous row starting with this exact prefix (and no other row) is
// this item's own earlier registration, which a reinstall must replace
// rather than leave behind as a second, stale row. Safe to use as a
// prefix match because `id` can never contain "/" (see src/config.js's
// ID_PATTERN), so two distinct ids can never share this prefix.
function ownerPrefixFor(item) {
  return item.type === 'char' ? `${item.id}/` : `stages/${item.id}/`;
}

function characterSelectionLine(item, defFile) {
  return `${item.id}/${defFile}, ${DEFAULT_CHARACTER_STAGE}`;
}

function stageSelectionLine(item, defFile) {
  return `stages/${item.id}/${defFile}`;
}

function selectionLineFor(item, defFile) {
  return item.type === 'char' ? characterSelectionLine(item, defFile) : stageSelectionLine(item, defFile);
}

function isSectionHeader(line, name) {
  return line.trim().toLowerCase() === `[${name}]`.toLowerCase();
}

function isAnySectionHeader(line) {
  return /^\[.+\]$/.test(line.trim());
}

function findSectionRange(lines, header) {
  const startIndex = lines.findIndex((line) => isSectionHeader(line, header));
  if (startIndex === -1) {
    return null;
  }
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    if (isAnySectionHeader(lines[i])) {
      endIndex = i;
      break;
    }
  }
  return { startIndex, endIndex };
}

// Removes any existing row in the named section that starts with
// `ownerPrefix` -- i.e. a previous registration of the same item, under
// its old def filename -- leaving every other row (other items, and any
// hand-added/unrelated row) untouched. Returns `lines` unchanged (same
// reference) if nothing matched.
function removeOwnerRow(lines, header, ownerPrefix) {
  const range = findSectionRange(lines, header);
  if (range === null) {
    return lines;
  }
  const { startIndex, endIndex } = range;
  const body = lines.slice(startIndex + 1, endIndex);
  const filteredBody = body.filter((existing) => !existing.trim().startsWith(ownerPrefix));
  if (filteredBody.length === body.length) {
    return lines;
  }
  return [...lines.slice(0, startIndex + 1), ...filteredBody, ...lines.slice(endIndex)];
}

// Inserts `line` as the last entry of the named section -- directly after
// the section's last non-blank line, so an existing trailing blank-line
// separator before the next section is preserved rather than pushed
// further down. Creates the section at the end of the file if it doesn't
// exist yet.
function insertAtEndOfSection(lines, header, line) {
  const range = findSectionRange(lines, header);

  if (range === null) {
    const needsBlankSeparator = lines.length > 0 && lines[lines.length - 1].trim() !== '';
    return [...lines, ...(needsBlankSeparator ? [''] : []), `[${header}]`, line];
  }

  const { startIndex, endIndex } = range;
  let insertAt = endIndex;
  for (let i = endIndex - 1; i > startIndex; i -= 1) {
    if (lines[i].trim() !== '') {
      insertAt = i + 1;
      break;
    }
    insertAt = startIndex + 1;
  }

  return [...lines.slice(0, insertAt), line, ...lines.slice(insertAt)];
}

// Registers `line` (this item's row) as the last entry of the named
// section. Returns `lines` unchanged (same reference) if `line` is
// already present exactly as-is anywhere in the section -- the fast path
// that makes a pure repeat install a complete no-op. Otherwise, first
// removes this item's own previous row (if its def filename changed
// since the last install -- see removeOwnerRow), then inserts the new
// row, so a changed row replaces its old one instead of leaving a stale
// duplicate behind; rows belonging to any other item, or hand-added to
// the file, are never touched.
function upsertSectionLine(lines, header, line, ownerPrefix) {
  const range = findSectionRange(lines, header);
  if (range !== null) {
    const body = lines.slice(range.startIndex + 1, range.endIndex);
    if (body.some((existing) => existing.trim() === line.trim())) {
      return lines;
    }
  }

  const withoutStaleOwnRow = removeOwnerRow(lines, header, ownerPrefix);
  return insertAtEndOfSection(withoutStaleOwnRow, header, line);
}

async function readExistingOrEmpty(selectDefPath) {
  try {
    return await fs.promises.readFile(selectDefPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return '';
    }
    throw err;
  }
}

function splitLines(text) {
  if (text === '') {
    return [];
  }
  return text.endsWith('\n') ? text.slice(0, -1).split('\n') : text.split('\n');
}

// Registers each of `items` (normalized plan items that have already been
// installed -- see src/install.js -- each carrying the `defFile` resolved
// and validated by resolveDefFile) in installDir/data/select.def: exactly
// one [Characters] line per `char` item and one [ExtraStages] line per
// `stage` item, added without disturbing any other line already in the
// file. A no-op (file is not rewritten at all) when every item's line is
// already present, which is what makes running the same plan twice add no
// new lines; a reinstalled item whose def filename changed replaces its
// own previous row rather than leaving a stale duplicate (see
// upsertSectionLine/removeOwnerRow). Rejects via UnsafeDestinationError
// if any component on the way to select.def -- including select.def
// itself -- is a symlink, so this can never write through a link to a
// file outside installDir.
async function registerSelections(installDir, items) {
  const selectDefPath = path.join(installDir, SELECT_DEF_RELATIVE_PATH);
  await assertNoSymlinkAncestors(installDir, selectDefPath);

  const original = await readExistingOrEmpty(selectDefPath);
  const lines = splitLines(original);

  let next = lines;
  for (const item of items) {
    const line = selectionLineFor(item, item.defFile);
    next = upsertSectionLine(next, SECTION_FOR_TYPE[item.type], line, ownerPrefixFor(item));
  }

  if (next === lines) {
    return;
  }

  await fs.promises.mkdir(path.dirname(selectDefPath), { recursive: true });
  await fs.promises.writeFile(selectDefPath, `${next.join('\n')}\n`);
}

module.exports = {
  registerSelections,
  resolveDefFile,
  assertSafeDefFileName,
  SECTION_FOR_TYPE,
  SELECT_DEF_RELATIVE_PATH,
  DEFAULT_CHARACTER_STAGE,
};
