// The scan service adapters added after the first scans: VirusTotal report
// details and the lost-analysis fallback, Kaspersky OpenTIP, Hybrid Analysis,
// Triage and Filescan.io, all against mocked HTTP; plus the heuristic
// labelling and the schema of their records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { filescan, filescanRecord } from '../scans/filescan.mjs';
import { limiter, request } from '../scans/http.mjs';
import { HA_LINUX, HA_WINDOWS, haEnvironment, hybridAnalysis } from '../scans/hybridanalysis.mjs';
import { kaspersky, parseOpenTip } from '../scans/kaspersky.mjs';
import { HEURISTIC_NOTE, SCANNERS, badgeText, cardBadgesHtml, fileHtml, isHeuristic, scanState, validateScans, verdict } from '../scans/model.mjs';
import { runScans, scanAll } from '../scans/run.mjs';
import { triage, triageRecord } from '../scans/triage.mjs';
import { behaviourSummary, fileDetails, mitreTactics, virusTotal } from '../scans/virustotal.mjs';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const A = sha('a');
const noSleep = async () => {};
const fast = () => limiter(0, { sleep: noSleep });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function mockFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const method = init.method || 'GET';
    calls.push({ method, url, init });
    for (const [m, re, h] of routes) if (m === method && re.test(url)) return h(url, init, calls.filter((c) => c.method === m && re.test(c.url)).length);
    return json({ error: 'no route' }, 404);
  };
  fn.calls = calls;
  return fn;
}

const target = (name, data, extra = {}) => ({ id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, container: null, product: 'pulsedepot', version: '0.1.0-beta', release: 'pulsedepot-v0.1.0-beta', sha256: sha(data), size: data.length, read: () => Buffer.from(data), ...extra });
const opts = (f, api) => ({ apiKey: 'KEY', fetch: f, limit: fast(), sleep: noSleep, api });
const docWith = (scans) => ({
  schema: 1,
  generated: '2026-10-22T04:00:00.000Z',
  scanners: Object.fromEntries(SCANNERS.map((s) => [s, 'configured'])),
  files: [{ id: 'x', name: 'x.exe', container: null, product: 'pulsedepot', version: '1', release: 'pulsedepot-v1', sha256: A, size: 1, scanned_at: '2026-10-22T04:00:00.000Z', scans }],
});

// ------------------------------------------------------------ heuristics

test('machine-learning and hash-label verdicts are marked heuristic', () => {
  for (const r of ['Trojan:Win32/Wacatac.C!ml', 'Trojan:Win32/Wacatac.B!ML ', 'ti!B68FC40ADD25', 'TI!0123abcd']) assert.ok(isHeuristic(r), r);
  for (const r of ['Trojan.Generic', 'Heur.Gen', 'mlware', 'ti!xyz', null, undefined, 3]) assert.ok(!isHeuristic(r), String(r));
  const vt = { status: 'ok', stats: { malicious: 2, suspicious: 0, undetected: 68, harmless: 0, 'type-unsupported': 4 }, url: 'https://v/', scanned_at: null, flagged: [{ engine: 'Microsoft', category: 'malicious', result: 'Trojan:Win32/Wacatac.C!ml' }, { engine: 'McAfeeD', category: 'malicious', result: 'ti!B68FC40ADD25', engine_version: '1.2.0', engine_update: '2026-10-21' }, { engine: 'Other', result: 'Trojan.X' }] };
  const html = fileHtml(docWith({ virustotal: vt }).files[0]);
  assert.ok(html.includes(`Microsoft (Trojan:Win32/Wacatac.C!ml; ${HEURISTIC_NOTE})`));
  assert.ok(html.includes(`McAfeeD (ti!B68FC40ADD25; ${HEURISTIC_NOTE}; engine 1.2.0, updated 2026-10-21)`));
  assert.ok(html.includes('Other (Trojan.X)'));
  assert.ok(!html.includes(`Trojan.X; ${HEURISTIC_NOTE}`));
});

// ---------------------------------------------------------------- schema

test('the schema checks every scanner record', () => {
  const ok = {
    virustotal: { status: 'ok', stats: { malicious: 0, suspicious: 0, undetected: 1, harmless: 0, 'type-unsupported': 0 }, url: 'https://v/', scanned_at: null, details: { tags: [] }, behaviour: null },
    metadefender: { status: 'ok', stats: { detected: 0, total: 1 }, url: 'https://m/' },
    kaspersky: { status: 'ok', zone: 'Green', detections: [], url: 'https://k/', scanned_at: null },
    hybridanalysis: { status: 'ok', verdict: 'no specific threat', threat_score: 0, url: 'https://h/' },
    triage: { status: 'ok', score: 1, url: 'https://t/' },
    filescan: { status: 'ok', verdict: 'benign', threat_level: 0.1, url: 'https://f/' },
  };
  assert.deepEqual(validateScans(docWith(ok)), []);
  // Older documents (only two scanners, no details) stay valid.
  assert.deepEqual(validateScans(docWith({ virustotal: ok.virustotal, metadefender: { status: 'not configured' } })), []);
  const bad = {
    virustotal: { ...ok.virustotal, details: [], behaviour: 'x', flagged: 'no' },
    kaspersky: { ...ok.kaspersky, zone: 'Blue', detections: {} },
    hybridanalysis: { ...ok.hybridanalysis, verdict: 3, threat_score: 101 },
    triage: { ...ok.triage, score: 11 },
    filescan: { ...ok.filescan, verdict: 'fine', threat_level: 2 },
  };
  const errors = validateScans(docWith(bad)).join('\n');
  for (const want of ['details must be an object', 'behaviour must be an object', 'flagged must be a list', 'zone: Blue', 'detections must be a list', 'verdict must be a string', 'threat_score must be', 'score must be 0-10', 'verdict: fine', 'threat_level must be']) assert.ok(errors.includes(want), want);
  const d = docWith(ok);
  d.scanners.other = 'configured';
  assert.match(validateScans(d).join(), /scanners\.other/);
});

test('verdicts, states and badges of every scanner', () => {
  const cases = [
    ['kaspersky', { status: 'ok', zone: 'Green' }, 'Kaspersky: clean', 'clean'],
    ['kaspersky', { status: 'ok', zone: 'Yellow' }, 'Kaspersky: adware or other', 'flagged'],
    ['kaspersky', { status: 'ok', zone: 'Red' }, 'Kaspersky: malware', 'flagged'],
    ['kaspersky', { status: 'ok', zone: 'Grey' }, 'Kaspersky: no verdict', 'none'],
    ['kaspersky', { status: 'ok', zone: '?' }, 'Kaspersky: no verdict', 'none'],
    ['hybridanalysis', { status: 'ok', verdict: 'no specific threat' }, 'Hybrid Analysis: no specific threat', 'clean'],
    ['hybridanalysis', { status: 'ok', verdict: 'malicious' }, 'Hybrid Analysis: malicious', 'flagged'],
    ['hybridanalysis', { status: 'ok', verdict: 'no verdict' }, 'Hybrid Analysis: no verdict', 'none'],
    ['hybridanalysis', { status: 'ok', verdict: null }, 'Hybrid Analysis: no verdict', 'none'],
    ['triage', { status: 'ok', score: 1 }, 'Triage 1/10', 'clean'],
    ['triage', { status: 'ok', score: 6 }, 'Triage 6/10', 'flagged'],
    ['triage', { status: 'ok', score: null }, 'Triage: no score', 'none'],
    ['filescan', { status: 'ok', verdict: 'likely_malicious' }, 'Filescan.io: likely malicious', 'flagged'],
    ['filescan', { status: 'ok', verdict: 'no_threat' }, 'Filescan.io: no threat', 'clean'],
    ['filescan', { status: 'ok', verdict: 'unknown' }, 'Filescan.io: unknown', 'none'],
    ['triage', { status: 'not configured' }, 'Triage: not set up', 'none'],
    ['filescan', { status: 'pending' }, 'Filescan.io: in progress', 'pending'],
  ];
  for (const [s, scan, text, state] of cases) {
    assert.equal(badgeText(s, scan), text);
    assert.equal(scanState(s, scan), state, text);
  }
  assert.equal(verdict('nothing', { status: 'ok' }), null);
  assert.equal(verdict('triage', { status: 'error' }), null);
});

test('the Security page shows a column per scanner and the VirusTotal details', () => {
  const scans = {
    virustotal: {
      status: 'ok',
      stats: { malicious: 0, suspicious: 0, undetected: 70, harmless: 0, 'type-unsupported': 4 },
      flagged: [],
      url: 'https://v/',
      scanned_at: '2026-10-20T00:00:00.000Z',
      details: { tags: ['peexe', 'signed'], threat: { label: 'trojan.wacatac' }, sandboxes: [{ sandbox: 'Zenbox', category: 'harmless', names: [] }], yara: [], sigma: { stats: { critical: 0, high: 1, medium: 0, low: 2 }, rules: [{ title: 'Rule <A>' }] }, signature: null },
      behaviour: { tags: ['DETECT_DEBUG_ENVIRONMENT'], techniques: [{ id: 'T1027', description: 'Obfuscated files' }], tactics: [{ id: 'TA0005', name: 'Defense Evasion', techniques: [{ id: 'T1027' }] }], signatures: [{ name: 'Reads a file' }], counts: { processes_created: 2, files_written: 0 } },
    },
    kaspersky: { status: 'ok', zone: 'Red', detections: [{ name: 'HEUR:Trojan.Win32.Generic' }], url: 'https://opentip.kaspersky.com/x/' },
    hybridanalysis: { status: 'ok', verdict: 'no specific threat', threat_score: 7, family: null, environment: 'Windows 10 64 bit', url: 'https://h/' },
    triage: { status: 'ok', score: 3, family: ['none'], signatures: [{ name: 'Enumerates processes' }], url: 'https://tria.ge/x' },
    filescan: { status: 'ok', verdict: 'benign', threat_level: 0.05, url: 'https://f/' },
  };
  const html = fileHtml(docWith(scans).files[0]);
  for (const s of ['<dt>Kaspersky</dt>', '<dt>Hybrid Analysis</dt>', '<dt>Triage</dt>', '<dt>Filescan.io</dt>', 'Kaspersky: malware', 'Detected as: HEUR:Trojan.Win32.Generic', 'Threat score: 7/100', 'Sandbox: Windows 10 64 bit', 'Triage 3/10', 'Behaviour: Enumerates processes', 'Threat level: 5%', 'More from VirusTotal', 'trojan.wacatac', 'Zenbox: harmless', 'none matched', 'critical 0 · high 1 · medium 0 · low 2 — Rule &lt;A&gt;', 'not signed', 'T1027 Obfuscated files', 'Defense Evasion (1)', 'Reads a file', '2 processes started', 'https://tria.ge/x']) assert.ok(html.includes(s), s);
  assert.doesNotMatch(html, /Rule <A>/);
  // No details: no "More" block.
  assert.doesNotMatch(fileHtml(docWith({ virustotal: { ...scans.virustotal, details: undefined, behaviour: undefined } }).files[0]), /More from VirusTotal/);
  // Release cards: VirusTotal, MetaDefender, Kaspersky only.
  const card = cardBadgesHtml(docWith(scans), 'x.exe', '/s/');
  assert.match(card, /VirusTotal 0\/70.*MetaDefender: not scanned yet.*Kaspersky: malware/);
  assert.doesNotMatch(card, /Triage|Hybrid|Filescan/);
});

// ------------------------------------------------------------- http budget

test('the limiter stops at its request budget', async () => {
  const lim = limiter(0, { sleep: noSleep, max: 2 });
  await lim.wait();
  await lim.wait();
  assert.equal(lim.used, 2);
  await assert.rejects(lim.wait(), /request budget of 2/);
  await assert.rejects(request(async () => json({}), lim, 'https://x/a'), /request budget/);
});

// ------------------------------------------------------------- VirusTotal

test('VirusTotal: a lost analysis (404) falls back to the file report', async () => {
  // The first run's failure: the analysis id answered 404 after the upload.
  const f = mockFetch([
    ['GET', /\/files\/[0-9a-f]{64}$/, (u, i, n) => (n < 3 ? json({ error: { code: 'NotFoundError' } }, 404) : json({ data: { attributes: { last_analysis_date: 1760000000, last_analysis_stats: { undetected: 53 }, last_analysis_results: { E: { category: 'undetected' } } } } }))],
    ['POST', /\/files$/, () => json({ data: { type: 'analysis', id: 'ZmFrZTox==' } })],
    ['GET', /\/analyses\//, () => json({ error: { code: 'NotFoundError' } }, 404)],
  ]);
  const vt = virusTotal(opts(f, 'https://vt'));
  const t = target('pd.zip', 'a');
  assert.deepEqual(await vt.upload(t), { state: 'pending', handle: { kind: 'analysis', id: 'ZmFrZTox==' } });
  // Analysis 404 and the file not indexed yet: still pending, followed by hash from now on.
  assert.deepEqual(await vt.lookup(t), { state: 'unknown' });
  assert.deepEqual(await vt.poll(t, { kind: 'analysis', id: 'ZmFrZTox==' }), { state: 'pending', handle: { kind: 'file' } });
  const r = await vt.poll(t, { kind: 'file' });
  assert.equal(r.state, 'ok');
  assert.equal(r.result.stats.undetected, 53);
  assert.equal(f.calls.filter((c) => c.url.includes('/analyses/')).length, 1);
  // Through a whole run: recorded as a result, not as "analysis: HTTP 404".
  const g = mockFetch([
    ['GET', /\/files\/[0-9a-f]{64}$/, (u, i, n) => (n < 2 ? json({}, 404) : json({ data: { attributes: { last_analysis_date: 1760000000, last_analysis_stats: { undetected: 5 }, last_analysis_results: { E: { category: 'undetected' } } } } }))],
    ['POST', /\/files$/, () => json({ data: { id: 'gone' } })],
    ['GET', /\/analyses\/gone$/, () => json({}, 404)],
    ['GET', /\/behaviour_summary$/, () => json({ data: {} })],
  ]);
  const out = await scanAll(virusTotal(opts(g, 'https://vt')), [t], { sleep: noSleep, pollIntervalMs: 1 });
  assert.equal(out.get(A).status, 'ok');
  assert.equal(out.get(A).stats.undetected, 5);
  // Other analysis errors still count as errors.
  const h = mockFetch([['GET', /\/analyses\//, () => json({}, 400)]]);
  await assert.rejects(virusTotal(opts(h, 'https://vt')).poll(t, { kind: 'analysis', id: 'x' }), /analysis: HTTP 400/);
});

const VT_ATTRS = {
  last_analysis_date: 1760000000,
  last_analysis_stats: { malicious: 1, undetected: 70 },
  last_analysis_results: {
    Microsoft: { category: 'malicious', result: 'Trojan:Win32/Wacatac.C!ml', engine_version: '1.1.25090.3001', engine_update: '20261021' },
    Clean: { category: 'undetected', result: null },
  },
  tags: ['peexe', '64bits'],
  popular_threat_classification: { suggested_threat_label: 'trojan.wacatac', popular_threat_category: [{ value: 'trojan', count: 1 }], popular_threat_name: [{ value: 'wacatac', count: 1 }] },
  sandbox_verdicts: { Zenbox: { category: 'harmless', sandbox_name: 'Zenbox', malware_classification: ['CLEAN'], confidence: 80 } },
  crowdsourced_yara_results: [{ rule_name: 'r1', ruleset_name: 'rs', source: 'https://y/', description: 'd' }],
  sigma_analysis_stats: { critical: 0, high: 0, medium: 1, low: 3 },
  sigma_analysis_results: [{ rule_title: 'Sigma A', rule_level: 'medium', rule_source: 'src' }],
  signature_info: { product: 'PulseDepot', 'file version': '0.1.0', 'original name': 'pulsedepot.exe' },
};

test('VirusTotal: the file report, behaviour summary and MITRE tree are stored', async () => {
  const f = mockFetch([
    ['GET', /\/files\/[0-9a-f]{64}$/, () => json({ data: { attributes: VT_ATTRS } })],
    ['GET', /\/behaviour_summary$/, () => json({ data: { tags: ['DETECT_DEBUG_ENVIRONMENT'], verdicts: ['CLEAN'], mitre_attack_techniques: [{ id: 'T1012', signature_description: 'Query registry', severity: 'IMPACT_SEVERITY_LOW' }, { id: 'T1027', signature_description: 'Obfuscated', severity: 'IMPACT_SEVERITY_HIGH' }, { id: 'T1012', severity: 'IMPACT_SEVERITY_INFO' }], signature_matches: [{ name: 'Low', severity: 'IMPACT_SEVERITY_LOW' }, { description: 'High', severity: 'IMPACT_SEVERITY_HIGH' }], processes_created: ['a', 'b'], files_written: ['c'] } })],
    ['GET', /\/behaviour_mitre_trees$/, () => json({ data: { Zenbox: { tactics: [{ id: 'TA0007', name: 'Discovery', techniques: [{ id: 'T1012', name: 'Query Registry' }] }] }, CAPE: { tactics: [{ id: 'TA0007', name: 'Discovery', techniques: [{ id: 'T1012' }, { id: 'T1082', name: 'System Info' }] }, { id: 'TA0005', name: 'Defense Evasion', techniques: [] }, { name: 'no id' }] } } })],
  ]);
  const out = await scanAll(virusTotal(opts(f, 'https://vt')), [target('pulsedepot.exe', 'a')], { sleep: noSleep });
  const r = out.get(A);
  assert.deepEqual(r.flagged, [{ engine: 'Microsoft', category: 'malicious', result: 'Trojan:Win32/Wacatac.C!ml', heuristic: true, engine_version: '1.1.25090.3001', engine_update: '2026-10-21' }]);
  assert.equal(r.details.threat.label, 'trojan.wacatac');
  assert.deepEqual(r.details.tags, ['peexe', '64bits']);
  assert.deepEqual(r.details.sandboxes, [{ sandbox: 'Zenbox', category: 'harmless', classification: ['CLEAN'], names: [], confidence: 80 }]);
  assert.deepEqual(r.details.yara, [{ rule: 'r1', ruleset: 'rs', source: 'https://y/', description: 'd' }]);
  assert.deepEqual(r.details.sigma, { stats: { critical: 0, high: 0, medium: 1, low: 3 }, rules: [{ title: 'Sigma A', level: 'medium', source: 'src' }] });
  assert.equal(r.details.signature.file_version, '0.1.0');
  assert.equal(r.details.signature.original_name, 'pulsedepot.exe');
  assert.deepEqual(r.behaviour.techniques.map((t) => t.id), ['T1027', 'T1012']);
  assert.deepEqual(r.behaviour.signatures.map((s) => s.name), ['High', 'Low']);
  assert.deepEqual(r.behaviour.counts, { processes_created: 2, files_written: 1, files_dropped: 0, registry_keys_set: 0, dns_lookups: 0, ip_traffic: 0 });
  assert.deepEqual(r.behaviour.tactics, [
    { id: 'TA0005', name: 'Defense Evasion', techniques: [] },
    { id: 'TA0007', name: 'Discovery', techniques: [{ id: 'T1012', name: null }, { id: 'T1082', name: 'System Info' }] },
  ]);
  // The lookup already had the attributes: one file request, one summary, one tree.
  assert.equal(f.calls.length, 3);
  const d = docWith({ virustotal: r });
  assert.deepEqual(validateScans(d), []);
});

test('VirusTotal: details for an uploaded file, and failures that keep the result', async () => {
  const analysis = { status: 'completed', date: 1760000100, stats: { undetected: 3 }, results: { E: { category: 'undetected' } } };
  const f = mockFetch([
    ['GET', /\/files\/[0-9a-f]{64}$/, (u, i, n) => (n === 1 ? json({}, 404) : json({ data: { attributes: VT_ATTRS } }))],
    ['POST', /\/files$/, () => json({ data: { id: 'an' } })],
    ['GET', /\/analyses\/an$/, () => json({ data: { attributes: analysis } })],
    ['GET', /\/behaviour_summary$/, () => json({ data: {} })],
  ]);
  const r = (await scanAll(virusTotal(opts(f, 'https://vt')), [target('a', 'a')], { sleep: noSleep, pollIntervalMs: 1 })).get(A);
  assert.equal(r.stats.undetected, 3);
  assert.equal(r.details.threat.label, 'trojan.wacatac');
  assert.equal(r.behaviour, null);
  assert.ok(!f.calls.some((c) => c.url.endsWith('/behaviour_mitre_trees')));
  // Summary 404 -> null; summary error -> result kept without behaviour; tree error -> techniques kept.
  const t = target('a', 'a');
  const base = { status: 'ok', details: {} };
  const vt404 = virusTotal(opts(mockFetch([['GET', /behaviour_summary/, () => json({}, 404)]]), 'https://vt'));
  assert.deepEqual(await vt404.enrich(t, base), { ...base, behaviour: null });
  const vt403 = virusTotal(opts(mockFetch([['GET', /behaviour_summary/, () => json({}, 403)]]), 'https://vt'));
  assert.deepEqual(await vt403.enrich(t, base), base);
  const vtThrow = virusTotal({ ...opts(async () => { throw new Error('offline'); }, 'https://vt') });
  assert.deepEqual(await vtThrow.enrich(t, base), base);
  let n = 0;
  const flaky = async (url) => (url.endsWith('behaviour_summary') ? json({ data: { tags: ['X'] } }) : (n++, Promise.reject(new Error('down'))));
  const kept = await virusTotal(opts(flaky, 'https://vt')).enrich(t, base);
  assert.deepEqual(kept.behaviour.tags, ['X']);
  assert.deepEqual(kept.behaviour.tactics, []);
  // A run without time left skips the details.
  let clock = 0;
  const g = mockFetch([['GET', /\/files\/[0-9a-f]{64}$/, () => json({ data: { attributes: VT_ATTRS } })]]);
  const logs = [];
  await scanAll(virusTotal(opts(g, 'https://vt')), [t], { sleep: noSleep, clock: () => (clock += 1000), budgetMs: 1, enrichBudgetMs: 1, log: (m) => logs.push(m) });
  assert.ok(logs.some((m) => /no time left/.test(m)));
  assert.equal(g.calls.length, 1);
  // Enrich throwing is logged and the result stays.
  const broken = { name: 'x', configured: true, lookup: async () => ({ state: 'ok', result: { status: 'ok' } }), enrich: async () => { throw new Error('boom'); } };
  const kept2 = await scanAll(broken, [t], { sleep: noSleep, log: (m) => logs.push(m) });
  assert.deepEqual(kept2.get(A), { status: 'ok' });
  assert.ok(logs.some((m) => /details: boom/.test(m)));
});

test('VirusTotal: helpers cope with missing fields', () => {
  assert.deepEqual(fileDetails({}), { tags: [], threat: null, sandboxes: [], yara: [], sigma: { stats: null, rules: [] }, signature: null });
  assert.equal(behaviourSummary({}), null);
  assert.equal(behaviourSummary({ mitre_attack_techniques: [{ severity: 'high' }] }), null);
  assert.deepEqual(behaviourSummary({ signature_matches: [{ name: 'a', severity: 'medium' }, { name: 'b', severity: 'odd' }, { name: 'c' }] }).signatures.map((s) => s.name), ['a', 'b', 'c']);
  assert.deepEqual(mitreTactics(null), []);
  assert.deepEqual(mitreTactics({ s: null, t: { tactics: [{ id: 'TA1', techniques: [null, { name: 'no id' }] }] } }), [{ id: 'TA1', name: null, techniques: [] }]);
});

// ---------------------------------------------------------------- OpenTIP

const OT_RED = {
  Zone: 'Red',
  FileGeneralInfo: { FileStatus: 'Malware', Sha256: A, Type: 'PE', FirstSeen: '2026-10-01T00:00:00Z', LastSeen: '2026-10-21T10:00:00Z', Signer: null },
  DetectionsInfo: [{ LastDetectDate: '2026-10-21T00:00:00Z', Zone: 'Red', DetectionName: 'HEUR:Trojan.Win32.Generic', DescriptionUrl: 'https://threats.kaspersky.com/x' }],
  DynamicDetections: [{ Zone: 'Yellow', DetectionName: 'not-a-virus:X' }, { Zone: 'Green' }],
};

test('Kaspersky OpenTIP: a known file is looked up by hash', async () => {
  const f = mockFetch([['GET', /\/search\/hash\?request=[0-9a-f]{64}$/, () => json(OT_RED)]]);
  const r = await kaspersky(opts(f, 'https://ot')).lookup(target('a.exe', 'a'));
  assert.equal(r.state, 'ok');
  assert.equal(r.result.zone, 'Red');
  assert.equal(r.result.file_status, 'Malware');
  assert.deepEqual(r.result.detections.map((d) => [d.name, d.zone, d.url]), [
    ['HEUR:Trojan.Win32.Generic', 'Red', 'https://threats.kaspersky.com/x'],
    ['not-a-virus:X', 'Yellow', null],
  ]);
  assert.deepEqual(r.result.flagged, [{ engine: 'Kaspersky', result: 'HEUR:Trojan.Win32.Generic' }, { engine: 'Kaspersky', result: 'not-a-virus:X' }]);
  assert.equal(r.result.scanned_at, '2026-10-21T10:00:00.000Z');
  assert.equal(r.result.url, `https://opentip.kaspersky.com/${A}/`);
  assert.equal(f.calls[0].init.headers['x-api-key'], 'KEY');
  assert.equal(f.calls.length, 1);
  assert.deepEqual(validateScans(docWith({ kaspersky: r.result })), []);
});

test('Kaspersky OpenTIP: unknown and Grey files are uploaded as raw bytes', async () => {
  const green = { Zone: 'Green', FileGeneralInfo: { FileStatus: 'Clean' } };
  const f = mockFetch([
    ['GET', /\/search\/hash/, (u, i, n) => (n === 1 ? json({}, 404) : json({ Zone: 'Grey', FileGeneralInfo: { FileStatus: 'NotCategorized' } }))],
    ['POST', /\/scan\/file\?filename=a%20b\.exe$/, () => json(green)],
  ]);
  const ot = kaspersky(opts(f, 'https://ot'));
  const t = target('a b.exe', 'a');
  assert.deepEqual(await ot.lookup(t), { state: 'unknown' });
  assert.deepEqual(await ot.lookup(t), { state: 'unknown' });
  const up = await ot.upload(t);
  assert.equal(up.state, 'ok');
  assert.equal(up.result.zone, 'Green');
  const post = f.calls.find((c) => c.method === 'POST');
  assert.equal(post.init.headers['content-type'], 'application/octet-stream');
  assert.equal(Buffer.from(post.init.body).toString(), 'a');
  // Upload answer without a verdict yet: polled by hash.
  const g = mockFetch([
    ['GET', /\/search\/hash/, (u, i, n) => (n < 3 ? json({}, 404) : json(green))],
    ['POST', /\/scan\/file/, () => json({ FileGeneralInfo: {} })],
  ]);
  const out = await scanAll(kaspersky(opts(g, 'https://ot')), [t], { sleep: noSleep, pollIntervalMs: 1 });
  assert.equal(out.get(A).zone, 'Green');
  // Quota exceeded (403) is an error for that file; the run goes on.
  const h = mockFetch([['GET', /\/search\/hash/, () => json({}, 403)]]);
  const out2 = await scanAll(kaspersky(opts(h, 'https://ot')), [t], { sleep: noSleep });
  assert.deepEqual(out2.get(A), { status: 'error', error: 'hash lookup: HTTP 403' });
  await assert.rejects(kaspersky(opts(mockFetch([['POST', /scan/, () => json({}, 413)]]), 'https://ot')).upload(t), /upload: HTTP 413/);
  await assert.rejects(kaspersky(opts(f, 'https://ot')).upload({ ...t, read: () => ({ length: 300 * 1024 * 1024 }) }), /256 MB/);
  assert.equal(parseOpenTip(A, null), null);
  assert.equal(parseOpenTip(A, { Zone: 'Green' }).file_status, null);
  assert.deepEqual(kaspersky({}), { name: 'kaspersky', configured: false });
});

// -------------------------------------------------------- Hybrid Analysis

test('Hybrid Analysis: a known file is found by hash search', async () => {
  const f = mockFetch([
    ['GET', /\/search\/hash\?hash=[0-9a-f]{64}$/, () => json([
      { job_id: 'old', state: 'SUCCESS', verdict: 'suspicious', analysis_start_time: '2026-09-01T00:00:00Z' },
      { job_id: 'new', state: 'SUCCESS', verdict: 'no specific threat', threat_score: 4, av_detect: 2, vx_family: null, environment_description: 'Windows 10 64 bit', classification_tags: ['tool'], analysis_start_time: '2026-10-20T00:00:00Z' },
      { job_id: 'run', state: 'IN_PROGRESS' },
    ])],
  ]);
  const r = await hybridAnalysis(opts(f, 'https://ha')).lookup(target('a.exe', 'a'));
  assert.equal(r.state, 'ok');
  assert.deepEqual({ ...r.result, url: undefined }, { status: 'ok', verdict: 'no specific threat', threat_score: 4, av_detect: 2, family: null, environment: 'Windows 10 64 bit', tags: ['tool'], flagged: [], scanned_at: '2026-10-20T00:00:00.000Z', url: undefined });
  assert.equal(r.result.url, `https://hybrid-analysis.com/sample/${A}`);
  assert.equal(f.calls[0].init.headers['api-key'], 'KEY');
  assert.equal(f.calls[0].init.headers['user-agent'], 'Falcon Sandbox');
  // The newer answer shape ({ reports }) without verdicts: the summary is fetched.
  const g = mockFetch([
    ['GET', /\/search\/hash/, () => json({ sha256s: [A], reports: [{ id: 'j1', state: 'SUCCESS' }] })],
    ['GET', /\/report\/j1\/summary$/, () => json({ verdict: 'malicious', threat_score: 100, vx_family: 'Fam' })],
  ]);
  const m = await hybridAnalysis(opts(g, 'https://ha')).lookup(target('a.exe', 'a'));
  assert.equal(m.result.verdict, 'malicious');
  assert.deepEqual(m.result.flagged, [{ engine: 'Hybrid Analysis', result: 'Fam' }]);
  assert.deepEqual(validateScans(docWith({ hybridanalysis: m.result })), []);
  // Only running jobs: pending; nothing or only errors: unknown.
  const h = mockFetch([['GET', /\/search\/hash/, (u, i, n) => json(n === 1 ? [{ job_id: 'q', state: 'IN_QUEUE' }] : n === 2 ? [{ job_id: 'e', state: 'ERROR' }] : n === 3 ? [] : {})]]);
  const ha = hybridAnalysis(opts(h, 'https://ha'));
  assert.deepEqual(await ha.lookup(target('a', 'a')), { state: 'pending', handle: { job: 'q' } });
  for (let i = 0; i < 3; i++) assert.deepEqual(await ha.lookup(target('a', 'a')), { state: 'unknown' });
});

test('Hybrid Analysis: unknown files are submitted and the job polled', async () => {
  const f = mockFetch([
    ['GET', /\/search\/hash/, () => json([])],
    ['POST', /\/submit\/file$/, () => json({ job_id: 'job1', environment_id: 160 })],
    ['GET', /\/report\/job1\/state$/, (u, i, n) => json({ state: n < 2 ? 'IN_QUEUE' : 'SUCCESS' })],
    ['GET', /\/report\/job1\/summary$/, () => json({ verdict: 'no specific threat', threat_score: 0, analysis_start_time: '2026-10-22T00:00:00Z' })],
  ]);
  const out = await scanAll(hybridAnalysis(opts(f, 'https://ha')), [target('pulsedepot.exe', 'a')], { sleep: noSleep, pollIntervalMs: 1 });
  assert.equal(out.get(A).verdict, 'no specific threat');
  const post = f.calls.find((c) => c.method === 'POST');
  assert.equal(post.init.body.get('environment_id'), String(HA_WINDOWS));
  assert.equal(post.init.body.get('file').name, 'pulsedepot.exe');
  assert.equal(haEnvironment('pulsedepot'), HA_LINUX);
  assert.equal(haEnvironment('a.zip'), HA_WINDOWS);
  // A failed job, a vanished job, a missing job id.
  const g = mockFetch([['GET', /\/state$/, (u, i, n) => (n === 1 ? json({ state: 'ERROR', error: 'bad file' }) : json({}, 404))]]);
  const ha = hybridAnalysis(opts(g, 'https://ha'));
  await assert.rejects(ha.poll(target('a', 'a'), { job: 'x' }), /sandbox analysis failed: bad file/);
  assert.deepEqual(await ha.poll(target('a', 'a'), { job: 'x' }), { state: 'pending', handle: { job: 'x' } });
  await assert.rejects(hybridAnalysis(opts(mockFetch([['POST', /submit/, () => json({})]]), 'https://ha')).upload(target('a', 'a')), /no job id/);
  await assert.rejects(hybridAnalysis(opts(mockFetch([['POST', /submit/, () => json({}, 429)]]), 'https://ha')).upload(target('a', 'a')), /submission: HTTP 429/);
  await assert.rejects(hybridAnalysis(opts(mockFetch([['GET', /search/, () => json({}, 403)]]), 'https://ha')).lookup(target('a', 'a')), /hash search: HTTP 403/);
  await assert.rejects(hybridAnalysis(opts(mockFetch([['GET', /state/, () => json({}, 500)]]), 'https://ha')).poll(target('a', 'a'), { job: 'x' }), /report state: HTTP/);
  const lookupPoll = hybridAnalysis(opts(mockFetch([['GET', /search/, () => json([])]]), 'https://ha'));
  assert.deepEqual(await lookupPoll.poll(target('a', 'a'), {}), { state: 'pending', handle: {} });
  assert.deepEqual(hybridAnalysis({ apiKey: '' }), { name: 'hybridanalysis', configured: false });
});

// ------------------------------------------------------------------ Triage

const OVERVIEW = {
  sample: { id: '261022-abc', score: 3, completed: '2026-10-22T01:00:00Z' },
  analysis: { score: 3, family: [], tags: ['discovery'] },
  targets: [{ signatures: [{ name: 'Enumerates processes', score: 3 }, { name: 'Reads data files', score: 1 }, { name: 'Enumerates processes' }], family: [] }],
};

test('Triage: a known file is found by search and its overview stored', async () => {
  const f = mockFetch([
    ['GET', /\/search\?query=sha256%3A[0-9a-f]{64}$/, () => json({ data: [{ id: 'old', status: 'reported', completed: '2026-01-01' }, { id: '261022-abc', status: 'reported', completed: '2026-10-22' }, { id: 'x', status: 'failed' }] })],
    ['GET', /\/samples\/261022-abc\/overview\.json$/, () => json(OVERVIEW)],
  ]);
  const r = await triage(opts(f, 'https://tg')).lookup(target('a.exe', 'a'));
  assert.equal(r.state, 'ok');
  assert.equal(r.result.score, 3);
  assert.deepEqual(r.result.signatures, [{ name: 'Enumerates processes', score: 3 }, { name: 'Reads data files', score: 1 }]);
  assert.deepEqual(r.result.flagged, []);
  assert.equal(r.result.url, 'https://tria.ge/261022-abc');
  assert.equal(r.result.scanned_at, '2026-10-22T01:00:00.000Z');
  assert.equal(f.calls[0].init.headers.authorization, 'Bearer KEY');
  assert.deepEqual(validateScans(docWith({ triage: r.result })), []);
  const bad = triageRecord('s1', { analysis: { score: 9, family: ['evil'] }, targets: [{ family: ['evil', 'other'] }] });
  assert.deepEqual(bad.family, ['evil', 'other']);
  assert.deepEqual(bad.flagged, [{ engine: 'Triage', result: 'evil' }]);
  assert.equal(bad.url, 'https://tria.ge/s1');
  assert.equal(triageRecord('s', { sample: { score: 12 } }).score, null);
});

test('Triage: unknown files are submitted and the sample polled', async () => {
  const f = mockFetch([
    ['GET', /\/search\?/, () => json({ data: [] })],
    ['POST', /\/samples$/, () => json({ id: 's9', status: 'pending' })],
    ['GET', /\/samples\/s9$/, (u, i, n) => json({ status: n < 2 ? 'running' : 'reported' })],
    ['GET', /\/samples\/s9\/overview\.json$/, () => json({ ...OVERVIEW, sample: { id: 's9', score: 1 } })],
  ]);
  const out = await scanAll(triage(opts(f, 'https://tg')), [target('a.exe', 'a')], { sleep: noSleep, pollIntervalMs: 1 });
  assert.equal(out.get(A).score, 3);
  assert.equal(out.get(A).url, 'https://tria.ge/s9');
  const post = f.calls.find((c) => c.method === 'POST');
  assert.deepEqual(JSON.parse(post.init.body.get('_json')), { kind: 'file', interactive: false });
  assert.equal(post.init.body.get('file').name, 'a.exe');
  // Running in search: pending; failed sample; vanished sample; errors.
  const g = mockFetch([
    ['GET', /\/search\?/, (u, i, n) => json(n === 1 ? { data: [{ id: 'r', status: 'running' }] } : {})],
    ['GET', /\/samples\/bad$/, () => json({ status: 'failed' })],
    ['GET', /\/samples\/gone$/, () => json({}, 404)],
  ]);
  const tg = triage(opts(g, 'https://tg'));
  assert.deepEqual(await tg.lookup(target('a', 'a')), { state: 'pending', handle: { id: 'r' } });
  assert.deepEqual(await tg.lookup(target('a', 'a')), { state: 'unknown' });
  await assert.rejects(tg.poll(target('a', 'a'), { id: 'bad' }), /sandbox analysis failed/);
  assert.deepEqual(await tg.poll(target('a', 'a'), { id: 'gone' }), { state: 'pending', handle: { id: 'gone' } });
  assert.deepEqual(await tg.poll(target('a', 'a'), {}), { state: 'pending', handle: {} });
  await assert.rejects(triage(opts(mockFetch([['POST', /samples/, () => json({})]]), 'https://tg')).upload(target('a', 'a')), /no sample id/);
  await assert.rejects(triage(opts(mockFetch([['POST', /samples/, () => json({}, 401)]]), 'https://tg')).upload(target('a', 'a')), /submission: HTTP 401/);
  await assert.rejects(triage(opts(mockFetch([['GET', /search/, () => json({}, 401)]]), 'https://tg')).lookup(target('a', 'a')), /search: HTTP 401/);
  await assert.rejects(triage(opts(mockFetch([['GET', /samples\/x$/, () => json({}, 500)]]), 'https://tg')).poll(target('a', 'a'), { id: 'x' }), /sample: HTTP/);
  await assert.rejects(triage(opts(mockFetch([['GET', /search/, () => json({ data: [{ id: 'd', status: 'reported' }] })], ['GET', /overview/, () => json({}, 403)]]), 'https://tg')).lookup(target('a', 'a')), /overview: HTTP 403/);
  assert.deepEqual(triage({}), { name: 'triage', configured: false });
});

// ------------------------------------------------------------- Filescan.io

const fsReport = (verdict, finished = true) => ({
  flowId: 'flow1',
  allFinished: finished,
  scanStartedDate: '2026-10-22T02:00:00Z',
  reports: { rep1: { finalVerdict: { verdict, threatLevel: 0.1, confidence: 1 }, allTags: [{ tag: { name: 'peexe' } }, 'x64'], file: { name: 'a.exe', sha256: A } }, other: { file: { sha256: 'b' } } },
});

test('Filescan.io: a known file is found by its reputation and report', async () => {
  const f = mockFetch([
    ['GET', /\/api\/reputation\/hash\?sha256=[0-9a-f]{64}$/, () => json({ sha256: A, overall_verdict: 'benign', filescan_reports: [{ report_id: 'old', flow_id: 'f0', verdict: 'benign', report_date: '2026-01-01' }, { report_id: 'rep1', flow_id: 'flow1', verdict: 'benign', report_date: '2026-10-22' }] })],
    ['GET', /\/api\/scan\/flow1\/report\?filter=general&filter=finalVerdict&filter=allTags$/, () => json(fsReport('BENIGN'))],
  ]);
  const r = await filescan(opts(f, 'https://fs')).lookup(target('a.exe', 'a'));
  assert.equal(r.state, 'ok');
  assert.deepEqual(r.result, { status: 'ok', verdict: 'benign', threat_level: 0.1, confidence: 1, tags: ['peexe', 'x64'], flagged: [], scanned_at: '2026-10-22T02:00:00.000Z', url: 'https://www.filescan.io/uploads/flow1/reports/rep1/overview' });
  assert.equal(f.calls[0].init.headers['x-api-key'], 'KEY');
  assert.deepEqual(validateScans(docWith({ filescan: r.result })), []);
  // A report without a flow id: the reputation verdict and the search link.
  const g = mockFetch([['GET', /reputation/, () => json({ filescan_reports: [{ report_id: 'r', verdict: 'likely_malicious', report_date: '2026-10-01T00:00:00Z' }] })]]);
  const m = await filescan(opts(g, 'https://fs')).lookup(target('a', 'a'));
  assert.equal(m.result.verdict, 'likely_malicious');
  assert.deepEqual(m.result.flagged, [{ engine: 'Filescan.io', result: 'likely malicious' }]);
  assert.equal(m.result.url, `https://www.filescan.io/search-result?query=${A}`);
  assert.equal(filescanRecord(A, null, null, { finalVerdict: { verdict: 'weird', threatLevel: 5 } }).verdict, 'unknown');
  assert.equal(filescanRecord(A, null, null, {}).threat_level, null);
});

test('Filescan.io: unknown files are uploaded and the scan polled', async () => {
  const f = mockFetch([
    ['GET', /reputation/, () => json({ overall_verdict: 'unknown', filescan_reports: [] })],
    ['POST', /\/api\/scan\/file$/, () => json({ flow_id: 'flow1', priority: { applied: 5 } })],
    ['GET', /\/api\/scan\/flow1\/report/, (u, i, n) => (n === 1 ? json({}, 404) : json(fsReport('MALICIOUS', n > 2)))],
  ]);
  const out = await scanAll(filescan(opts(f, 'https://fs')), [target('a.exe', 'a')], { sleep: noSleep, pollIntervalMs: 1 });
  assert.equal(out.get(A).verdict, 'malicious');
  assert.equal(f.calls.find((c) => c.method === 'POST').init.body.get('file').name, 'a.exe');
  const g = mockFetch([
    ['GET', /reputation/, (u, i, n) => (n === 1 ? json({}, 404) : json({}))],
    ['GET', /\/scan\/bad\/report/, () => json({ job: { error: true, reason: 'rejected' } })],
    ['GET', /\/scan\/empty\/report/, () => json({ allFinished: true, reports: {} })],
  ]);
  const fs = filescan(opts(g, 'https://fs'));
  assert.deepEqual(await fs.lookup(target('a', 'a')), { state: 'unknown' });
  assert.deepEqual(await fs.lookup(target('a', 'a')), { state: 'unknown' });
  await assert.rejects(fs.poll(target('a', 'a'), { flowId: 'bad' }), /scan failed: rejected/);
  assert.deepEqual(await fs.poll(target('a', 'a'), { flowId: 'empty' }), { state: 'pending', handle: { flowId: 'empty' } });
  assert.deepEqual(await fs.poll(target('a', 'a'), {}), { state: 'pending', handle: {} });
  await assert.rejects(filescan(opts(mockFetch([['POST', /scan\/file/, () => json({})]]), 'https://fs')).upload(target('a', 'a')), /no flow id/);
  await assert.rejects(filescan(opts(mockFetch([['POST', /scan\/file/, () => json({}, 429)]]), 'https://fs')).upload(target('a', 'a')), /upload: HTTP 429/);
  await assert.rejects(filescan(opts(mockFetch([['GET', /reputation/, () => json({}, 401)]]), 'https://fs')).lookup(target('a', 'a')), /reputation: HTTP 401/);
  await assert.rejects(filescan(opts(mockFetch([['GET', /report/, () => json({}, 400)]]), 'https://fs')).poll(target('a', 'a'), { flowId: 'x' }), /scan report: HTTP 400/);
  await assert.rejects(filescan(opts(f, 'https://fs')).upload({ ...target('a', 'a'), read: () => ({ length: 200 * 1024 * 1024 }) }), /100 MB/);
  assert.deepEqual(filescan({}), { name: 'filescan', configured: false });
});

// --------------------------------------------------------------------- run

test('a run with every scanner: missing keys are "not configured" and the document validates', async () => {
  const f = mockFetch([
    ['GET', /vt\/files\/[0-9a-f]{64}$/, () => json({ data: { attributes: VT_ATTRS } })],
    ['GET', /behaviour_summary$/, () => json({ data: {} })],
    ['GET', /ot\/search\/hash/, () => json({ Zone: 'Green', FileGeneralInfo: { FileStatus: 'Clean' } })],
  ]);
  const doc = await runScans({
    targets: [target('a.exe', 'a')],
    scanners: [virusTotal(opts(f, 'https://vt')), kaspersky(opts(f, 'https://ot')), hybridAnalysis({}), triage({}), filescan({})],
    now: () => new Date('2026-10-22T04:00:00Z'),
    sleep: noSleep,
  });
  assert.deepEqual(validateScans(doc), []);
  assert.deepEqual(doc.scanners, { virustotal: 'configured', kaspersky: 'configured', hybridanalysis: 'not configured', triage: 'not configured', filescan: 'not configured' });
  const s = doc.files[0].scans;
  assert.equal(s.virustotal.flagged[0].heuristic, true);
  assert.equal(s.kaspersky.zone, 'Green');
  for (const k of ['hybridanalysis', 'triage', 'filescan']) assert.deepEqual(s[k], { status: 'not configured' });
});
