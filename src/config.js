'use strict';

const fs = require('fs');
const path = require('path');
const YAML = require('yaml');

const { ConfigError } = require('./errors');
const { TYPE_INSTALL_SUBDIR, ITEM_TYPES, ID_PATTERN, URL_SCHEMES } = require('./constants');

function readConfigFile(configPath) {
  let raw;
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (err) {
    throw new ConfigError(`cannot read config ${configPath}: ${err.code === 'ENOENT' ? 'no such file' : err.message}`);
  }

  let parsed;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    throw new ConfigError(`cannot read config ${configPath}: ${err.message}`);
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`cannot read config ${configPath}: config must be a YAML mapping`);
  }

  return parsed;
}

function isValidHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  let parsedUrl;
  try {
    parsedUrl = new URL(value);
  } catch {
    return false;
  }
  return URL_SCHEMES.includes(parsedUrl.protocol);
}

function validateInstallDir(installDir) {
  if (typeof installDir !== 'string' || installDir.length === 0) {
    throw new ConfigError('config is missing required field "installDir"');
  }
  if (!path.isAbsolute(installDir)) {
    throw new ConfigError(`installDir "${installDir}" must be an absolute path`);
  }

  let stat;
  try {
    stat = fs.statSync(installDir);
  } catch {
    throw new ConfigError(`installDir "${installDir}" does not exist or is not a directory`);
  }
  if (!stat.isDirectory()) {
    throw new ConfigError(`installDir "${installDir}" does not exist or is not a directory`);
  }
}

function validateId(rawId, index) {
  if (typeof rawId !== 'string' || rawId.length === 0) {
    throw new ConfigError(`items[${index}] is missing required field "id"`);
  }
  if (!ID_PATTERN.test(rawId)) {
    throw new ConfigError(`item "${rawId}": id is not a valid path segment (expected [A-Za-z0-9][A-Za-z0-9._-]*, no separators, cannot start with ".")`);
  }
  return rawId;
}

function validateType(id, rawType) {
  if (typeof rawType !== 'string' || rawType.length === 0) {
    throw new ConfigError(`item "${id}": type is required`);
  }
  if (!ITEM_TYPES.includes(rawType)) {
    throw new ConfigError(`item "${id}": type must be "char" or "stage", got "${rawType}"`);
  }
  return rawType;
}

function validateUrl(id, rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    throw new ConfigError(`item "${id}": url is required`);
  }
  if (!isValidHttpUrl(rawUrl)) {
    throw new ConfigError(`item "${id}": url is not a valid http(s) URL`);
  }
  return rawUrl;
}

const UNSAFE_SUBPATH_MESSAGE =
  'subpath is not a safe relative path (no absolute paths, drive/UNC prefixes, backslashes, or ".." components)';

// Validation order per the final MUGEN-5 correction (comment 49094):
//   1. Archive-root check on the UNALTERED input: exactly "" selects the
//      archive root. This is checked before anything else specifically so
//      normalization can never produce the root sentinel from unsafe input.
//   2. Reject absolute/drive/UNC/backslash forms on the nonempty input,
//      before any stripping.
//   3. Strip at most one trailing "/" from a nonempty value that passed #2.
//   4. Split on "/" and reject any ".." or empty component (catches
//      internal "//" and any remaining trailing-slash edge case).
// Extraction (MUGEN-7) must still independently enforce containment; this
// is a fast-fail, not the only guard.
function validateSubpath(id, rawSubpath) {
  if (typeof rawSubpath !== 'string') {
    throw new ConfigError(`item "${id}": subpath is required`);
  }

  if (rawSubpath === '') {
    return '';
  }

  const isAbsolutePosix = rawSubpath.startsWith('/');
  const isDriveLetter = /^[A-Za-z]:/.test(rawSubpath);
  const isUnc = rawSubpath.startsWith('\\\\') || rawSubpath.startsWith('//');
  const hasBackslash = rawSubpath.includes('\\');
  if (isAbsolutePosix || isDriveLetter || isUnc || hasBackslash) {
    throw new ConfigError(`item "${id}": ${UNSAFE_SUBPATH_MESSAGE}`);
  }

  const stripped = rawSubpath.endsWith('/') ? rawSubpath.slice(0, -1) : rawSubpath;

  const components = stripped.split('/');
  const hasUnsafeComponent = components.some((component) => component === '..' || component === '');
  if (hasUnsafeComponent) {
    throw new ConfigError(`item "${id}": ${UNSAFE_SUBPATH_MESSAGE}`);
  }

  return stripped;
}

function normalizeItem(rawItem, index, seenIds) {
  if (rawItem === null || typeof rawItem !== 'object' || Array.isArray(rawItem)) {
    throw new ConfigError(`items[${index}] must be a mapping`);
  }

  const id = validateId(rawItem.id, index);
  if (seenIds.has(id)) {
    throw new ConfigError(`duplicate item id "${id}"`);
  }
  seenIds.add(id);

  const type = validateType(id, rawItem.type);
  const url = validateUrl(id, rawItem.url);
  const subpath = validateSubpath(id, rawItem.subpath);

  return { id, type, url, subpath };
}

// Validates a parsed config and returns a normalized installation plan:
//   { installDir, items: [{ id, type, url, subpath, destDir }] }
// `destDir` is the absolute on-disk destination MUGEN-7/8 will install
// into; this ticket only computes and validates it.
function normalizeConfig(parsed) {
  validateInstallDir(parsed.installDir);
  const { installDir } = parsed;

  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new ConfigError('config is missing required field "items" (must be a non-empty array)');
  }

  const seenIds = new Set();
  const items = parsed.items.map((rawItem, index) => {
    const item = normalizeItem(rawItem, index, seenIds);
    return {
      ...item,
      destDir: path.join(installDir, TYPE_INSTALL_SUBDIR[item.type], item.id),
    };
  });

  return { installDir, items };
}

function loadConfig(configPath) {
  const parsed = readConfigFile(configPath);
  return normalizeConfig(parsed);
}

module.exports = {
  loadConfig,
  normalizeConfig,
  validateInstallDir,
  validateId,
  validateType,
  validateUrl,
  validateSubpath,
};
