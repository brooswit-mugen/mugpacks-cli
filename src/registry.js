'use strict';

const fs = require('node:fs');
const path = require('node:path');

// MUGEN-8: which select.def section a normalized plan item's registration
// line belongs in. The MUGEN-5 contract and MUGEN-9's fixtures both only
// specify "one line per item, in the right section, added idempotently" --
// the exact per-field select.def syntax beyond that isn't part of any
// agreed contract, so this mirrors the one concrete example available
// (fixtures/mugen-root/data/select.def's pre-existing
// "preexisting-char, preexisting-char/preexisting-char.def" line) for both
// section kinds.
const SECTION_FOR_TYPE = Object.freeze({
  char: 'Characters',
  stage: 'ExtraStages',
});

function selectionLine(item) {
  return `${item.id}, ${item.id}/${item.id}.def`;
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

function readExistingOrEmpty(selectDefPath) {
  try {
    return fs.readFileSync(selectDefPath, 'utf8');
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

// Registers each of `items` (normalized plan items, see src/config.js) in
// installDir/data/select.def: exactly one [Characters] line per `char`
// item and one [ExtraStages] line per `stage` item, added without
// disturbing any other line already in the file. A no-op (file is not
// rewritten at all) when every item's line is already present, which is
// what makes running the same plan twice add no new lines.
function registerSelections(selectDefPath, items) {
  const original = readExistingOrEmpty(selectDefPath);
  const lines = splitLines(original);

  let next = lines;
  for (const item of items) {
    next = upsertSectionLine(next, SECTION_FOR_TYPE[item.type], selectionLine(item));
  }

  if (next === lines) {
    return;
  }

  fs.mkdirSync(path.dirname(selectDefPath), { recursive: true });
  fs.writeFileSync(selectDefPath, `${next.join('\n')}\n`);
}

module.exports = { registerSelections, selectionLine, SECTION_FOR_TYPE };
