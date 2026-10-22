import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HASHED_TERMS, canonical, hashedHits, sha256 } from '../lib/terms.mjs';

// Synthetic names: the real banned names are stored only as hashes.
const two = sha256('quartzwidget');
const three = sha256('bluemoontools');
const dotted = sha256('abclib');
const hashes = [two, three, dotted];

test('the banned names are stored as hashes only', () => {
  assert.ok(HASHED_TERMS.length >= 6);
  for (const h of HASHED_TERMS) assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(new Set(HASHED_TERMS).size, HASHED_TERMS.length);
});

test('canonical form folds case and drops separators', () => {
  assert.equal(canonical('Blue Moon-Tools'), 'bluemoontools');
  assert.equal(canonical('ABC.lib'), 'abclib');
});

test('matches single words, 2-3 word windows, camelCase and separators', () => {
  const found = (text) => hashedHits(text, hashes, new Map(), { stripTags: true }).map((h) => [h.text, h.term]);
  assert.deepEqual(found('see quartzwidget here'), [['quartzwidget', 0]]);
  assert.deepEqual(found('see QuartzWidget here'), [['QuartzWidget', 0]]);
  assert.deepEqual(found('see Quartz Widget here'), [['Quartz Widget', 0]]);
  assert.deepEqual(found('the quartz-widget tool'), [['quartz-widget', 0]]);
  assert.deepEqual(found('built with BlueMoonTools.'), [['BlueMoonTools', 1]]);
  assert.deepEqual(found('built with Blue Moon Tools.'), [['Blue Moon Tools', 1]]);
  assert.deepEqual(found('<b>blue</b> moon_tools'), [['blue</b> moon_tools', 1]]);
  assert.deepEqual(found('links ABC.lib'), [['ABC.lib', 2]]);
  assert.deepEqual(found('QUARTZWIDGET'), [['QUARTZWIDGET', 0]]);
  assert.deepEqual(hashedHits('<b>blue</b> moon_tools', hashes), []);
  assert.deepEqual(hashedHits('quartz widget', hashes, new Map(), { maxWords: 1 }), []);
});

test('does not match other text', () => {
  assert.deepEqual(hashedHits('quartz widgets, blue moon, abc library', hashes), []);
  assert.deepEqual(hashedHits('', hashes), []);
  assert.deepEqual(hashedHits('a plain sentence about mods', HASHED_TERMS), []);
});

test('the hash cache is reused across calls', () => {
  const cache = new Map();
  hashedHits('quartz widget', hashes, cache);
  const size = cache.size;
  hashedHits('quartz widget', hashes, cache);
  assert.equal(cache.size, size);
});
