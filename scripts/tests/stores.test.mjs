import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_STORES, appStores, modStores, storeLabel, storesText } from '../lib/stores.mjs';

test('a Steam-only mod gets the Steam badge', () => {
  assert.deepEqual(modStores(['FINAL FANTASY XIII, Steam version, on Windows or on Linux (Proton).', '**PulseDepot** (beta).']), [{ name: 'Steam' }]);
});

test('an experimental Microsoft Store line adds the experimental badge', () => {
  const req = '- FINAL FANTASY XIII-2, Steam version, on Windows or on Linux (Proton).\n- The Microsoft Store version is experimental and not tested yet.';
  assert.deepEqual(modStores(req), [{ name: 'Steam' }, { name: 'Microsoft Store', status: 'experimental' }]);
});

test('a supported Microsoft Store line adds the plain badge', () => {
  assert.deepEqual(modStores(['FINAL FANTASY XIII-2, Steam or Microsoft Store version.']), [{ name: 'Steam' }, { name: 'Microsoft Store' }]);
});

test('no store named falls back to Steam', () => {
  assert.deepEqual(modStores(''), [{ name: 'Steam' }]);
  assert.deepEqual(modStores(undefined), [{ name: 'Steam' }]);
});

test('apps: Steam plus an experimental Microsoft Store', () => {
  for (const id of ['crystalworkshop', 'pulsedepot', 'crux']) {
    const s = appStores(id);
    assert.equal(s.length, 2, id);
    assert.deepEqual(s[0], { name: 'Steam' });
    assert.equal(s[1].name, 'Microsoft Store');
    assert.equal(s[1].status, 'experimental');
  }
  assert.match(appStores('pulsedepot')[1].note, /cannot start the game/);
  assert.deepEqual(appStores('unknown'), []);
  appStores('crux')[1].note = 'changed';
  assert.equal(APP_STORES.crux[1].note, 'XIII-2 only', 'callers get copies');
});

test('text and labels', () => {
  const s = [{ name: 'Steam' }, { name: 'Microsoft Store', status: 'experimental', note: 'XIII-2 only' }];
  assert.equal(storesText(s), 'Steam, Microsoft Store (experimental)');
  assert.equal(storesText(undefined), '');
  assert.equal(storeLabel(s[0]), 'Steam: supported');
  assert.equal(storeLabel(s[1]), 'Microsoft Store: experimental, not tested yet (XIII-2 only)');
  assert.equal(storeLabel({ name: 'Microsoft Store', status: 'experimental' }), 'Microsoft Store: experimental, not tested yet');
  assert.equal(storeLabel({ name: 'Steam', note: 'n' }), 'Steam: supported (n)');
});
