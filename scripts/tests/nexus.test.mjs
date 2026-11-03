import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { zipEntries } from '../lib/zip.mjs';
import { canonical } from '../lib/terms.mjs';
import { nexusModFileIds, nexusVersions, outputLine } from '../nexus/io.mjs';
import { withVersion, runLedger } from '../nexus/ledger.mjs';
import { GATE, buildPlan, candidates, gate, idOf, runPlan, summaryMarkdown, validateLedger, validateMapping } from '../nexus/plan.mjs';
import { changelogOf, descriptionOf, readmeOf, runStage, stageItem, termHits } from '../nexus/stage.mjs';
import { makeZip } from '../nexus/zipwrite.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const CWS = Buffer.from('shard bytes');
const SHA = sha(CWS);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const URL_OK = 'https://example.test/r';

const clean = () => ({
  virustotal: { status: 'ok', url: URL_OK, stats: { malicious: 0, suspicious: 0, undetected: 60, harmless: 0, 'type-unsupported': 1 } },
  metadefender: { status: 'ok', url: URL_OK, stats: { detected: 0, total: 20 } },
  kaspersky: { status: 'ok', url: URL_OK, zone: 'Green' },
  hybridanalysis: { status: 'pending' },
});
const entry = (over = {}, tag = 'loot-your-way-v0.2.0') => ({
  id: `${tag}-a-cws`,
  name: 'a.cws',
  container: null,
  product: tag.replace(/-v.*/, ''),
  version: '0.2.0',
  release: tag,
  sha256: SHA,
  size: 11,
  scanned_at: '2026-11-01T00:00:00Z',
  scans: { ...clean(), ...over },
});
const doc = (...files) => ({ schema: 1, generated: '2026-11-01T00:00:00Z', scanners: {}, files });
const asset = (over = {}) => ({ name: 'a.cws', url: 'https://api.github.com/assets/1', state: 'uploaded', digest: `sha256:${SHA}`, ...over });
const rel = (tag, over = {}) => ({ tag_name: tag, draft: false, prerelease: false, published_at: '2026-11-01T00:00:00Z', assets: [asset()], ...over });
const map = (over = {}) => ({ 'loot-your-way': { mod_id: 5, file_id: 9, display_name: 'XIII — Loot Your Way', category: 'main', archive_old: false, game: 'FINAL FANTASY XIII (Steam)', ...over } });

test('idOf accepts v3 string ids and positive integers', () => {
  assert.equal(idOf(5), '5');
  assert.equal(idOf('abc-12_3'), 'abc-12_3');
  for (const bad of [0, -1, 1.5, '', 'a b', null, undefined, {}]) assert.equal(idOf(bad), null);
});

test('validateMapping accepts the shipped file and reports every kind of problem', () => {
  const real = JSON.parse(readFileSync(new URL('../../nexus/products.json', import.meta.url), 'utf8'));
  assert.deepEqual(validateMapping(real), []);
  assert.equal(Object.keys(real).length, 16);
  for (const retired of ['mod-settings', 'drop-changes', 'hard-mode', 'xiii2-ui-scale']) assert.ok(!(retired in real));
  assert.ok(Object.values(real).every((e) => e.category === 'main'));
  assert.deepEqual(validateMapping([]), ['mapping must be an object keyed by release slug']);
  assert.deepEqual(validateMapping(null), ['mapping must be an object keyed by release slug']);
  const bad = validateMapping({ a: 3, b: { mod_id: 0, file_id: 'x y', display_name: '', category: 'new', archive_old: 'no', kind: 'tool' } });
  assert.equal(bad.length, 7);
  assert.deepEqual(validateMapping({ a: { mod_id: 'AbC123', file_id: 2, display_name: 'A', category: 'optional', archive_old: true, kind: 'app' } }), []);
});

test('validateLedger and withVersion', () => {
  assert.deepEqual(validateLedger({}), []);
  assert.deepEqual(validateLedger({ a: ['1'] }), []);
  assert.equal(validateLedger([]).length, 1);
  assert.equal(validateLedger(null).length, 1);
  assert.deepEqual(validateLedger({ a: 'x', b: [1] }), ['a: must be a list of version strings', 'b: must be a list of version strings']);
  assert.equal(JSON.stringify(withVersion({ z: ['1'], a: ['1', '2'] }, 'm', '3')), '{"a":["1","2"],"m":["3"],"z":["1"]}');
  assert.deepEqual(withVersion({ a: ['1'] }, 'a', '1'), { a: ['1'] });
});

test('candidates: newest final release of each mapped slug only', () => {
  const releases = [
    rel('loot-your-way-v0.1.0', { published_at: '2026-10-01T00:00:00Z' }),
    rel('loot-your-way-v0.2.0'),
    rel('loot-your-way-v0.3.0', { draft: true, published_at: '2026-12-01T00:00:00Z' }),
    rel('loot-your-way-v0.4.0-beta', { prerelease: true, published_at: '2026-12-02T00:00:00Z' }),
    rel('loot-your-way-v0.5.0-test', { published_at: '2026-12-03T00:00:00Z' }),
    rel('loot-your-way-v0.6.0-test1', { published_at: '2026-12-04T00:00:00Z' }),
    rel('loot-your-way-v0.7.0-testing', { published_at: '2026-12-05T00:00:00Z' }),
    rel('unmapped-v1.0.0'),
    rel('not-a-tag'),
    { tag_name: undefined, published_at: undefined },
  ];
  const c = candidates(releases, map());
  assert.deepEqual(c.map((x) => [x.slug, x.version]), [['loot-your-way', '0.2.0']]);
});

test('gate: ready, waiting, blocked', () => {
  assert.deepEqual(GATE, ['virustotal', 'metadefender', 'kaspersky']);
  assert.equal(gate(entry()).state, 'ready');
  assert.deepEqual(gate(undefined), { state: 'waiting', reasons: ['not scanned yet'] });
  const pending = gate(entry({ virustotal: { status: 'pending' } }));
  assert.equal(pending.state, 'waiting');
  assert.match(pending.reasons[0], /VirusTotal: pending/);
  assert.match(gate(entry({ metadefender: undefined })).reasons[0], /MetaDefender: no result/);
  assert.equal(gate(entry({ kaspersky: { status: 'ok', zone: 'Grey' } })).state, 'waiting');
  const flagged = gate(entry({ kaspersky: { status: 'ok', zone: 'Red' }, metadefender: { status: 'pending' } }));
  assert.equal(flagged.state, 'blocked');
  assert.match(flagged.reasons[0], /Kaspersky: flagged/);
  // Hybrid Analysis is not part of the gate.
  assert.equal(gate(entry({ hybridanalysis: { status: 'ok', verdict: 'malicious' } })).state, 'ready');
});

test('gate: zero engines is not clean', () => {
  const zeroVt = gate(entry({ virustotal: { status: 'ok', stats: { malicious: 0, suspicious: 0, undetected: 0, harmless: 0, 'type-unsupported': 5 } } }));
  assert.equal(zeroVt.state, 'waiting');
  assert.match(zeroVt.reasons[0], /VirusTotal: no engines reported/);
  const zeroMd = gate(entry({ metadefender: { status: 'ok', stats: { detected: 0, total: 0 } } }));
  assert.match(zeroMd.reasons[0], /MetaDefender: no engines reported/);
});

test('buildPlan sorts candidates into items, waiting, blocked, skipped and done', () => {
  const one = map()['loot-your-way'];
  const m = {
    ...map(),
    'pain-your-way': { ...one, mod_id: null, file_id: null },
    'seventh-ark': one,
    'crystal-clear': one,
    'strike-a-pose': one,
    accessorize: one,
    'paradigm-tuning': one,
    crux: { ...one, kind: 'app' },
    'no-post-battle-heal': one,
    'honey-i-shrunk-the-hud': one,
    'pain-your-way-lr': one,
  };
  const releases = [
    rel('loot-your-way-v0.2.0'),
    rel('pain-your-way-v0.2.0'),
    rel('seventh-ark-v0.1.0'),
    rel('crystal-clear-v0.1.0'),
    rel('strike-a-pose-v0.1.0', { assets: [{ name: 'a.cws.sha256' }] }),
    rel('accessorize-v0.1.0', { assets: [asset({ digest: `sha256:${sha('other')}` })] }),
    rel('paradigm-tuning-v0.2.0', { assets: [asset({ digest: undefined })] }),
    rel('crux-v0.1.1'),
    rel('no-post-battle-heal-v0.2.0', { assets: [asset({ state: 'starter' })] }),
    rel('honey-i-shrunk-the-hud-v0.2.0'),
    rel('pain-your-way-lr-v0.2.0'),
  ];
  const scans = doc(
    entry({}, 'loot-your-way-v0.2.0'),
    entry({ virustotal: { status: 'pending' } }, 'seventh-ark-v0.1.0'),
    entry({ kaspersky: { status: 'ok', zone: 'Red' } }, 'crystal-clear-v0.1.0'),
    entry({}, 'accessorize-v0.1.0'),
    entry({}, 'paradigm-tuning-v0.2.0'),
    entry({}, 'honey-i-shrunk-the-hud-v0.2.0'),
    { ...entry({}, 'loot-your-way-v0.2.0'), id: 'inside', container: 'x.zip' },
    { ...entry({}, 'pain-your-way-lr-v0.2.0'), sha256: 'NOT-HEX' },
  );
  const ledger = { 'honey-i-shrunk-the-hud': ['0.2.0'], 'loot-your-way': ['0.1.0'] };
  const plan = buildPlan({ mapping: m, releases, scans, ledger });
  assert.deepEqual(plan.items.map((i) => i.slug).sort(), ['loot-your-way', 'paradigm-tuning']);
  const li = plan.items.find((i) => i.slug === 'loot-your-way');
  assert.deepEqual({ ...li }, { slug: 'loot-your-way', version: '0.2.0', tag: 'loot-your-way-v0.2.0', asset: 'a.cws', asset_url: 'https://api.github.com/assets/1', sha256: SHA, mod_id: '5', file_id: '9', display_name: 'XIII — Loot Your Way', category: 'main', archive_old: false, game: 'FINAL FANTASY XIII (Steam)', requires: '' });
  assert.deepEqual(plan.waiting.map((w) => w.slug).sort(), ['accessorize', 'pain-your-way-lr', 'seventh-ark']);
  assert.match(plan.waiting.find((w) => w.slug === 'accessorize').reason, /older file/);
  assert.deepEqual(plan.blocked.map((w) => w.slug), ['crystal-clear']);
  assert.deepEqual(plan.done.map((d) => d.slug), ['honey-i-shrunk-the-hud']);
  const skipped = Object.fromEntries(plan.skipped.map((s) => [s.slug, s.reason]));
  assert.deepEqual(skipped, {
    'pain-your-way': 'no Nexus IDs',
    'strike-a-pose': 'the release has no .cws file',
    crux: 'apps are not published by this workflow',
    'no-post-battle-heal': 'the release has no .cws file',
  });
  // A release that was never scanned waits; a product filter limits the plan.
  assert.equal(buildPlan({ mapping: map(), releases: [rel('loot-your-way-v0.2.0')], scans: null }).waiting.length, 1);
  assert.equal(buildPlan({ mapping: m, releases, scans, only: 'seventh-ark' }).waiting.length, 1);
  assert.equal(buildPlan({ mapping: m, releases, scans, only: 'seventh-ark' }).items.length, 0);
  assert.equal(buildPlan({ mapping: m, releases, scans, only: '' }).items.length, 3);
});

test('Nexus v3 reads: data.versions and data.mod_files', async () => {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/mod-files/9/')) return json({ data: { versions: [{ version: '0.1.0' }, { version: 0.2 }] } });
    if (url.includes('/mod-files/10/')) return json({ data: {} });
    if (url.includes('/mod-files/12/')) return json({ versions: [{ version: 'old-shape' }] });
    if (url.includes('/mods/5/files')) return json({ data: { mod_files: [{ id: '9', name: 'x' }, { id: 77 }] } });
    if (url.includes('/mods/6/files')) return json({ data: {} });
    return json({}, 503);
  };
  assert.deepEqual(await nexusVersions(f, 'KEY', 9), ['0.1.0', '0.2']);
  assert.equal(calls[0].url, 'https://api.nexusmods.com/v3/mod-files/9/versions');
  assert.equal(calls[0].init.headers.apikey, 'KEY');
  assert.deepEqual(await nexusVersions(f, 'KEY', 10, 'https://x.test'), []);
  assert.deepEqual(await nexusVersions(f, 'KEY', 12), ['old-shape']);
  await assert.rejects(nexusVersions(f, 'KEY', 11), /HTTP 503/);
  assert.deepEqual(await nexusModFileIds(f, 'KEY', 5), ['9', '77']);
  assert.deepEqual(await nexusModFileIds(f, 'KEY', 6), []);
  await assert.rejects(nexusModFileIds(f, 'KEY', 7), /HTTP 503/);
});

test('summaryMarkdown lists every group and says when there is nothing', () => {
  const plan = {
    items: [{ slug: 'a', version: '1', display_name: 'A', mod_id: 1, file_id: 2 }],
    waiting: [{ slug: 'w', version: '1', reason: 'r1' }],
    blocked: [{ slug: 'b', version: '1', reason: 'r2' }],
    skipped: [{ slug: 's', version: '1', reason: 'r3' }],
    done: [{ slug: 'd', version: '1', reason: 'r4' }],
  };
  const md = summaryMarkdown(plan, { dryRun: true });
  for (const s of ['(dry run', 'Ready to publish', '`a` 1 as "A" (mod 1, file 2)', 'Already published', 'Blocked', 'Waiting for scans', 'Skipped', 'r1', 'r2', 'r3', 'r4']) assert.ok(md.includes(s), s);
  const empty = summaryMarkdown({ items: [], waiting: [], blocked: [], skipped: [], done: [] }, { dryRun: false });
  assert.match(empty, /No mapped mod releases/);
  assert.ok(!empty.includes('dry run'));
});

function fakeFs(files = {}) {
  const fs = {
    files,
    appended: {},
    dirs: [],
    readFileSync: (p) => {
      if (!(p in files)) throw new Error(`ENOENT ${p}`);
      return typeof files[p] === 'string' ? files[p] : JSON.stringify(files[p]);
    },
    appendFileSync: (p, d) => (fs.appended[p] = (fs.appended[p] || '') + d),
    writeFileSync: (p, d) => (files[p] = d),
    mkdirSync: (d) => fs.dirs.push(d),
    existsSync: (p) => p in files,
  };
  return fs;
}

test('runPlan: dry run, live run, ledger, empty scans, bad inputs', async () => {
  const one = map()['loot-your-way'];
  const releases = [rel('loot-your-way-v0.2.0'), rel('pain-your-way-v0.2.0'), rel('blocked-v1.0.0'), rel('done-v1.0.0')];
  const m = { ...map(), 'pain-your-way': { ...one, mod_id: null, file_id: null }, blocked: one, done: one };
  const files = () => ({
    'nexus/products.json': m,
    'nexus/published.json': { done: ['1.0.0'] },
    'public/api/scans.json': doc(entry({}, 'loot-your-way-v0.2.0'), entry({ kaspersky: { status: 'ok', url: URL_OK, zone: 'Red' } }, 'blocked-v1.0.0')),
  });
  const f = async () => json(releases);
  const run = async (env, fl = files()) => {
    const fs = fakeFs(fl);
    const logs = [];
    const code = await runPlan({ GITHUB_REPOSITORY: 'o/r', GITHUB_OUTPUT: 'out', GITHUB_STEP_SUMMARY: 'sum', ...env }, { fs, fetchImpl: f, log: (x) => logs.push(x) });
    return { code, logs, out: fs.appended.out || '', sum: fs.appended.sum || '' };
  };

  let r = await run({ VAR_DRY_RUN: '' });
  assert.equal(r.code, 0);
  assert.match(r.out, /publish=false/);
  assert.match(r.out, /dry_run=true/);
  assert.match(r.out, /items=\[\{"slug":"loot-your-way"/);
  assert.ok(r.logs.some((l) => l.startsWith('::notice::pain-your-way')));
  assert.ok(r.logs.some((l) => l.startsWith('::warning::blocked')));
  assert.match(r.sum, /dry run/);
  assert.match(r.sum, /Already published/);

  r = await run({ VAR_DRY_RUN: 'false', GITHUB_API_URL: 'https://api.github.com/', PRODUCT: 'all' });
  assert.match(r.out, /publish=true/);

  // A manual input wins over the variable.
  r = await run({ INPUT_DRY_RUN: 'false', VAR_DRY_RUN: 'true' });
  assert.match(r.out, /publish=true/);
  r = await run({ INPUT_DRY_RUN: 'true', VAR_DRY_RUN: 'false' });
  assert.match(r.out, /publish=false/);

  // No output files: the summary and the outputs go to the log / nowhere.
  r = await run({ GITHUB_OUTPUT: '', GITHUB_STEP_SUMMARY: '' });
  assert.ok(r.logs.some((l) => l.includes('Nexus Mods publish plan')));

  // A placeholder scans file: a warning, nothing is ready.
  r = await run({ INPUT_DRY_RUN: 'false' }, { ...files(), 'public/api/scans.json': { schema: 1, generated: null, scanners: {}, files: [] } });
  assert.ok(r.logs.some((l) => l.includes('empty or invalid')));
  assert.match(r.out, /publish=false/);
  r = await run({}, { ...files(), 'public/api/scans.json': { nope: true } });
  assert.ok(r.logs.some((l) => l.includes('empty or invalid') && l.includes('schema')));

  // Bad mapping, bad ledger, missing file, GitHub error: exit 1, nothing written.
  r = await run({}, { ...files(), 'nexus/products.json': { a: 1 } });
  assert.equal(r.code, 1);
  assert.match(r.logs.at(-1), /::error::nexus: a: entry must be an object/);
  r = await run({}, { ...files(), 'nexus/published.json': { a: 'x' } });
  assert.match(r.logs.at(-1), /published\.json a: must be a list/);
  r = await run({}, {});
  assert.match(r.logs.at(-1), /ENOENT/);
  const fs = fakeFs(files());
  const logs = [];
  assert.equal(await runPlan({ GITHUB_REPOSITORY: 'o/r' }, { fs, fetchImpl: async () => json({}, 500), log: (x) => logs.push(x) }), 1);
  assert.match(logs.at(-1), /HTTP 500/);
});

const BODY = `Choose what you get.\n\nRequires PulseDepot.\n\n### 0.2.0 – more games\n\n- Renamed.\n- Works on XIII-2.\n\n### 0.1.0 – first release\n\n- First.\n\nSHA-256 \`a.cws\`: \`${SHA}\`\n`;

test('changelogOf, readmeOf, descriptionOf', () => {
  assert.equal(changelogOf(BODY, '0.2.0'), '- Renamed.\n- Works on XIII-2.');
  assert.equal(changelogOf(BODY, '0.1.0'), '- First.');
  assert.equal(changelogOf('### v1.0.0\r\n- a\r\nSHA-256 x\r\n', '1.0.0'), '- a');
  assert.equal(changelogOf(BODY, '9.9.9'), '');
  assert.equal(changelogOf(null, '1'), '');
  const readme = readmeOf(BODY, { display_name: 'XIII — Loot Your Way', version: '0.2.0', slug: 'loot-your-way' });
  assert.match(readme, /^XIII — Loot Your Way 0\.2\.0\n\nChoose what you get\.\n\nRequires PulseDepot\.\n\nMod page: https:\/\/.*\/mods\/loot-your-way\/\n$/);
  assert.ok(!readme.includes('SHA-256') && !readme.includes('Renamed'));
  assert.match(readmeOf('only intro', { display_name: 'A', version: '1', slug: 's' }), /^A 1\n\nonly intro\n\nMod page/);
  assert.match(readmeOf('', { display_name: 'A', version: '1', slug: 's' }), /^A 1\n\nMod page/);
  assert.equal(descriptionOf({ display_name: 'A', version: '1', game: 'G', requires: 'PulseDepot 9', sha256: SHA }), `A 1 for G. Needs PulseDepot 9. SHA-256: ${SHA}`);
  assert.equal(descriptionOf({ display_name: 'A', version: '1', sha256: SHA }), `A 1. Needs PulseDepot 0.2.0-beta or newer. SHA-256: ${SHA}`);
});

test('termHits finds internal terms, ignores public names', () => {
  assert.deepEqual(termHits({ a: 'Works with PulseDepot, Crux and NovaFix.' }), []);
  const hits = termHits({ a: 'Nova menu', b: 'FF13LayeredFS and ff13-studio', c: 'see 0xABCDEF in Ghidra' });
  assert.ok(hits.includes('a: "Nova"'));
  assert.ok(hits.some((h) => h.startsWith('b: "LayeredFS"')));
  assert.ok(hits.some((h) => h.startsWith('b: "ff13-studio"')));
  assert.ok(hits.includes('c: "0xABCDEF"'));
  assert.ok(hits.includes('c: "Ghidra"'));
  // Only the hashed names with plain: false.
  const hashes = [sha(canonical('Hidden Person'))];
  assert.deepEqual(termHits({ n: 'crate, ghidra, Hidden Person' }, { plain: false, hashes }), ['n: banned name #1']);
  assert.deepEqual(termHits({ n: 'crate, ghidra' }, { plain: false, hashes }), []);
});

function nexusFetch({ have = ['0.1.0'], body = BODY, bytes = CWS, releaseStatus = 200, assetStatus = 200, modFiles = ['9'] } = {}) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/v3/mod-files/')) return json({ data: { versions: have.map((version) => ({ version })) } });
    if (url.includes('/v3/mods/')) return json({ data: { mod_files: modFiles.map((id) => ({ id })) } });
    if (url.includes('/releases/tags/')) return releaseStatus === 200 ? json({ body }) : json({}, releaseStatus);
    if (url.includes('/assets/')) return new Response(bytes, { status: assetStatus });
    return json({}, 404);
  };
  f.calls = calls;
  return f;
}
const item = { slug: 'loot-your-way', version: '0.2.0', tag: 'loot-your-way-v0.2.0', asset: 'a.cws', asset_url: 'https://api.github.com/assets/1', sha256: SHA, mod_id: '5', file_id: '9', display_name: 'XIII — Loot Your Way', category: 'main', archive_old: false, game: 'FINAL FANTASY XIII (Steam)', requires: '' };
const ctx = (f, over = {}) => {
  const written = {};
  return { written, fetchImpl: f, token: 'T', apiKey: 'K', repo: 'o/r', outDir: 'stage', readLegal: () => 'NOTICES', writeFile: (p, d) => (written[p] = d), ...over };
};

test('stageItem builds the package, changelog and description', async () => {
  const f = nexusFetch();
  const c = ctx(f);
  const r = await stageItem(item, c);
  assert.equal(r.skip, false);
  assert.equal(r.zip, 'stage/a.cws.zip');
  assert.equal(r.changelog, '- Renamed.\n- Works on XIII-2.');
  assert.match(r.description, /^XIII — Loot Your Way 0\.2\.0 for FINAL FANTASY XIII \(Steam\)\. Needs PulseDepot 0\.2\.0-beta or newer\. SHA-256: /);
  assert.deepEqual(r.warnings, []);
  const entries = zipEntries(c.written['stage/a.cws.zip']);
  assert.deepEqual(entries.map((e) => e.name), ['a.cws', 'README.txt', 'THIRD-PARTY-NOTICES.txt']);
  assert.equal(entries[0].read().toString(), 'shard bytes');
  assert.equal(entries[2].read().toString(), 'NOTICES');
  assert.equal(f.calls[0].init.headers.apikey, 'K');
  assert.ok(f.calls[0].url.endsWith('/v3/mods/5/files'));
  assert.ok(f.calls.some((x) => x.url === 'https://api.github.com/repos/o/r/releases/tags/loot-your-way-v0.2.0'));
});

test('stageItem: no notices file, no changelog section, custom api', async () => {
  const f = nexusFetch({ body: 'intro only' });
  const c = ctx(f, { readLegal: () => null, api: 'https://gh.test/', token: undefined });
  const r = await stageItem(item, c);
  assert.equal(r.changelog, 'Version 0.2.0');
  assert.match(r.warnings[0], /no third-party notices/);
  assert.deepEqual(zipEntries(c.written['stage/a.cws.zip']).map((e) => e.name), ['a.cws', 'README.txt']);
  assert.ok(f.calls.some((x) => x.url.startsWith('https://gh.test/repos/')));
});

test('stageItem refuses: wrong file for the mod, already on Nexus, wrong bytes, release error, internal terms', async () => {
  await assert.rejects(stageItem(item, ctx(nexusFetch({ modFiles: ['1'] }))), /file 9 does not belong to mod 5/);
  const have = await stageItem(item, ctx(nexusFetch({ have: ['0.2.0'] })));
  assert.deepEqual(have, { skip: true, reason: 'version 0.2.0 is already on Nexus' });

  await assert.rejects(stageItem(item, ctx(nexusFetch({ bytes: Buffer.from('other') }))), /does not match the release's SHA-256/);
  const wrong = { ...item, sha256: sha('x') };
  await assert.rejects(stageItem(wrong, ctx(nexusFetch())), /SHA-256/);
  // A malformed SHA-256 skips the digest check inside the download: the direct comparison still fails.
  await assert.rejects(stageItem({ ...item, sha256: SHA.toUpperCase() }, ctx(nexusFetch())), /does not match the scanned SHA-256/);
  await assert.rejects(stageItem(item, ctx(nexusFetch({ assetStatus: 404 }))), /HTTP 404/);
  await assert.rejects(stageItem(item, ctx(nexusFetch({ releaseStatus: 500 }))), /release loot-your-way-v0\.2\.0: HTTP 500/);
  const dirty = `### 0.2.0\n\n- Fixed the Nova menu.\n`;
  await assert.rejects(stageItem(item, ctx(nexusFetch({ body: dirty }))), /internal terms in the Nexus text: changelog: "Nova"/);
  await assert.rejects(stageItem({ ...item, display_name: 'Ghidra pack' }, ctx(nexusFetch())), /name: "Ghidra"/);
});

test('stageItem checks the notices for banned names only', async () => {
  const hashes = [sha(canonical('Hidden Person'))];
  // Ordinary words the plain list bans are fine in notices.
  const ok = await stageItem(item, ctx(nexusFetch(), { hashes, readLegal: () => 'Uses the serde crate. See ghidra.' }));
  assert.equal(ok.skip, false);
  await assert.rejects(stageItem(item, ctx(nexusFetch(), { hashes, readLegal: () => 'Thanks to Hidden Person' })), /notices: banned name #1/);
});

test('outputLine: single and multi-line values', () => {
  assert.equal(outputLine('a', 'b'), 'a=b\n');
  assert.equal(outputLine('a', 5), 'a=5\n');
  assert.equal(outputLine('c', 'x\ny'), 'c<<EOF_NEXUS\nx\ny\nEOF_NEXUS\n');
  assert.equal(outputLine('c', 'x\nEOF_NEXUS\n'), 'c<<EOF_NEXUS_X\nx\nEOF_NEXUS\n\nEOF_NEXUS_X\n');
});

test('runStage: skip, staged outputs and failures', async () => {
  const base = { ITEM: JSON.stringify(item), GITHUB_REPOSITORY: 'o/r', NEXUS_API_KEY: 'K', GITHUB_OUTPUT: 'out' };
  const run = async (env, f, files = { 'public/legal/mod-loot-your-way.txt': 'NOTICES' }) => {
    const fs = fakeFs(files);
    const logs = [];
    const code = await runStage({ ...base, ...env }, { fs, fetchImpl: f, log: (x) => logs.push(x) });
    return { code, fs, logs, out: fs.appended.out || '' };
  };
  let r = await run({}, nexusFetch({ have: ['0.2.0'] }));
  assert.equal(r.code, 0);
  assert.match(r.out, /skip=true/);
  assert.ok(r.logs[0].startsWith('::notice::loot-your-way'));
  assert.deepEqual(r.fs.dirs, ['stage']);

  r = await run({ STAGE_DIR: 'out' }, nexusFetch());
  assert.match(r.out, /skip=false\nzip=out\/a\.cws\.zip\nchangelog<<EOF_NEXUS\n- Renamed\./);
  assert.ok(r.out.includes(`SHA-256: ${SHA}`));
  assert.ok(r.fs.files['out/a.cws.zip']);
  assert.deepEqual(r.logs, []);

  // No notices file: warning; no GITHUB_OUTPUT: nothing is written.
  r = await run({ GITHUB_OUTPUT: '' }, nexusFetch(), {});
  assert.equal(r.code, 0);
  assert.ok(r.logs[0].startsWith('::warning::'));
  assert.equal(r.out, '');

  r = await run({}, nexusFetch({ modFiles: [] }));
  assert.equal(r.code, 1);
  assert.match(r.logs.at(-1), /::error::.*does not belong/);
  r = await run({ ITEM: 'not json' }, nexusFetch());
  assert.equal(r.code, 1);
});

test('runLedger records every note of a run in one write and fails closed', () => {
  const run = (env, files) => {
    const fs = fakeFs(files);
    fs.readdirSync = (d) => Object.keys(files).filter((p) => p.startsWith(`${d}/`)).map((p) => p.slice(d.length + 1));
    const logs = [];
    return { code: runLedger(env, { fs, log: (x) => logs.push(x) }), fs, logs };
  };
  const notes = { 'n/b.json': '{"slug":"b","version":"1.0.0"}', 'n/a.json': '{"slug":"a","version":"0.2.0"}', 'n/c.json': '{"slug":"c","version":"3"}', 'n/ignored.txt': 'x' };
  let r = run({ LEDGER_DIR: 'n' }, { 'nexus/published.json': { a: ['0.1.0'], c: ['3'] }, ...notes });
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.fs.files['nexus/published.json']), { a: ['0.1.0', '0.2.0'], b: ['1.0.0'], c: ['3'] });
  assert.deepEqual(r.logs, ['recorded a 0.2.0', 'recorded b 1.0.0', 'recorded c 3']);
  r = run({}, { 'nexus/published.json': {} });
  assert.match(r.logs[0], /LEDGER_DIR is required/);
  assert.equal(r.code, 1);
  r = run({ LEDGER_DIR: 'n' }, { 'nexus/published.json': { a: 3 } });
  assert.match(r.logs[0], /published\.json: a: must be a list/);
  r = run({ LEDGER_DIR: 'n' }, { 'nexus/published.json': {}, 'n/x.json': '{"slug":"a"}' });
  assert.match(r.logs[0], /x\.json: a note needs a slug and a version/);
  r = run({ LEDGER_DIR: 'n' }, { 'nexus/published.json': {}, 'n/x.json': 'null' });
  assert.equal(r.code, 1);
  r = run({ LEDGER_DIR: 'n' }, {});
  assert.equal(r.code, 1);
  assert.equal(r.fs.files['nexus/published.json'], undefined);
});

test('makeZip round-trips through the reader with real CRCs', () => {
  const zip = makeZip([{ name: 'ü.txt', data: 'héllo' }, { name: 'b.bin', data: Buffer.from([1, 2, 3]) }]);
  const e = zipEntries(zip);
  assert.deepEqual(e.map((x) => x.name), ['ü.txt', 'b.bin']);
  assert.equal(e[0].read().toString(), 'héllo');
  assert.deepEqual([...e[1].read()], [1, 2, 3]);
});
