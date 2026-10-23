import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { APPS, INNER, downloadAsset, latestReleases, listReleases, parseTag, scannableAssets, targetsOf } from '../scans/collect.mjs';
import { limiter, request } from '../scans/http.mjs';
import { metaDefender } from '../scans/metadefender.mjs';
import {
  badgeHtml,
  badgeText,
  cardBadgesHtml,
  emptyScans,
  fallbackFiles,
  fileHtml,
  fileId,
  filesHtml,
  ratio,
  scanState,
  selfScanLinks,
  usableScans,
  validateScans,
} from '../scans/model.mjs';
import { keepPrevious, runScans, scanAll } from '../scans/run.mjs';
import { DIRECT_UPLOAD_MAX, virusTotal } from '../scans/virustotal.mjs';
import { zipOf } from './fixtures.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const A = sha('a');
const B = sha('b');
const noSleep = async () => {};
const fast = () => limiter(0, { sleep: noSleep });
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

/** fetch mock: `routes` is [[method, RegExp, handler(url, init, n)]]; every call is recorded. */
function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, init });
    for (const [m, re, h] of routes) if (m === method && re.test(url)) return h(url, init, calls.filter((c) => c.method === m && re.test(c.url)).length);
    return json({ error: 'no route' }, 599);
  };
  fn.calls = calls;
  return fn;
}

const vtFile = (stats, results = { Engine: { category: 'undetected', result: null } }) => ({ data: { attributes: { last_analysis_date: 1760000000, last_analysis_stats: stats, last_analysis_results: results } } });
const VT_CLEAN = { malicious: 0, suspicious: 0, undetected: 60, harmless: 0, 'type-unsupported': 12, timeout: 1 };
const mdResult = (detected, details, progress = 100) => ({
  data_id: 'd1',
  scan_results: { progress_percentage: progress, total_avs: Object.keys(details).length, total_detected_avs: detected, scan_all_result_a: detected ? 'Infected' : 'No Threat Detected', start_time: '2026-10-20T10:00:00.000Z', scan_details: details },
});

const target = (name, data, extra = {}) => ({ id: fileId(name), name, container: null, product: 'pulsedepot', version: '0.1.0-beta', release: 'pulsedepot-v0.1.0-beta', sha256: sha(data), size: data.length, read: () => Buffer.from(data), ...extra });

// ------------------------------------------------------------------ model

const okDoc = () => ({
  schema: 1,
  generated: '2026-10-22T04:00:00.000Z',
  scanners: { virustotal: 'configured', metadefender: 'not configured' },
  files: [
    {
      id: 'p-zip',
      name: 'p.zip',
      container: null,
      product: 'pulsedepot',
      version: '0.1.0-beta',
      release: 'pulsedepot-v0.1.0-beta',
      sha256: A,
      size: 10,
      scanned_at: '2026-10-22T04:00:00.000Z',
      scans: {
        virustotal: { status: 'ok', stats: { malicious: 0, suspicious: 0, undetected: 70, harmless: 2, 'type-unsupported': 4 }, flagged: [], scanned_at: '2026-10-21T00:00:00.000Z', url: `https://www.virustotal.com/gui/file/${A}` },
        metadefender: { status: 'not configured' },
      },
    },
  ],
});

test('the schema accepts real documents and the placeholder', () => {
  assert.deepEqual(validateScans(okDoc()), []);
  assert.deepEqual(validateScans(emptyScans()), []);
  assert.equal(usableScans(emptyScans()), null);
  assert.equal(usableScans(okDoc()).files.length, 1);
  assert.equal(usableScans(null), null);
});

test('the schema rejects broken entries', () => {
  assert.deepEqual(validateScans(null), ['not an object']);
  const d = okDoc();
  d.schema = 2;
  d.generated = 'yesterday';
  d.scanners.other = 'configured';
  d.files[0].sha256 = 'ABC';
  d.files[0].size = -1;
  d.files[0].scans.virustotal.stats.malicious = 'none';
  d.files[0].scans.virustotal.url = 'http://example.com';
  d.files[0].scans.metadefender.status = 'maybe';
  d.files.push({ ...d.files[0], scans: { other: { status: 'ok' } } });
  const errors = validateScans(d).join('\n');
  for (const want of ['schema must be 1', 'generated must be', 'scanners.other', 'sha256 must be', 'size must be', 'stats.malicious', 'url must be an https', 'status: maybe', 'is not unique', 'unknown scanner']) assert.match(errors, new RegExp(want.replace('.', '\\.')));
  assert.deepEqual(validateScans({ ...okDoc(), files: 'x' }).slice(-1), ['files must be an array']);
});

test('ratios, states and badge texts', () => {
  const vt = okDoc().files[0].scans.virustotal;
  assert.deepEqual(ratio('virustotal', vt), { flagged: 0, suspicious: 0, total: 72, text: '0/72' });
  assert.equal(badgeText('virustotal', vt), 'VirusTotal 0/72');
  assert.equal(scanState('virustotal', vt), 'clean');
  assert.equal(scanState('virustotal', { ...vt, stats: { ...vt.stats, suspicious: 1 } }), 'flagged');
  const md = { status: 'ok', stats: { detected: 1, total: 21 } };
  assert.equal(badgeText('metadefender', md), 'MetaDefender 1/21');
  assert.equal(scanState('metadefender', md), 'flagged');
  assert.equal(badgeText('metadefender', { status: 'not configured' }), 'MetaDefender: not set up');
  assert.equal(badgeText('virustotal', { status: 'pending' }), 'VirusTotal: in progress');
  assert.equal(scanState('virustotal', { status: 'pending' }), 'pending');
  assert.equal(badgeText('virustotal', { status: 'error' }), 'VirusTotal: not available');
  assert.equal(badgeText('virustotal', undefined), 'VirusTotal: not scanned yet');
  assert.equal(scanState('virustotal', undefined), 'none');
  assert.equal(ratio('virustotal', { status: 'error' }), null);
});

test('badges and file cards are escaped HTML', () => {
  assert.equal(badgeHtml('virustotal', okDoc().files[0].scans.virustotal, '/security/#p-zip'), '<a class="pill scan scan-clean" href="/security/#p-zip" title="Scanned 2026-10-21">VirusTotal 0/72</a>');
  const evil = { ...okDoc().files[0], name: '<img src=x onerror=1>.exe', container: 'a"b.zip', scans: { virustotal: { status: 'ok', stats: { malicious: 1, suspicious: 0, undetected: 1, harmless: 0, 'type-unsupported': 0 }, flagged: [{ engine: 'E<1>', result: 'Gen"Heur' }], scanned_at: null, url: 'https://x/' } } };
  const html = fileHtml(evil, { pulsedepot: 'PulseDepot' });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img src=x onerror=1&gt;\.exe/);
  assert.match(html, /Inside <code>a&quot;b\.zip<\/code>/);
  assert.match(html, /Flagged by E&lt;1&gt; \(Gen&quot;Heur\)/);
  assert.match(html, /PulseDepot/);
  assert.match(html, /data-copy="[0-9a-f]{64}"/);
  assert.match(html, /MetaDefender: not scanned yet/);
  for (const l of selfScanLinks(A)) assert.ok(html.includes(l.url.replace(/&/g, '&amp;')), l.name);
  assert.deepEqual(
    selfScanLinks(A).map((l) => l.name),
    ['VirusTotal', 'MetaDefender', 'Jotti', 'Hybrid Analysis'],
  );
  assert.match(fileHtml(okDoc().files[0]), /<time datetime="2026-10-21">/);
});

test('release card badges link to the file on the Security page', () => {
  const doc = okDoc();
  assert.match(cardBadgesHtml(doc, 'p.zip', '/security/'), /href="\/security\/#p-zip".*VirusTotal 0\/72.*MetaDefender: not set up/);
  assert.equal(cardBadgesHtml(doc, 'other.zip', '/security/'), '<a class="pill scan scan-none" href="/security/">Not scanned yet</a>');
  assert.equal(cardBadgesHtml(null, 'p.zip', '/s/'), '<a class="pill scan scan-none" href="/s/">Not scanned yet</a>');
});

test('files are grouped by product in the given order', () => {
  const f = okDoc().files[0];
  const html = filesHtml([{ ...f, product: 'hard-mode', id: 'h' }, f], { pulsedepot: 'PulseDepot', 'hard-mode': 'Hard Mode' }, ['pulsedepot', 'crux']);
  assert.ok(html.indexOf('PulseDepot') < html.indexOf('Hard Mode'));
  assert.doesNotMatch(html, /scans-crux/);
});

test('without scan results the downloads from the release data are listed', () => {
  const releases = {
    products: [
      { id: 'pulsedepot', version: '1', tag: 'pulsedepot-v1', platforms: { windows: { file: 'w.zip', sha256: A, bytes: 3 }, linux: { file: 'l.zip', sha256: B, bytes: 4 } } },
      { id: 'crux', version: '1', tag: 'crux-v1', bundledWith: 'pulsedepot', platforms: { windows: { file: 'w.zip', sha256: A, bytes: 3 } }, builds: [{ file: 'Crux.dll', sha256: sha('c'), bytes: 5 }] },
    ],
    mods: [{ id: 'm', version: '2', tag: 'm-v2', platforms: { windows: { file: 'm.cws', sha256: sha('m'), bytes: 1 }, linux: { file: 'm.cws', sha256: sha('m'), bytes: 1 } } }],
  };
  const files = fallbackFiles(releases);
  assert.deepEqual(files.map((f) => [f.name, f.product]), [['w.zip', 'pulsedepot'], ['l.zip', 'pulsedepot'], ['Crux.dll', 'crux'], ['m.cws', 'm']]);
  assert.deepEqual(files[0].scans, {});
  assert.match(fileHtml(files[0]), /Not scanned yet/);
});

// ---------------------------------------------------------------- collect

test('release tags, latest releases and scannable assets', () => {
  assert.deepEqual(parseTag('pulsedepot-v0.1.0-beta'), { id: 'pulsedepot', version: '0.1.0-beta' });
  assert.deepEqual(parseTag('xiii2-ui-scale-v0.1.0'), { id: 'xiii2-ui-scale', version: '0.1.0' });
  assert.equal(parseTag('nightly'), null);
  const asset = (name, state = 'uploaded') => ({ name, state, url: `https://api/x/${name}` });
  const rels = latestReleases([
    { tag_name: 'crux-v0.1.0', published_at: '2026-10-01', assets: [asset('Crux.dll'), asset('version.dll'), asset('CRUX-MANIFEST.json')] },
    { tag_name: 'crux-v0.2.0', published_at: '2026-10-10', draft: true, assets: [] },
    { tag_name: 'hard-mode-v0.1.0', published_at: '2026-10-02', assets: [asset('a.cws'), asset('a.cws.sha256'), asset('readme.zip')] },
    { tag_name: 'hard-mode-v0.0.9', published_at: '2026-09-02', assets: [asset('old.cws')] },
    { tag_name: 'pulsedepot-v0.1.0-beta', published_at: '2026-10-03', assets: [asset('p.zip'), asset('SHA256SUMS.txt'), asset('half.zip', 'starter')] },
    { tag_name: 'misc', assets: [asset('x.zip')] },
  ]);
  assert.deepEqual(rels.map((r) => r.tag), ['pulsedepot-v0.1.0-beta', 'hard-mode-v0.1.0', 'crux-v0.1.0']);
  assert.deepEqual(rels.map((r) => scannableAssets(r).map((a) => a.name)), [['p.zip'], ['a.cws'], ['Crux.dll', 'version.dll']]);
  assert.deepEqual(APPS, ['crystalworkshop', 'pulsedepot', 'crux']);
});

test('packages are scanned whole and per program', () => {
  for (const n of ['crystalworkshop.exe', 'crystalw.exe', 'pulsedepot.exe', 'Crux.dll', 'version.dll', 'pulsedepot', 'crystalw']) assert.ok(INNER.test(n), n);
  for (const n of ['d3d9.dll', 'readme.exe.txt', 'pulsedepot.ico']) assert.ok(!INNER.test(n), n);
  const zip = zipOf([
    ['pd/', '', 0],
    ['pd/pulsedepot.exe', 'MZ pd', 8],
    ['pd/Crux/Crux.dll', 'MZ crux', 0],
    ['pd/Crux/version.dll', 'MZ ver', 8],
    ['pd/dxvk/d3d9.dll', 'MZ dxvk', 0],
    ['pd/LICENSE', 'text', 0],
  ]);
  const rel = { id: 'pulsedepot', version: '0.1.0-beta', tag: 'pulsedepot-v0.1.0-beta' };
  const t = targetsOf(rel, 'pd.zip', zip);
  assert.deepEqual(t.map((x) => [x.name, x.container, x.id]), [
    ['pd.zip', null, 'pd-zip'],
    ['pulsedepot.exe', 'pd.zip', 'pd-zip-pulsedepot-exe'],
    ['Crux.dll', 'pd.zip', 'pd-zip-crux-dll'],
    ['version.dll', 'pd.zip', 'pd-zip-version-dll'],
  ]);
  assert.equal(t[1].sha256, sha('MZ pd'));
  assert.equal(t[1].size, 5);
  assert.equal(t[2].read().toString(), 'MZ crux');
  assert.equal(targetsOf(rel, 'm.cws', Buffer.from('cws')).length, 1);
});

test('releases are listed and downloaded through the GitHub API', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ tag_name: `m${i}-v1` }));
  const f = mockFetch([
    ['GET', /page=1$/, () => json(page1)],
    ['GET', /page=2$/, () => json([{ tag_name: 'x-v1' }])],
    ['GET', /assets\/1$/, () => new Response('abc')],
    ['GET', /assets\/2$/, () => new Response('abc')],
    ['GET', /assets\/3$/, () => new Response('gone', { status: 404 })],
  ]);
  const all = await listReleases(f, { repo: 'o/r', token: 'T', api: 'https://gh' });
  assert.equal(all.length, 101);
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer T');
  const bytes = await downloadAsset(f, { name: 'a', url: 'https://gh/assets/1', digest: `sha256:${sha('abc')}` }, { token: 'T' });
  assert.equal(bytes.toString(), 'abc');
  assert.equal(f.calls.at(-1).init.headers.accept, 'application/octet-stream');
  await assert.rejects(downloadAsset(f, { name: 'b', url: 'https://gh/assets/2', digest: `sha256:${B}` }), /does not match/);
  await assert.rejects(downloadAsset(f, { name: 'c', url: 'https://gh/assets/3' }), /c: HTTP 404/);
  await assert.rejects(listReleases(mockFetch([]), { repo: 'o/r' }), /releases: HTTP 599/);
});

// ------------------------------------------------------------------- http

test('the limiter spaces requests to the free-tier rate', async () => {
  let t = 1000;
  const waits = [];
  const lim = limiter(15000, { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
  await lim.wait();
  await lim.wait();
  t += 5000;
  await lim.wait();
  assert.deepEqual(waits, [15000, 10000]);
  lim.pause(60000);
  await lim.wait();
  assert.equal(waits.at(-1), 60000);
});

test('requests retry on 429 and server errors, then give up', async () => {
  let n = 0;
  const flaky = async () => (++n < 3 ? (n === 1 ? json({}, 429, { 'retry-after': '2' }) : json({}, 503)) : json({ ok: 1 }));
  const res = await request(flaky, fast(), 'https://x/a', {}, { sleep: noSleep });
  assert.equal(res.status, 200);
  assert.equal(n, 3);
  const always = await request(async () => json({}, 429), fast(), 'https://x/a', {}, { retries: 1, sleep: noSleep });
  assert.equal(always.status, 429);
  let tries = 0;
  await assert.rejects(
    request(async () => { tries++; throw new Error('offline'); }, fast(), 'https://x/path?key=1', {}, { retries: 2, sleep: noSleep }),
    (e) => e.message === '/path: offline',
  );
  assert.equal(tries, 3);
});

// ------------------------------------------------------------- VirusTotal

test('VirusTotal: a known file is looked up and never uploaded', async () => {
  const f = mockFetch([['GET', /\/files\/[0-9a-f]{64}$/, () => json(vtFile(VT_CLEAN, { Zeta: { category: 'undetected' }, Alpha: { category: 'suspicious', result: 'Heur.Gen' } }))]]);
  const vt = virusTotal({ apiKey: 'K', fetch: f, limit: fast(), sleep: noSleep, api: 'https://vt' });
  const r = await vt.lookup(target('a.zip', 'a'));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.result.stats, { malicious: 0, suspicious: 0, undetected: 60, harmless: 0, 'type-unsupported': 12 });
  assert.deepEqual(r.result.flagged, [{ engine: 'Alpha', category: 'suspicious', result: 'Heur.Gen' }]);
  assert.equal(r.result.url, `https://www.virustotal.com/gui/file/${A}`);
  assert.equal(r.result.scanned_at, new Date(1760000000 * 1000).toISOString());
  assert.equal(f.calls[0].init.headers['x-apikey'], 'K');
  assert.ok(f.calls.every((c) => c.method === 'GET'));
});

test('VirusTotal: an unknown file is uploaded and its analysis polled', async () => {
  const f = mockFetch([
    ['GET', /\/files\/[0-9a-f]{64}$/, () => json({ error: { code: 'NotFoundError' } }, 404)],
    ['POST', /\/files$/, () => json({ data: { type: 'analysis', id: 'an1' } })],
    ['GET', /\/analyses\/an1$/, (u, i, n) => json({ data: { attributes: n < 2 ? { status: 'queued' } : { status: 'completed', date: 1760000100, stats: { ...VT_CLEAN, malicious: 1 }, results: { Bad: { category: 'malicious', result: 'Trojan' } } } } })],
  ]);
  const vt = virusTotal({ apiKey: 'K', fetch: f, limit: fast(), sleep: noSleep, api: 'https://vt' });
  const out = await scanAll(vt, [target('a.zip', 'a')], { sleep: noSleep, pollIntervalMs: 1 });
  const r = out.get(A);
  assert.equal(r.status, 'ok');
  assert.equal(r.stats.malicious, 1);
  assert.deepEqual(r.flagged, [{ engine: 'Bad', category: 'malicious', result: 'Trojan' }]);
  const post = f.calls.find((c) => c.method === 'POST');
  assert.ok(post.init.body instanceof FormData);
  assert.equal(post.init.body.get('file').name, 'a.zip');
});

test('VirusTotal: large files go through an upload URL; known files without results are polled', async () => {
  const big = { ...target('big.zip', 'b'), read: () => Buffer.alloc(DIRECT_UPLOAD_MAX + 1) };
  const f = mockFetch([
    ['GET', /\/files\/upload_url$/, () => json({ data: 'https://upload.vt/abc' })],
    ['POST', /^https:\/\/upload\.vt\/abc$/, () => json({ data: { id: 'an2' } })],
    ['GET', /\/files\/[0-9a-f]{64}$/, (u, i, n) => json(n < 2 ? { data: { attributes: {} } } : vtFile(VT_CLEAN))],
  ]);
  const vt = virusTotal({ apiKey: 'K', fetch: f, limit: fast(), sleep: noSleep, api: 'https://vt' });
  assert.deepEqual(await vt.upload(big), { state: 'pending', handle: { kind: 'analysis', id: 'an2' } });
  const t = target('a.zip', 'a');
  assert.deepEqual(await vt.lookup(t), { state: 'pending', handle: { kind: 'file' } });
  assert.equal((await vt.poll(t, { kind: 'file' })).state, 'ok');
  await assert.rejects(virusTotal({ apiKey: 'K', fetch: mockFetch([['GET', /upload_url/, () => json({ data: 'ftp://x' })]]), limit: fast(), sleep: noSleep }).upload(big), /unexpected answer/);
  await assert.rejects(virusTotal({ apiKey: 'K', fetch: mockFetch([['GET', /files/, () => json({}, 401)]]), limit: fast(), sleep: noSleep }).lookup(t), /file lookup: HTTP 401/);
  assert.deepEqual(virusTotal({ apiKey: '' }), { name: 'virustotal', configured: false });
});

// ----------------------------------------------------------- MetaDefender

test('MetaDefender: hash lookup records every engine', async () => {
  const f = mockFetch([['GET', /\/hash\/[0-9a-f]{64}$/, () => json(mdResult(1, { Zed: { threat_found: '', scan_result_i: 0 }, Ace: { threat_found: 'PUA.Loader', scan_result_i: 1 } }))]]);
  const md = metaDefender({ apiKey: 'M', fetch: f, limit: fast(), sleep: noSleep, api: 'https://md' });
  const r = await md.lookup(target('version.dll', 'a'));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.result.stats, { detected: 1, total: 2 });
  assert.deepEqual(r.result.engines, [
    { engine: 'Ace', threat: 'PUA.Loader', result: 1 },
    { engine: 'Zed', threat: null, result: 0 },
  ]);
  assert.deepEqual(r.result.flagged, [{ engine: 'Ace', result: 'PUA.Loader' }]);
  assert.equal(r.result.result, 'Infected');
  assert.equal(r.result.url, `https://metadefender.com/results/hash/${A}`);
  assert.equal(f.calls[0].init.headers.apikey, 'M');
});

test('MetaDefender: unknown files are uploaded as raw bytes and polled by data_id', async () => {
  const f = mockFetch([
    ['GET', /\/hash\//, () => json({ error: { code: 404003 } }, 404)],
    ['POST', /\/file$/, () => json({ data_id: 'abc', status: 'inqueue' })],
    ['GET', /\/file\/abc$/, (u, i, n) => json(mdResult(0, { E: { threat_found: '', scan_result_i: 0 } }, n < 2 ? 40 : 100))],
  ]);
  const md = metaDefender({ apiKey: 'M', fetch: f, limit: fast(), sleep: noSleep, api: 'https://md' });
  const out = await scanAll(md, [target('x.cws', 'a')], { sleep: noSleep, pollIntervalMs: 1 });
  assert.deepEqual(out.get(A).stats, { detected: 0, total: 1 });
  const post = f.calls.find((c) => c.method === 'POST');
  assert.equal(post.init.headers.filename, 'x.cws');
  assert.equal(post.init.headers['content-type'], 'application/octet-stream');
  assert.equal(Buffer.from(post.init.body).toString(), 'a');
  // A lookup that is still in progress, a lookup without results.
  const g = mockFetch([['GET', /\/hash\//, (u, i, n) => json(n === 1 ? mdResult(0, {}, 50) : { 'some-hash': 'Not Found' })]]);
  const md2 = metaDefender({ apiKey: 'M', fetch: g, limit: fast(), sleep: noSleep, api: 'https://md' });
  assert.deepEqual(await md2.lookup(target('a', 'a')), { state: 'pending', handle: { dataId: 'd1' } });
  assert.deepEqual(await md2.lookup(target('a', 'a')), { state: 'unknown' });
  assert.deepEqual(metaDefender({}), { name: 'metadefender', configured: false });
});

// -------------------------------------------------------------------- run

test('a run scans each SHA-256 once and records every service', async () => {
  const f = mockFetch([
    ['GET', /vt\/files\//, () => json(vtFile(VT_CLEAN))],
    ['GET', /md\/hash\//, () => json(mdResult(0, { E: { threat_found: '', scan_result_i: 0 } }))],
  ]);
  const targets = [target('p.zip', 'a'), target('Crux.dll', 'b', { container: 'p.zip', id: 'p-zip-crux-dll' }), target('Crux.dll', 'b', { product: 'crux', release: 'crux-v0.1.0', version: '0.1.0' })];
  const doc = await runScans({
    targets,
    scanners: [virusTotal({ apiKey: 'K', fetch: f, limit: fast(), sleep: noSleep, api: 'https://vt' }), metaDefender({ apiKey: 'M', fetch: f, limit: fast(), sleep: noSleep, api: 'https://md' })],
    now: () => new Date('2026-10-22T04:00:00Z'),
    sleep: noSleep,
  });
  assert.deepEqual(validateScans(doc), []);
  assert.equal(doc.files.length, 3);
  assert.equal(f.calls.length, 4);
  assert.deepEqual(doc.scanners, { virustotal: 'configured', metadefender: 'configured' });
  assert.equal(doc.files[2].scans.virustotal.stats.undetected, 60);
  assert.equal(doc.files[1].container, 'p.zip');
  assert.ok(!('read' in doc.files[0]));
  assert.equal(doc.generated, '2026-10-22T04:00:00.000Z');
});

test('missing keys, failures and slow analyses never stop a run', async () => {
  const f = mockFetch([
    ['GET', /vt\/files\/[0-9a-f]+$/, (u) => (u.includes(A) ? json({}, 404) : json({}, 403))],
    ['POST', /vt\/files$/, () => json({ data: { id: 'slow' } })],
    ['GET', /vt\/analyses\/slow$/, () => json({ data: { attributes: { status: 'queued' } } })],
  ]);
  let t = 0;
  const previous = { files: [{ sha256: B, scans: { virustotal: { status: 'ok', stats: { malicious: 0, suspicious: 0, undetected: 5, harmless: 0, 'type-unsupported': 0 }, url: 'https://v/', scanned_at: null } } }] };
  const doc = await runScans({
    targets: [target('a.zip', 'a'), target('b.zip', 'b'), target('c.zip', 'c')],
    scanners: [virusTotal({ apiKey: 'K', fetch: f, limit: fast(), sleep: noSleep, api: 'https://vt' }), metaDefender({ apiKey: undefined })],
    previous,
    sleep: async (ms) => { t += ms; },
    clock: () => t,
    pollIntervalMs: 60000,
    budgetMs: 180000,
  });
  assert.deepEqual(validateScans(doc), []);
  const [a, b, c] = doc.files.map((x) => x.scans);
  assert.equal(a.virustotal.status, 'pending');
  assert.equal(f.calls.filter((x) => x.url.endsWith('/analyses/slow')).length, 3);
  assert.equal(b.virustotal.status, 'ok');
  assert.equal(b.virustotal.stale, true);
  assert.deepEqual(c.virustotal, { status: 'error', error: 'file lookup: HTTP 403' });
  for (const s of [a, b, c]) assert.deepEqual(s.metadefender, { status: 'not configured' });
  assert.equal(doc.scanners.metadefender, 'not configured');
  assert.deepEqual(keepPrevious('virustotal', A, { status: 'ok', x: 1 }, previous), { status: 'ok', x: 1 });
});

test('errors while polling are recorded per file', async () => {
  const f = mockFetch([
    ['GET', /\/hash\//, () => json({}, 404)],
    ['POST', /\/file$/, (u, i, n) => (n === 1 ? json({ data_id: 'x' }) : json({}, 413))],
    ['GET', /\/file\/x$/, () => json({}, 400)],
  ]);
  const md = metaDefender({ apiKey: 'M', fetch: f, limit: fast(), sleep: noSleep, api: 'https://md' });
  const out = await scanAll(md, [target('a', 'a'), target('b', 'b')], { sleep: noSleep, pollIntervalMs: 1 });
  assert.deepEqual(out.get(A), { status: 'error', error: 'result: HTTP 400' });
  assert.deepEqual(out.get(B), { status: 'error', error: 'upload: HTTP 413' });
});
