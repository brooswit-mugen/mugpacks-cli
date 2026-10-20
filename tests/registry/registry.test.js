'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { registerSelections } = require('../../src/registry');

function tmpSelectDefPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mugpacks-registry-test-'));
  return path.join(dir, 'data', 'select.def');
}

test('adds one [Characters] line and one [ExtraStages] line without disturbing pre-existing content', () => {
  const selectDefPath = tmpSelectDefPath();
  fs.mkdirSync(path.dirname(selectDefPath), { recursive: true });
  fs.writeFileSync(
    selectDefPath,
    '; header comment\n[Characters]\npreexisting-char, preexisting-char/preexisting-char.def\n\n[ExtraStages]\n',
  );

  registerSelections(selectDefPath, [
    { id: 'fixture-fighter-a', type: 'char' },
    { id: 'fixture-stage-arena', type: 'stage' },
  ]);

  assert.equal(
    fs.readFileSync(selectDefPath, 'utf8'),
    '; header comment\n' +
      '[Characters]\n' +
      'preexisting-char, preexisting-char/preexisting-char.def\n' +
      'fixture-fighter-a, fixture-fighter-a/fixture-fighter-a.def\n' +
      '\n' +
      '[ExtraStages]\n' +
      'fixture-stage-arena, fixture-stage-arena/fixture-stage-arena.def\n',
  );
});

test('registering the same items twice adds no new lines the second time', () => {
  const selectDefPath = tmpSelectDefPath();
  fs.mkdirSync(path.dirname(selectDefPath), { recursive: true });
  fs.writeFileSync(selectDefPath, '[Characters]\n\n[ExtraStages]\n');

  const items = [{ id: 'kfm', type: 'char' }];
  registerSelections(selectDefPath, items);
  const afterFirst = fs.readFileSync(selectDefPath, 'utf8');

  registerSelections(selectDefPath, items);
  const afterSecond = fs.readFileSync(selectDefPath, 'utf8');

  assert.equal(afterSecond, afterFirst);
  assert.equal(afterFirst.match(/^kfm,/gm).length, 1);
});

test('creates data/select.def with the needed section when the file does not exist yet', () => {
  const selectDefPath = tmpSelectDefPath();

  registerSelections(selectDefPath, [{ id: 'kfm', type: 'char' }]);

  assert.equal(fs.readFileSync(selectDefPath, 'utf8'), '[Characters]\nkfm, kfm/kfm.def\n');
});
