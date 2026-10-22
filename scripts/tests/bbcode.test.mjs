import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bbChangelog, bbList, withoutLinkSentences } from '../lib/bbcode.mjs';
import { sanitize } from '../lib/sanitize.mjs';

const page = (line) => `[size=5][b]Changelog[/b][/size]\n${line}\n\n[size=5][b]Report a problem[/b][/size]\nOpen an issue.`;

test('the changelog drops the sentence that links to the site', () => {
  const bb = page('[b]0.1.0-beta[/b]: first public release. Crux in two builds, Windows and Linux builds. Every release is on the [url=https://example.test/changelog/]changelog[/url].');
  assert.deepEqual(bbChangelog(bb), [{ version: '0.1.0-beta', text: 'first public release. Crux in two builds, Windows and Linux builds.' }]);
});

test('a changelog entry that is only a link sentence becomes empty', () => {
  assert.equal(withoutLinkSentences('See [url]https://example.test[/url].'), '');
  assert.equal(withoutLinkSentences('first public release.'), 'first public release.');
});

test('list items become Markdown without their guide links', () => {
  const bb = '[size=5][b]Features[/b][/size]\n[list]\n[*][b]Text (ZTR)[/b]: every locale, [i]tags[/i]. [url=https://example.test/ztr/]Guide[/url]\n[*][b]Crystarium (XIII)[/b]. [url=https://example.test/c/]Guide[/url]\n[/list]';
  assert.deepEqual(bbList(bb, 'Features'), ['**Text (ZTR)**: every locale, `tags`.', '**Crystarium (XIII)**.']);
  assert.deepEqual(bbList(bb, 'Known issues'), []);
});

test('no changelog section: no entries', () => {
  assert.deepEqual(bbChangelog('[size=5][b]Features[/b][/size]\n[list][/list]'), []);
});

test('the site drops the Nexus placeholder link from requirements', () => {
  const line = '**PulseDepot** (beta), the mod manager, from [its Nexus Mods page]({{PULSEDEPOT_NEXUS_URL}}). It also installs **Crux**.';
  assert.equal(sanitize(line), '**PulseDepot** (beta), the mod manager. It also installs **Crux**.');
});
