'use strict';

// Thrown when a plan item's installed content has no top-level `.def`
// file to register in select.def.
class MissingDefFileError extends Error {
  constructor(id, destDir) {
    super(`item "${id}": no .def file found in installed content at ${destDir}`);
    this.name = 'MissingDefFileError';
    this.id = id;
    this.destDir = destDir;
  }
}

// Thrown when a plan item's installed content has more than one
// top-level `.def` file and none of them is named `<id>.def`, so which
// one is the item's primary definition can't be inferred.
class AmbiguousDefFileError extends Error {
  constructor(id, destDir, candidates) {
    super(`item "${id}": multiple .def files found in installed content at ${destDir} (${candidates.join(', ')}); none is named "${id}.def"`);
    this.name = 'AmbiguousDefFileError';
    this.id = id;
    this.destDir = destDir;
    this.candidates = candidates;
  }
}

module.exports = { MissingDefFileError, AmbiguousDefFileError };
