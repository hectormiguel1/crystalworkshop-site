import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { entryFromZip, readFromZip, zipEntries } from '../lib/zip.mjs';
import { zipOf } from './fixtures.mjs';

test('reads stored and deflated entries by path suffix', () => {
  const zip = zipOf([
    ['pkg/', '', 0],
    ['pkg/README.txt', 'readme', 0],
    ['pkg/Crux/CRUX-MANIFEST.json', '{"files":{}}', 8],
  ]);
  assert.equal(entryFromZip(zip, 'Crux/CRUX-MANIFEST.json').toString('utf8'), '{"files":{}}');
  assert.equal(entryFromZip(zip, 'README.txt').toString('utf8'), 'readme');
  assert.equal(entryFromZip(zip, 'missing.json'), null);
  const dir = mkdtempSync(path.join(import.meta.dirname, '.zip-test-'));
  try {
    writeFileSync(path.join(dir, 'p.zip'), zip);
    assert.equal(readFromZip(path.join(dir, 'p.zip'), 'README.txt').toString('utf8'), 'readme');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses archives it cannot read', () => {
  assert.throws(() => entryFromZip(Buffer.alloc(30), 'a'), /no end record/);
  const zip = zipOf([['a', 'x', 12]]);
  assert.throws(() => entryFromZip(zip, 'a'), /unsupported ZIP compression method 12/);
  const damaged = Buffer.from(zip);
  damaged.writeUInt32LE(0, damaged.readUInt32LE(damaged.length - 6));
  assert.throws(() => entryFromZip(damaged, 'a'), /damaged ZIP directory/);
});

test('lists file entries with their sizes and reads them lazily', () => {
  const zip = zipOf([
    ['pkg/', '', 0],
    ['pkg/app.exe', 'MZ app', 8],
    ['pkg/Crux/version.dll', 'MZ loader', 0],
  ]);
  const list = zipEntries(zip);
  assert.deepEqual(list.map((e) => [e.name, e.size]), [['pkg/app.exe', 6], ['pkg/Crux/version.dll', 9]]);
  assert.equal(list[0].read().toString('utf8'), 'MZ app');
  assert.equal(list[1].read().toString('utf8'), 'MZ loader');
});
