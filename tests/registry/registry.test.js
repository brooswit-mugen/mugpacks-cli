'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { registerSelections, resolveDefFile } = require('../../src/registry');
const { UnsafeDestinationError } = require('../../src/path-safety');
const { MissingDefFileError, AmbiguousDefFileError, UnsafeDefFileNameError } = require('../../src/install-errors');

function makeInstallDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-registry-test-'));
}

function writeSelectDef(installDir, text) {
  const selectDefPath = path.join(installDir, 'data', 'select.def');
  fs.mkdirSync(path.dirname(selectDefPath), { recursive: true });
  fs.writeFileSync(selectDefPath, text);
  return selectDefPath;
}

function registeredItem(installDir, { id, type, defFile }) {
  return { id, type, defFile: defFile ?? `${id}.def` };
}

function contentDirFor(installDir, { id, type }) {
  const subdir = type === 'char' ? 'chars' : 'stages';
  return path.join(installDir, subdir, id);
}

function writeContentDir(installDir, { id, type, defFileName }) {
  const dir = contentDirFor(installDir, { id, type });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, defFileName ?? `${id}.def`), '[Info]\n');
  return dir;
}

test('adds one [Characters] line and one [ExtraStages] line without disturbing pre-existing content', async () => {
  const installDir = makeInstallDir();
  const selectDefPath = writeSelectDef(
    installDir,
    '; header comment\n[Characters]\npreexisting-char, preexisting-char/preexisting-char.def\n\n[ExtraStages]\n',
  );
  const items = [
    registeredItem(installDir, { id: 'fixture-fighter-a', type: 'char' }),
    registeredItem(installDir, { id: 'fixture-stage-arena', type: 'stage' }),
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
  const items = [registeredItem(installDir, { id: 'kfm', type: 'char' })];

  await registerSelections(installDir, items);
  const afterFirst = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');

  await registerSelections(installDir, items);
  const afterSecond = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');

  assert.equal(afterSecond, afterFirst);
  assert.equal(afterFirst.match(/^kfm\/kfm\.def,/gm).length, 1);
});

test('creates data/select.def with the needed section when the file does not exist yet', async () => {
  const installDir = makeInstallDir();
  const items = [registeredItem(installDir, { id: 'kfm', type: 'char' })];

  await registerSelections(installDir, items);

  assert.equal(
    fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8'),
    '[Characters]\nkfm/kfm.def, random\n',
  );
});

test('a reinstalled item whose def filename changed replaces its own row instead of duplicating it', async () => {
  const installDir = makeInstallDir();
  writeSelectDef(installDir, '[Characters]\nunrelated-char/unrelated-char.def, random\n\n[ExtraStages]\n');

  await registerSelections(installDir, [registeredItem(installDir, { id: 'fighter', type: 'char', defFile: 'a.def' })]);
  await registerSelections(installDir, [registeredItem(installDir, { id: 'fighter', type: 'char', defFile: 'b.def' })]);

  const selectDef = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
  assert.equal(selectDef.match(/^fighter\//gm).length, 1, 'only the current row for this item should remain');
  assert.match(selectDef, /^fighter\/b\.def, random$/m);
  assert.doesNotMatch(selectDef, /^fighter\/a\.def,/m);
  assert.match(selectDef, /^unrelated-char\/unrelated-char\.def, random$/m, 'an unrelated row must survive untouched');
});

test('a reinstalled stage whose def filename changed replaces its own row instead of duplicating it', async () => {
  const installDir = makeInstallDir();

  await registerSelections(installDir, [registeredItem(installDir, { id: 'arena', type: 'stage', defFile: 'old.def' })]);
  await registerSelections(installDir, [registeredItem(installDir, { id: 'arena', type: 'stage', defFile: 'new.def' })]);

  const selectDef = fs.readFileSync(path.join(installDir, 'data', 'select.def'), 'utf8');
  assert.equal(selectDef.match(/^stages\/arena\//gm).length, 1);
  assert.match(selectDef, /^stages\/arena\/new\.def$/m);
});

test('resolveDefFile resolves the actual installed .def filename rather than assuming it matches the item id', async () => {
  const installDir = makeInstallDir();
  const dir = writeContentDir(installDir, { id: 'kfm', type: 'char', defFileName: 'totally-different-name.def' });

  assert.equal(await resolveDefFile('kfm', dir), 'totally-different-name.def');
});

test('resolveDefFile rejects installed content with no .def file', async () => {
  const installDir = makeInstallDir();
  const dir = contentDirFor(installDir, { id: 'kfm', type: 'char' });
  fs.mkdirSync(dir, { recursive: true });

  await assert.rejects(
    () => resolveDefFile('kfm', dir),
    (err) => {
      assert.ok(err instanceof MissingDefFileError);
      return true;
    },
  );
});

test('resolveDefFile rejects installed content with multiple .def files and no <id>.def to prefer', async () => {
  const installDir = makeInstallDir();
  const dir = contentDirFor(installDir, { id: 'kfm', type: 'char' });
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.def'), '[Info]\n');
  fs.writeFileSync(path.join(dir, 'b.def'), '[Info]\n');

  await assert.rejects(
    () => resolveDefFile('kfm', dir),
    (err) => {
      assert.ok(err instanceof AmbiguousDefFileError);
      return true;
    },
  );
});

test('resolveDefFile rejects a .def filename select.def grammar cannot represent', async () => {
  const installDir = makeInstallDir();

  for (const unsafeName of ['bad;name.def', 'bad,name.def', 'badname.def']) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-registry-unsafe-'));
    fs.writeFileSync(path.join(dir, unsafeName), '[Info]\n');

    await assert.rejects(
      () => resolveDefFile('fighter', dir),
      (err) => {
        assert.ok(err instanceof UnsafeDefFileNameError);
        return true;
      },
      `expected "${unsafeName}" to be rejected`,
    );
  }
});

test('rejects writing through a symlinked data directory instead of overwriting its target', async () => {
  const installDir = makeInstallDir();
  const outsideTarget = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-registry-outside-'));
  fs.writeFileSync(path.join(outsideTarget, 'precious.txt'), 'do not touch');
  fs.symlinkSync(outsideTarget, path.join(installDir, 'data'), 'dir');

  const items = [registeredItem(installDir, { id: 'kfm', type: 'char' })];

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
