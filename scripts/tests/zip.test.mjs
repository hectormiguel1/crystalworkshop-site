import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { entryFromZip, readFromZip } from '../lib/zip.mjs';

// Builds a ZIP from [name, contents, method] entries (CRCs are not checked by the reader).
function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text, method] of entries) {
    const raw = Buffer.from(text);
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const extra = Buffer.from('xx');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26);
    local.writeUInt16LE(extra.length, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt16LE(extra.length, 30);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, n, extra, body);
    central.push(dir, n, extra);
    offset += 30 + n.length + extra.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

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
