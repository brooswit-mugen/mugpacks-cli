'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { registerSelections } = require('../../src/registry');
const { UnsafeDestinationError } = require('../../src/path-safety');
const { MissingDefFileError, AmbiguousDefFileError } = require('../../src/install-errors');

function makeInstallDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-registry-test-'));
}

function writeSelectDef(installDir, text) {
  const selectDefPath = path.join(installDir, 'data', 'select.def');
  fs.mkdirSync(path.dirname(selectDefPath), { recursive: true });
  fs.writeFileSync(selectDefPath, text);
  return selectDefPath;
}

function makeInstalledItem(installDir, { id, type, defFileName }) {
  const subdir = type === 'char' ? 'chars' : 'stages';
  const destDir = path.join(installDir, subdir, id);
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, defFileName ?? `${id}.def`), '[Info]\n');
  return { id, type, destDir };
}

test('adds one [Characters] line and one [ExtraStages] line without disturbing pre-existing content', async () => {
  const installDir = makeInstallDir();
  const selectDefPath = writeSelectDef(
    installDir,
    '; header comment\n[Characters]\npreexisting-char, preexisting-char/preexisting-char.def\n\n[ExtraStages]\n',
  );
  const items = [
    makeInstalledItem(installDir, { id: 'fixture-fighter-a', type: 'char' }),
    makeInstalledItem(installDir, { id: 'fixture-stage-arena', type: 'stage' }),
  ];

  await registerSelections(installDir, items);

  assert.equal(
    fs.readFileSync(selectDefPath, 'utf8'),
    '; header comment\n' +
      '[Characters]\n' +
      'preexisting-char, preexisting-char/preexisting-char.def\n' +
      'fixture-fighter-a/fixture-fighter-a.def, random\n' +
      '\n' +
      '[ExtraStages]\n' +
      'stages/fixture-stage-arena/fixture-stage-arena.def\n',
  );
});

test('registering the same items twice adds no new lines the second time', async () => {
  const installDir = makeInstallDir();
  writeSelectDef(installDir, '[Characters]\n\n[ExtraStages]\n');
  const items = [makeInstalledItem(installDir, { id: 'kfm', type: 'char' })];

  await registerSelections(installDir, items);
  const afterFirst = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');

  await registerSelections(installDir, items);
  const afterSecond = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');

  assert.equal(afterSecond, afterFirst);
  assert.equal(afterFirst.match(/^kfm\/kfm\.def,/gm).length, 1);
});

test('creates data/select.def with the needed section when the file does not exist yet', async () => {
  const installDir = makeInstallDir();
  const items = [makeInstalledItem(installDir, { id: 'kfm', type: 'char' })];

  await registerSelections(installDir, items);

  assert.equal(
    fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
    '[Characters]\nkfm/kfm.def, random\n',
  );
});

test('resolves the actual installed .def filename rather than assuming it matches the item id', async () => {
  const installDir = makeInstallDir();
  const items = [makeInstalledItem(installDir, { id: 'kfm', type: 'char', defFileName: 'totally-different-name.def' })];

  await registerSelections(installDir, items);

  assert.equal(
    fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
    '[Characters]\nkfm/totally-different-name.def, random\n',
  );
});

test('rejects installed content with no .def file', async () => {
  const installDir = makeInstallDir();
  const destDir = path.join(installDir, 'chars', 'kfm');
  fs.mkdirSync(destDir, { recursive: true });

  await assert.rejects(
    () => registerSelections(installDir, [{ id: 'kfm', type: 'char', destDir }]),
    (err) => {
      assert.ok(err instanceof MissingDefFileError);
      return true;
    },
  );
});

test('rejects installed content with multiple .def files and no <id>.def to prefer', async () => {
  const installDir = makeInstallDir();
  const destDir = path.join(installDir, 'chars', 'kfm');
  fs.mkdirSync(destDir, { recursive: true });
  fs.writeFileSync(path.join(destDir, 'a.def'), '[Info]\n');
  fs.writeFileSync(path.join(destDir, 'b.def'), '[Info]\n');

  await assert.rejects(
    () => registerSelections(installDir, [{ id: 'kfm', type: 'char', destDir }]),
    (err) => {
      assert.ok(err instanceof AmbiguousDefFileError);
      return true;
    },
  );
});

test('rejects writing through a symlinked data directory instead of overwriting its target', async () => {
  const installDir = makeInstallDir();
  const outsideTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-registry-outside-'));
  fs.writeFileSync(path.join(outsideTarget, 'precious.txt'), 'do not touch');
  fs.symlinkSync(outsideTarget, path.join(installDir, 'data'), 'dir');

  const items = [makeInstalledItem(installDir, { id: 'kfm', type: 'char' })];

  await assert.rejects(
    () => registerSelections(installDir, items),
    (err) => {
      assert.ok(err instanceof UnsafeDestinationError);
      return true;
    },
  );
  assert.equal(fs.existsSync(path.join(outsideTarget, 'select.def')), false);
  assert.equal(fs.readFileSync(path.join(outsideTarget, 'precious.txt'), 'utf8'), 'do not touch');
});
