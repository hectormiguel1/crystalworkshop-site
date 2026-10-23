// api/scans.json: the schema, its checks and the HTML helpers the Security
// page and the release cards use. Plain ES module without Node imports: the
// build, the browser and the scan workflow all load it.
//
// {
//   "schema": 1,
//   "generated": "2026-10-22T04:17:00.000Z" | null,   // null: placeholder, no scan yet
//   "scanners": { "virustotal": "configured" | "not configured", "metadefender": … },
//   "files": [{
//     "id": "pulsedepot-0-1-0-beta-windows-x86-64-zip-pulsedepot-exe",
//     "name": "pulsedepot.exe",                        // the file that was scanned
//     "container": "pulsedepot-0.1.0-beta-windows-x86_64.zip" | null,  // the download it is inside
//     "product": "pulsedepot", "version": "0.1.0-beta", "release": "pulsedepot-v0.1.0-beta",
//     "sha256": "…", "size": 22993408, "scanned_at": "…",   // when this file was last checked
//     "scans": {
//       "virustotal": { "status": "ok", "stats": { "malicious": 0, "suspicious": 0, "undetected": 60,
//                       "harmless": 0, "type-unsupported": 12 }, "flagged": [], "scanned_at": "…", "url": "…" },
//       "metadefender": { "status": "ok", "stats": { "detected": 0, "total": 21 }, "result": "No Threat Detected",
//                         "engines": [{ "engine": "…", "threat": null, "result": 0 }], "flagged": [],
//                         "scanned_at": "…", "url": "…" }
//     }
//   }]
// }
// A scan's status is "ok", "pending" (submitted, results not ready yet),
// "error" (with "error": short reason) or "not configured" (no API key).

export const SCHEMA = 1;
export const SCANNERS = ['virustotal', 'metadefender'];
export const SCANNER_NAMES = { virustotal: 'VirusTotal', metadefender: 'MetaDefender' };
export const STATUSES = ['ok', 'pending', 'error', 'not configured'];
export const VT_STATS = ['malicious', 'suspicious', 'undetected', 'harmless', 'type-unsupported'];

const SHA = /^[0-9a-f]{64}$/;

export const vtReportUrl = (sha) => `https://www.virustotal.com/gui/file/${sha}`;
export const mdReportUrl = (sha) => `https://metadefender.com/results/hash/${sha}`;

/** "Scan it yourself": where anyone can look a SHA-256 up, or upload the file. */
export const selfScanLinks = (sha) => [
  { name: 'VirusTotal', url: `https://www.virustotal.com/gui/search/${sha}` },
  { name: 'MetaDefender', url: mdReportUrl(sha) },
  { name: 'Jotti', url: `https://virusscan.jotti.org/en-US/search/hash/${sha}` },
  { name: 'Hybrid Analysis', url: `https://www.hybrid-analysis.com/search?query=${sha}` },
];

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

/** Problems with a scans document: [] when it matches the schema. */
export function validateScans(doc) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!doc || typeof doc !== 'object') return ['not an object'];
  if (doc.schema !== SCHEMA) err(`schema must be ${SCHEMA}`);
  if (doc.generated !== null && Number.isNaN(Date.parse(doc.generated))) err('generated must be an ISO date or null');
  if (!doc.scanners || typeof doc.scanners !== 'object') err('scanners must be an object');
  else for (const [k, v] of Object.entries(doc.scanners)) if (!SCANNERS.includes(k) || !['configured', 'not configured'].includes(v)) err(`scanners.${k}: ${v}`);
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
      const sat = `${at}.scans.${name}`;
      if (!SCANNERS.includes(name)) err(`${sat}: unknown scanner`);
      if (!STATUSES.includes(s?.status)) err(`${sat}.status: ${s?.status}`);
      if (s?.status !== 'ok') continue;
      if (typeof s.url !== 'string' || !s.url.startsWith('https://')) err(`${sat}.url must be an https link`);
      if (s.scanned_at !== null && Number.isNaN(Date.parse(s.scanned_at))) err(`${sat}.scanned_at must be an ISO date`);
      const keys = name === 'virustotal' ? VT_STATS : ['detected', 'total'];
      for (const k of keys) if (!Number.isInteger(s.stats?.[k]) || s.stats[k] < 0) err(`${sat}.stats.${k} must be a count`);
    }
  });
  return errors;
}

/** The document if it is usable (real scan data), else null. */
export function usableScans(doc) {
  return doc && doc.generated && Array.isArray(doc.files) && validateScans(doc).length === 0 ? doc : null;
}

/** { flagged, total, text } of one scan, or null when there is no result. */
export function ratio(scanner, scan) {
  if (!scan || scan.status !== 'ok' || !scan.stats) return null;
  if (scanner === 'virustotal') {
    const s = scan.stats;
    // As VirusTotal counts it: engines that gave a verdict (unsupported types and timeouts left out).
    const total = s.malicious + s.suspicious + s.undetected + s.harmless;
    return { flagged: s.malicious, suspicious: s.suspicious, total, text: `${s.malicious}/${total}` };
  }
  return { flagged: scan.stats.detected, suspicious: 0, total: scan.stats.total, text: `${scan.stats.detected}/${scan.stats.total}` };
}

/** CSS state of a scan result: clean, flagged, pending, none. */
export function scanState(scanner, scan) {
  const r = ratio(scanner, scan);
  if (r) return r.flagged > 0 || r.suspicious > 0 ? 'flagged' : 'clean';
  return scan?.status === 'pending' ? 'pending' : 'none';
}

/** Short label for a badge: "VirusTotal 0/72", "VirusTotal: in progress", … */
export function badgeText(scanner, scan) {
  const name = SCANNER_NAMES[scanner];
  const r = ratio(scanner, scan);
  if (r) return `${name} ${r.text}`;
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

/** Badges for the release card of a download: the scan entries whose file or container is `file`. */
export function cardBadgesHtml(doc, file, securityHref) {
  const entry = doc?.files?.find((f) => f.name === file && !f.container);
  const link = entry ? `${securityHref}#${entry.id}` : securityHref;
  const badges = entry ? SCANNERS.map((s) => badgeHtml(s, entry.scans?.[s], link)).join(' ') : `<a class="pill scan scan-none" href="${esc(securityHref)}">Not scanned yet</a>`;
  return badges;
}

function engines(scan) {
  const names = (scan?.flagged || []).map((f) => (f.result ? `${f.engine} (${f.result})` : f.engine));
  return names.length ? `<span class="scan-engines">Flagged by ${esc(names.join(', '))}</span>` : '';
}

function scannerCell(scanner, scan) {
  const report = scan?.status === 'ok' && scan.url ? ` <a href="${esc(scan.url)}" rel="noopener">Report</a>` : '';
  return `<div class="scan-result"><dt>${SCANNER_NAMES[scanner]}</dt><dd>${badgeHtml(scanner, scan)}${report}${engines(scan)}</dd></div>`;
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
