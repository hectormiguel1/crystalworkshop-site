// api/scans.json: the schema, its checks and the HTML helpers the Security
// page and the release cards use. Plain ES module without Node imports: the
// build, the browser and the scan workflow all load it.
//
// {
//   "schema": 1,
//   "generated": "2026-10-22T04:17:00.000Z" | null,   // null: placeholder, no scan yet
//   "scanners": { "virustotal": "configured" | "not configured", "metadefender": …, "kaspersky": …,
//                 "hybridanalysis": …, "triage": … },
//   "files": [{
//     "id": "pulsedepot-0-1-0-beta-windows-x86-64-zip-pulsedepot-exe",
//     "name": "pulsedepot.exe",                        // the file that was scanned
//     "container": "pulsedepot-0.1.0-beta-windows-x86_64.zip" | null,  // the download it is inside
//     "product": "pulsedepot", "version": "0.1.0-beta", "release": "pulsedepot-v0.1.0-beta",
//     "sha256": "…", "size": 22993408, "scanned_at": "…",   // when this file was last checked
//     "scans": {
//       "virustotal": { "status": "ok", "stats": { "malicious": 0, "suspicious": 0, "undetected": 60,
//                       "harmless": 0, "type-unsupported": 12 },
//                       "flagged": [{ "engine", "category", "result", "heuristic", "engine_version", "engine_update" }],
//                       "details": { "tags", "threat", "sandboxes", "yara", "sigma", "signature" } | absent,
//                       "behaviour": { "tags", "verdicts", "techniques", "signatures", "counts", "tactics" } | null | absent,
//                       "scanned_at": "…", "url": "…" },
//       "metadefender": { "status": "ok", "stats": { "detected": 0, "total": 21 }, "result": "No Threat Detected",
//                         "engines": [{ "engine": "…", "threat": null, "result": 0 }], "flagged": [],
//                         "scanned_at": "…", "url": "…" },
//       "kaspersky": { "status": "ok", "zone": "Green" | "Yellow" | "Red" | "Grey", "file_status": "Clean",
//                      "detections": [{ "name", "zone", "last_detected", "url" }], "scanned_at", "url" },
//       "hybridanalysis": { "status": "ok", "verdict": "no specific threat", "threat_score": 0..100 | null,
//                           "av_detect": 0..100 | null, "family", "environment", "tags", "scanned_at", "url" },
//       "triage": { "status": "ok", "score": 1..10 | null, "family": [], "tags": [], "signatures": [{ "name", "score" }],
//                   "scanned_at", "url" }
//     }
//   }]
// }
// A scan's status is "ok", "pending" (submitted, results not ready yet),
// "error" (with "error": short reason) or "not configured" (no API key).
// Every scanner field beyond "status", "url" and its verdict is optional, so
// documents written by earlier versions stay valid. Keys of retired scanners
// (RETIRED_SCANNERS) in older documents are ignored.

export const SCHEMA = 1;
export const SCANNERS = ['virustotal', 'metadefender', 'kaspersky', 'hybridanalysis', 'triage'];
/** Scanners no longer run: their keys in older documents are skipped, not errors. */
export const RETIRED_SCANNERS = ['filescan'];
export const SCANNER_NAMES = { virustotal: 'VirusTotal', metadefender: 'MetaDefender', kaspersky: 'Kaspersky', hybridanalysis: 'Hybrid Analysis', triage: 'Triage' };
/** Scanners shown on the release cards (when configured); the Security page shows all. */
export const CARD_SCANNERS = ['virustotal', 'metadefender', 'kaspersky'];
export const STATUSES = ['ok', 'pending', 'error', 'not configured'];
export const VT_STATS = ['malicious', 'suspicious', 'undetected', 'harmless', 'type-unsupported'];
export const KASPERSKY_ZONES = ['Green', 'Yellow', 'Red', 'Grey'];

const SHA = /^[0-9a-f]{64}$/;

export const vtReportUrl = (sha) => `https://www.virustotal.com/gui/file/${sha}`;
export const mdReportUrl = (sha) => `https://metadefender.com/results/hash/${sha}`;
export const kasperskyReportUrl = (sha) => `https://opentip.kaspersky.com/${sha}/`;
export const haReportUrl = (sha) => `https://hybrid-analysis.com/sample/${sha}`;
export const triageReportUrl = (id) => `https://tria.ge/${encodeURIComponent(id)}`;
export const triageSearchUrl = (sha) => `https://tria.ge/s?q=sha256%3A${sha}`;
export const filescanSearchUrl = (sha) => `https://www.filescan.io/search-result?query=${sha}`;

/** "Scan it yourself": where anyone can look a SHA-256 up, or upload the file. */
export const selfScanLinks = (sha) => [
  { name: 'VirusTotal', url: `https://www.virustotal.com/gui/search/${sha}` },
  { name: 'MetaDefender', url: mdReportUrl(sha) },
  { name: 'Kaspersky', url: kasperskyReportUrl(sha) },
  { name: 'Jotti', url: `https://virusscan.jotti.org/en-US/search/hash/${sha}` },
  { name: 'Hybrid Analysis', url: `https://www.hybrid-analysis.com/search?query=${sha}` },
  { name: 'Triage', url: triageSearchUrl(sha) },
  { name: 'Filescan.io', url: filescanSearchUrl(sha) },
];

/**
 * True for a verdict that comes from a machine-learning model or a reputation
 * guess rather than a signature: names ending in "!ml" (Microsoft Defender)
 * and hash labels like "ti!B68FC40ADD25" (McAfee).
 */
export const isHeuristic = (result) => typeof result === 'string' && (/!ml$/i.test(result.trim()) || /^ti![0-9a-f]+$/i.test(result.trim()));
export const HEURISTIC_NOTE = 'heuristic (machine-learning) — no signature match';

/** Stable anchor id for a file entry. */
export const fileId = (name, container = null) =>
  [container, name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** An empty document (what the site shows before the first scan). */
export const emptyScans = () => ({ schema: SCHEMA, generated: null, scanners: {}, files: [] });

const isCount = (n) => Number.isInteger(n) && n >= 0;
const isOptInt = (n, max) => n === null || n === undefined || (Number.isInteger(n) && n >= 0 && n <= max);

/** Problems with one "ok" scan of `name` (scanner-specific fields). */
function scanErrors(name, s, err) {
  if (name === 'virustotal' || name === 'metadefender') {
    const keys = name === 'virustotal' ? VT_STATS : ['detected', 'total'];
    for (const k of keys) if (!isCount(s.stats?.[k])) err(`stats.${k} must be a count`);
  } else if (name === 'kaspersky') {
    if (!KASPERSKY_ZONES.includes(s.zone)) err(`zone: ${s.zone}`);
  } else if (name === 'hybridanalysis') {
    if (s.verdict !== null && typeof s.verdict !== 'string') err('verdict must be a string or null');
    if (!isOptInt(s.threat_score, 100)) err('threat_score must be 0-100 or null');
  } else if (name === 'triage') {
    if (!isOptInt(s.score, 10)) err('score must be 0-10 or null');
  }
  for (const k of ['flagged', 'detections', 'engines', 'tags', 'signatures']) if (s[k] !== undefined && !Array.isArray(s[k])) err(`${k} must be a list`);
  if (s.details !== undefined && (typeof s.details !== 'object' || Array.isArray(s.details) || s.details === null)) err('details must be an object');
  if (s.behaviour !== undefined && s.behaviour !== null && (typeof s.behaviour !== 'object' || Array.isArray(s.behaviour))) err('behaviour must be an object or null');
}

/** Problems with a scans document: [] when it matches the schema. */
export function validateScans(doc) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!doc || typeof doc !== 'object') return ['not an object'];
  if (doc.schema !== SCHEMA) err(`schema must be ${SCHEMA}`);
  if (doc.generated !== null && Number.isNaN(Date.parse(doc.generated))) err('generated must be an ISO date or null');
  if (!doc.scanners || typeof doc.scanners !== 'object') err('scanners must be an object');
  else for (const [k, v] of Object.entries(doc.scanners)) if (!RETIRED_SCANNERS.includes(k) && (!SCANNERS.includes(k) || !['configured', 'not configured'].includes(v))) err(`scanners.${k}: ${v}`);
  if (!Array.isArray(doc.files)) return [...errors, 'files must be an array'];
  const ids = new Set();
  doc.files.forEach((f, i) => {
    const at = `files[${i}]`;
    for (const k of ['id', 'name', 'product', 'version', 'release']) if (typeof f[k] !== 'string' || !f[k]) err(`${at}.${k} must be a non-empty string`);
    if (f.container !== null && typeof f.container !== 'string') err(`${at}.container must be a string or null`);
    if (!SHA.test(f.sha256 || '')) err(`${at}.sha256 must be 64 lower-case hex digits`);
    if (!Number.isInteger(f.size) || f.size < 0) err(`${at}.size must be a byte count`);
    if (Number.isNaN(Date.parse(f.scanned_at))) err(`${at}.scanned_at must be an ISO date`);
    if (ids.has(f.id)) err(`${at}.id ${f.id} is not unique`);
    ids.add(f.id);
    if (!f.scans || typeof f.scans !== 'object') return err(`${at}.scans must be an object`);
    for (const [name, s] of Object.entries(f.scans)) {
      if (RETIRED_SCANNERS.includes(name)) continue;
      const sat = `${at}.scans.${name}`;
      if (!SCANNERS.includes(name)) err(`${sat}: unknown scanner`);
      if (!STATUSES.includes(s?.status)) err(`${sat}.status: ${s?.status}`);
      if (s?.status !== 'ok') continue;
      if (typeof s.url !== 'string' || !s.url.startsWith('https://')) err(`${sat}.url must be an https link`);
      if (s.scanned_at != null && Number.isNaN(Date.parse(s.scanned_at))) err(`${sat}.scanned_at must be an ISO date`);
      scanErrors(name, s, (m) => err(`${sat}.${m}`));
    }
  });
  return errors;
}

/** The document if it is usable (real scan data), else null. */
export function usableScans(doc) {
  return doc && doc.generated && Array.isArray(doc.files) && validateScans(doc).length === 0 ? doc : null;
}

/** { flagged, total, text } of a multi-engine scan, or null (no result, or not a count). */
export function ratio(scanner, scan) {
  if (!scan || scan.status !== 'ok' || !scan.stats) return null;
  if (scanner === 'virustotal') {
    const s = scan.stats;
    // As VirusTotal counts it: engines that gave a verdict (unsupported types and timeouts left out).
    const total = s.malicious + s.suspicious + s.undetected + s.harmless;
    return { flagged: s.malicious, suspicious: s.suspicious, total, text: `${s.malicious}/${total}` };
  }
  if (scanner === 'metadefender') return { flagged: scan.stats.detected, suspicious: 0, total: scan.stats.total, text: `${scan.stats.detected}/${scan.stats.total}` };
  return null;
}

const KASPERSKY_TEXT = { Green: ['clean', 'clean'], Yellow: ['adware or other', 'flagged'], Red: ['malware', 'flagged'], Grey: ['no verdict', 'none'] };
const HA_STATE = { 'no specific threat': 'clean', whitelisted: 'clean', suspicious: 'flagged', malicious: 'flagged' };

/** { text, state } of an "ok" scan (badge text without the scanner name), or null. */
export function verdict(scanner, scan) {
  if (!scan || scan.status !== 'ok') return null;
  const r = ratio(scanner, scan);
  if (r) return { text: r.text, state: r.flagged > 0 || r.suspicious > 0 ? 'flagged' : 'clean' };
  if (scanner === 'kaspersky') {
    const [text, state] = KASPERSKY_TEXT[scan.zone] || ['no verdict', 'none'];
    return { text, state };
  }
  if (scanner === 'hybridanalysis') return scan.verdict ? { text: scan.verdict, state: HA_STATE[scan.verdict] || 'none' } : { text: 'no verdict', state: 'none' };
  if (scanner === 'triage') {
    if (!Number.isInteger(scan.score)) return { text: 'no score', state: 'none' };
    // Triage: 1 nothing malicious, 2-5 likely benign, 6-7 suspicious, 8-9 likely malicious, 10 known bad.
    return { text: `${scan.score}/10`, state: scan.score >= 6 ? 'flagged' : 'clean' };
  }
  return null;
}

/** CSS state of a scan result: clean, flagged, pending, none. */
export function scanState(scanner, scan) {
  const v = verdict(scanner, scan);
  if (v) return v.state;
  return scan?.status === 'pending' ? 'pending' : 'none';
}

/** Short label for a badge: "VirusTotal 0/72", "Kaspersky: clean", "VirusTotal: in progress", … */
export function badgeText(scanner, scan) {
  const name = SCANNER_NAMES[scanner];
  const v = verdict(scanner, scan);
  if (v) {
    // Counts and scores read "VirusTotal 0/72", "Triage 1/10"; words read "Kaspersky: clean".
    const counted = ratio(scanner, scan) || (scanner === 'triage' && Number.isInteger(scan.score));
    return counted ? `${name} ${v.text}` : `${name}: ${v.text}`;
  }
  if (!scan) return `${name}: not scanned yet`;
  return { pending: `${name}: in progress`, error: `${name}: not available`, 'not configured': `${name}: not set up` }[scan.status] || `${name}: not scanned yet`;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** YYYY-MM-DD of an ISO date, or ''. */
export const day = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toISOString().slice(0, 10) : '');

/** One scanner badge (pill). With `href` it links (to the report, or the Security page). */
export function badgeHtml(scanner, scan, href = null) {
  const state = scanState(scanner, scan);
  const text = esc(badgeText(scanner, scan));
  const title = scan?.status === 'ok' && scan.scanned_at ? ` title="${esc(`Scanned ${day(scan.scanned_at)}`)}"` : '';
  return href ? `<a class="pill scan scan-${state}" href="${esc(href)}"${title}>${text}</a>` : `<span class="pill scan scan-${state}"${title}>${text}</span>`;
}

/** The scanners a release card shows: VirusTotal, plus the card scanners that are set up. */
export const cardScanners = (doc) => CARD_SCANNERS.filter((s) => s === 'virustotal' || doc?.scanners?.[s] === 'configured');

/** Badges for the release card of a download: the scan entries whose file or container is `file`. */
export function cardBadgesHtml(doc, file, securityHref) {
  const entry = doc?.files?.find((f) => f.name === file && !f.container);
  const link = entry ? `${securityHref}#${entry.id}` : securityHref;
  return entry ? cardScanners(doc).map((s) => badgeHtml(s, entry.scans?.[s], link)).join(' ') : `<a class="pill scan scan-none" href="${esc(securityHref)}">Not scanned yet</a>`;
}

const list = (a, n = 6) => (Array.isArray(a) ? a.filter((x) => x !== null && x !== undefined && x !== '').slice(0, n) : []);
const join = (a) => esc(a.join(', '));

/** One flagged engine: "Engine (Result)", with the heuristic note and engine version when known. */
function flaggedText(f) {
  const bits = [];
  if (f.result) bits.push(f.result);
  if (f.heuristic || isHeuristic(f.result)) bits.push(HEURISTIC_NOTE);
  const ver = [f.engine_version && `engine ${f.engine_version}`, f.engine_update && `updated ${f.engine_update}`].filter(Boolean).join(', ');
  if (ver) bits.push(ver);
  return bits.length ? `${f.engine} (${bits.join('; ')})` : f.engine;
}

function engines(scan) {
  const names = list(scan?.flagged, 20).map(flaggedText);
  return names.length ? `<span class="scan-engines">Flagged by ${esc(names.join(', '))}</span>` : '';
}

/** Extra lines under a scanner's badge (scanner-specific). */
function notes(scanner, scan) {
  if (scan?.status !== 'ok') return '';
  const out = [];
  const line = (label, value) => value && out.push(`<span class="scan-engines">${esc(label)}: ${value}</span>`);
  if (scanner === 'kaspersky') {
    const d = list(scan.detections, 6).map((x) => x.name).filter(Boolean);
    line('Detected as', d.length && join(d));
  } else if (scanner === 'hybridanalysis') {
    line('Threat score', Number.isInteger(scan.threat_score) && `${scan.threat_score}/100`);
    line('Family', scan.family && esc(scan.family));
    line('Sandbox', scan.environment && esc(scan.environment));
  } else if (scanner === 'triage') {
    line('Family', list(scan.family).length && join(list(scan.family)));
    const sig = list(scan.signatures, 4).map((s) => s.name).filter(Boolean);
    line('Behaviour', sig.length && join(sig));
  }
  return out.join('');
}

/** "More from VirusTotal": threat label, sandboxes, YARA and Sigma rules, signature, behaviour. */
function vtMore(scan) {
  const d = scan?.details;
  const b = scan?.behaviour;
  if (scan?.status !== 'ok' || (!d && !b)) return '';
  const rows = [];
  const row = (label, html) => html && rows.push(`<li><span class="scan-more-k">${esc(label)}</span> ${html}</li>`);
  if (d) {
    row('Threat label', d.threat?.label && esc(d.threat.label));
    row('Tags', list(d.tags, 12).length && join(list(d.tags, 12)));
    const sb = list(d.sandboxes, 8).map((s) => `${s.sandbox}: ${s.category || 'no verdict'}${list(s.names).length ? ` (${list(s.names).join(', ')})` : ''}`);
    row('Sandbox verdicts', sb.length && join(sb));
    const yara = list(d.yara, 8).map((y) => y.rule);
    row('Crowdsourced YARA rules', yara.length ? join(yara) : 'none matched');
    if (d.sigma) {
      const st = d.sigma.stats;
      const counts = st ? ['critical', 'high', 'medium', 'low'].map((k) => `${k} ${Number(st[k]) || 0}`).join(' · ') : '';
      const titles = list(d.sigma.rules, 6).map((r) => r.title);
      row('Sigma rules', [counts, titles.length ? join(titles) : ''].filter(Boolean).join(' — ') || 'none matched');
    }
    if (d.signature !== undefined) {
      const s = d.signature;
      row('Code signature', s ? esc([s.verified, s.signers, s.product, s.file_version && `version ${s.file_version}`].filter(Boolean).join(' · ') || 'version information only') : 'not signed');
    }
  }
  if (b) {
    const tech = list(b.techniques, 8).map((t) => `${t.id}${t.description ? ` ${t.description}` : ''}`);
    row('MITRE ATT&CK techniques', tech.length && join(tech));
    const tac = list(b.tactics, 8).map((t) => `${t.name || t.id} (${list(t.techniques, 20).length})`);
    row('MITRE ATT&CK tactics', tac.length && join(tac));
    const sig = list(b.signatures, 6).map((s) => s.name);
    row('Behaviour rules', sig.length && join(sig));
    row('Behaviour tags', list(b.tags, 10).length && join(list(b.tags, 10)));
    const c = b.counts || {};
    const counts = [['processes started', c.processes_created], ['files written', c.files_written], ['registry values set', c.registry_keys_set], ['DNS lookups', c.dns_lookups], ['network connections', c.ip_traffic]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}`);
    row('Sandbox activity', counts.length && esc(counts.join(', ')));
  }
  return rows.length ? `<details class="scan-more"><summary>More from VirusTotal</summary><ul>${rows.join('')}</ul></details>` : '';
}

function scannerCell(scanner, scan) {
  const report = scan?.status === 'ok' && scan.url ? ` <a href="${esc(scan.url)}" rel="noopener">Report</a>` : '';
  return `<div class="scan-result"><dt>${SCANNER_NAMES[scanner]}</dt><dd>${badgeHtml(scanner, scan)}${report}${engines(scan)}${notes(scanner, scan)}</dd></div>`;
}

/** HTML of one file on the Security page. `names`: product id -> display name. */
export function fileHtml(f, names = {}) {
  const links = selfScanLinks(f.sha256)
    .map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.name)}</a>`)
    .join(' · ');
  const inside = f.container ? `<p class="scan-inside">Inside <code>${esc(f.container)}</code></p>` : '';
  const dates = SCANNERS.map((s) => f.scans?.[s]?.scanned_at).filter(Boolean).sort();
  const when = dates.length ? day(dates[dates.length - 1]) : '';
  return `<article class="scan-file" id="${esc(f.id)}">
<header class="scan-head"><h3><code>${esc(f.name)}</code></h3><p class="scan-meta"><span class="rc-version">v${esc(f.version)}</span><span class="pill kind">${esc(names[f.product] ?? f.product)}</span>${f.size ? `<span>${esc(sizeText(f.size))}</span>` : ''}</p>${inside}</header>
<dl class="scan-facts">
<div class="scan-sha"><dt>SHA-256</dt><dd><code class="sha">${esc(f.sha256)}</code><button type="button" class="copy-btn" data-copy="${esc(f.sha256)}" aria-label="Copy the SHA-256 of ${esc(f.name)}">Copy</button></dd></div>
${SCANNERS.map((s) => scannerCell(s, f.scans?.[s])).join('\n')}
<div><dt>Scan date</dt><dd>${when ? `<time datetime="${esc(when)}">${esc(when)}</time>` : 'Not scanned yet'}</dd></div>
</dl>
${vtMore(f.scans?.virustotal)}
<p class="scan-self"><span>Scan it yourself:</span> ${links}</p>
</article>`;
}

export function sizeText(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/** HTML of every file, grouped by product in `order` (ids), then the rest. */
export function filesHtml(files, names = {}, order = []) {
  const groups = new Map();
  for (const id of order) groups.set(id, []);
  for (const f of files) {
    if (!groups.has(f.product)) groups.set(f.product, []);
    groups.get(f.product).push(f);
  }
  return [...groups]
    .filter(([, list]) => list.length)
    .map(([id, list]) => `<section class="scan-group"><h2 id="scans-${esc(id)}">${esc(names[id] ?? id)}</h2><div class="scan-list">${list.map((f) => fileHtml(f, names)).join('\n')}</div></section>`)
    .join('\n');
}

/**
 * The files to list when there are no scan results yet: every download from
 * the release data (one entry per distinct file) with no scans.
 */
export function fallbackFiles(releases) {
  const seen = new Set();
  const out = [];
  const add = (i, name, sha256, size, container = null) => {
    if (!sha256 || seen.has(sha256)) return;
    seen.add(sha256);
    out.push({ id: fileId(name, container), name, container, product: i.id, version: i.version, release: i.tag, sha256, size, scanned_at: null, scans: {} });
  };
  for (const i of [...(releases.products || []), ...(releases.mods || [])]) {
    if (!i.bundledWith) for (const os of ['windows', 'linux']) if (i.platforms?.[os]) add(i, i.platforms[os].file, i.platforms[os].sha256, i.platforms[os].bytes);
    for (const b of i.builds || []) add(i, b.file, b.sha256, b.bytes);
  }
  return out;
}
