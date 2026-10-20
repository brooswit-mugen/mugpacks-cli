'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { assertNoSymlinkAncestors } = require('./path-safety');
const { MissingDefFileError, AmbiguousDefFileError } = require('./install-errors');

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

// Resolves the single top-level `.def` file inside `destDir` -- the
// installed content's filename is not guaranteed to be `<id>.def` (an
// archive's content can be named anything), so this reads the actual
// installed directory rather than assuming filename == id.
async function resolveDefFile(id, destDir) {
  const entries = await fs.promises.readdir(destDir, { withFileTypes: true });
  const defFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.def'))
    .map((entry) => entry.name)
    .sort();

  if (defFiles.length === 0) {
    throw new MissingDefFileError(id, destDir);
  }
  if (defFiles.length === 1) {
    return defFiles[0];
  }
  const preferred = `${id}.def`;
  if (defFiles.includes(preferred)) {
    return preferred;
  }
  throw new AmbiguousDefFileError(id, destDir, defFiles);
}

async function characterSelectionLine(item) {
  const defFile = await resolveDefFile(item.id, item.destDir);
  return `${item.id}/${defFile}, ${DEFAULT_CHARACTER_STAGE}`;
}

async function stageSelectionLine(item) {
  const defFile = await resolveDefFile(item.id, item.destDir);
  return `stages/${item.id}/${defFile}`;
}

async function selectionLineFor(item) {
  return item.type === 'char' ? characterSelectionLine(item) : stageSelectionLine(item);
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

// Inserts `line` as the last entry of the named section -- directly after
// the section's last non-blank line, so an existing trailing blank-line
// separator before the next section is preserved rather than pushed
// further down. Creates the section at the end of the file if it doesn't
// exist yet. Returns `lines` unchanged (same reference) if `line` is
// already present anywhere in the section, which is what makes repeat
// installs idempotent.
function upsertSectionLine(lines, header, line) {
  const range = findSectionRange(lines, header);

  if (range === null) {
    const needsBlankSeparator = lines.length > 0 && lines[lines.length - 1].trim() !== '';
    return [...lines, ...(needsBlankSeparator ? [''] : []), `[${header}]`, line];
  }

  const { startIndex, endIndex } = range;
  const body = lines.slice(startIndex + 1, endIndex);
  if (body.some((existing) => existing.trim() === line.trim())) {
    return lines;
  }

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
// installed -- see src/install.js) in installDir/data/select.def: exactly
// one [Characters] line per `char` item and one [ExtraStages] line per
// `stage` item, added without disturbing any other line already in the
// file. A no-op (file is not rewritten at all) when every item's line is
// already present, which is what makes running the same plan twice add no
// new lines. Rejects via UnsafeDestinationError if any component on the
// way to select.def -- including select.def itself -- is a symlink, so
// this can never write through a link to a file outside installDir.
async function registerSelections(installDir, items) {
  const selectDefPath = path.join(installDir, SELECT_DEF_RELATIVE_PATH);
  await assertNoSymlinkAncestors(installDir, selectDefPath);

  const original = await readExistingOrEmpty(selectDefPath);
  const lines = splitLines(original);

  let next = lines;
  for (const item of items) {
    const line = await selectionLineFor(item);
    next = upsertSectionLine(next, SECTION_FOR_TYPE[item.type], line);
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
  SECTION_FOR_TYPE,
  SELECT_DEF_RELATIVE_PATH,
  DEFAULT_CHARACTER_STAGE,
};
