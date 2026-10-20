// Validates the MUGEN-9 fixture assets themselves (no CLI required). These
// run today, before MUGEN-6/7/8 exist, and guard against the fixtures
// silently rotting (e.g. a rebuilt archive losing its path-traversal entry).
//
// Run with: node --test tests/fixtures
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..', 'fixtures');

function zipEntries(zipPath) {
  const out = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  return out.trim().split('\n').filter(Boolean);
}

test('character def fixtures declare the required MUGEN sections', () => {
  for (const id of ['fixture-fighter-a', 'fixture-fighter-b']) {
    const defPath = path.join(ROOT, 'content', 'characters', id, `${id}.def`);
    const def = fs.readFileSync(defPath, 'utf8');
    assert.match(def, /\[Info\]/);
    assert.match(def, /\[Files\]/);
    for (const key of ['cmd', 'cns', 'sprite', 'anim', 'sound']) {
      assert.match(def, new RegExp(`^${key}\\s*=`, 'm'), `${id}.def missing ${key}=`);
    }
  }
});

test('stage def fixtures declare the required MUGEN sections', () => {
  for (const id of ['fixture-stage-dojo', 'fixture-stage-arena']) {
    const defPath = path.join(ROOT, 'content', 'stages', id, `${id}.def`);
    const def = fs.readFileSync(defPath, 'utf8');
    assert.match(def, /\[Info\]/);
    assert.match(def, /\[StageInfo\]/);
    assert.match(def, /\[BGdef\]/);
  }
});

test('valid character archives contain exactly their declared subpath root', () => {
  for (const id of ['fixture-fighter-a', 'fixture-fighter-b']) {
    const entries = zipEntries(path.join(ROOT, 'archives', 'characters', `${id}.zip`));
    assert.ok(entries.some((e) => e === `${id}/${id}.def`), `${id}.zip missing its own .def under ${id}/`);
    assert.ok(entries.every((e) => e.startsWith(`${id}/`)), `${id}.zip has an entry outside its declared subpath: ${entries}`);
  }
});

test('valid stage archives contain their def at the archive root (subpath "")', () => {
  for (const id of ['fixture-stage-dojo', 'fixture-stage-arena']) {
    const entries = zipEntries(path.join(ROOT, 'archives', 'stages', `${id}.zip`));
    assert.ok(entries.includes(`${id}.def`), `${id}.zip missing ${id}.def at its root`);
  }
});

test('zip-slip fixture archive actually contains a path-traversal entry', () => {
  const entries = zipEntries(path.join(ROOT, 'archives', 'malicious', 'zip-slip-traversal.zip'));
  assert.ok(entries.some((e) => e.includes('..')), 'fixture no longer exercises path traversal');
});

test('absolute-path fixture archive actually contains an absolute entry', () => {
  const entries = zipEntries(path.join(ROOT, 'archives', 'malicious', 'absolute-path.zip'));
  assert.ok(entries.some((e) => e.startsWith('/')), 'fixture no longer exercises an absolute path entry');
});

test('missing-subpath fixture archive does not contain the fixture-fighter-a/ subpath', () => {
  const entries = zipEntries(path.join(ROOT, 'archives', 'malicious', 'missing-subpath.zip'));
  assert.ok(!entries.some((e) => e.startsWith('fixture-fighter-a/')), 'fixture now contains the subpath it is supposed to lack');
});

test('corrupt-archive fixture is not a valid zip', () => {
  assert.throws(() => zipEntries(path.join(ROOT, 'archives', 'malicious', 'corrupt-archive.zip')));
});

test('mugen-root template has pre-existing content that install/registration must preserve', () => {
  const root = path.join(ROOT, 'mugen-root');
  assert.ok(fs.existsSync(path.join(root, 'chars', 'preexisting-char', 'preexisting-char.def')));
  const selectDef = fs.readFileSync(path.join(root, 'data', 'select.def'), 'utf8');
  assert.match(selectDef, /preexisting-char/);
  assert.match(selectDef, /\[Characters\]/);
  assert.match(selectDef, /\[ExtraStages\]/);
});

test('every config fixture under fixtures/config exists and is non-empty', () => {
  const dir = path.join(ROOT, 'config');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yaml'));
  assert.ok(files.length >= 10, 'expected the full set of config fixtures (valid + each invalid-config/error case)');
  for (const f of files) {
    assert.ok(fs.statSync(path.join(dir, f)).size > 0, `${f} is empty`);
  }
});
