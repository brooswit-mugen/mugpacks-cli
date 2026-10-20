'use strict';

// Config/command/error contract: Jira MUGEN-5 comments 49028, 49071, 49088,
// 49094.

// `item.type` -> the subdirectory under `installDir` that type installs
// into (`installDir/chars/<id>` or `installDir/stages/<id>`).
const TYPE_INSTALL_SUBDIR = Object.freeze({
  char: 'chars',
  stage: 'stages',
});

const ITEM_TYPES = Object.freeze(Object.keys(TYPE_INSTALL_SUBDIR));

// `item.id` is used verbatim as an on-disk folder name, so it must be a
// single safe path segment: non-empty, no `/` or `\`, and cannot start
// with `.` (which also rules out `.` and `..` outright).
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const URL_SCHEMES = Object.freeze(['http:', 'https:']);

const DEFAULT_CONFIG_FILENAME = 'mugpacks.yaml';

module.exports = {
  TYPE_INSTALL_SUBDIR,
  ITEM_TYPES,
  ID_PATTERN,
  URL_SCHEMES,
  DEFAULT_CONFIG_FILENAME,
};
