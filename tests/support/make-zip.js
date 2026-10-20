'use strict';

const yazl = require('yazl');

// Build an in-memory zip buffer from a list of
// { name, content } (file) or { name, dir: true } (directory) entries,
// written verbatim -- including deliberately unsafe `name` values, which is
// exactly what the extraction-safety tests need (yazl itself does no path
// validation, it just writes whatever name it's given into the archive).
function buildZip(entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks = [];

    for (const entry of entries) {
      if (entry.dir) {
        zip.addEmptyDirectory(entry.name);
      } else {
        zip.addBuffer(Buffer.from(entry.content ?? ''), entry.name);
      }
    }

    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.outputStream.on('error', reject);
    zip.end();
  });
}

module.exports = { buildZip };
