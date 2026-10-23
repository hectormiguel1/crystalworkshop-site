#!/usr/bin/env node
// Screenshots of the built site with an installed Chromium (playwright-core
// downloads no browser). Also logs console errors and basic page checks.
// Usage: CHROME=/usr/bin/chromium node scripts/site-screenshots.mjs OUT_DIR [DIST]
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || 'site-shots');
const dist = path.resolve(process.argv[3] || (existsSync(path.join(SITE, '../xtask')) ? path.join(SITE, '../dist/site') : path.join(SITE, 'dist')));
const chrome = process.env.CHROME || ['/usr/bin/chromium', '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find(existsSync);
if (!chrome) {
  console.log('no Chromium found: skipping screenshots');
  process.exit(0);
}
mkdirSync(out, { recursive: true });

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.ico': 'image/x-icon' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(dist, p);
  if (existsSync(f) && statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!existsSync(f)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' }).end(readFileSync(f));
}).listen(0);
const port = server.address().port;
const url = (p) => `http://127.0.0.1:${port}${p}`;

const shots = [
  ['home-dark', '/', { width: 1440, height: 900 }, 'dark', true],
  ['home-light', '/', { width: 1440, height: 900 }, 'light', false],
  ['downloads', '/downloads/', { width: 1440, height: 900 }, 'dark', false],
  ['guide-pulsedepot-first-setup', '/pulsedepot/first-setup/', { width: 1440, height: 900 }, 'dark', false],
  ['guide-first-mod-edit', '/crystalworkshop/first-mod/make-an-edit/', { width: 1440, height: 900 }, 'light', false],
  ['changelog', '/changelog/', { width: 1440, height: 900 }, 'dark', false],
  ['feature-status', '/crystalworkshop/feature-status/', { width: 1440, height: 900 }, 'dark', false],
  ['mod-page', '/mods/hard-mode/', { width: 1440, height: 900 }, 'dark', true],
  ['roadmap', '/roadmap/', { width: 1440, height: 900 }, 'dark', true],
  ['guide-cw-installing', '/crystalworkshop/installing/', { width: 1440, height: 900 }, 'dark', true],
  ['guide-cw-glossary', '/crystalworkshop/glossary/', { width: 1440, height: 900 }, 'light', false],
  ['third-party', '/legal/third-party/', { width: 1440, height: 900 }, 'dark', false],
  ['security-dark', '/security/', { width: 1440, height: 900 }, 'dark', true],
  ['security-light', '/security/', { width: 1440, height: 900 }, 'light', true],
  ['mobile-home', '/', { width: 390, height: 844 }, 'dark', true],
  ['mobile-home-light', '/', { width: 390, height: 844 }, 'light', false],
  ['mobile-security', '/security/', { width: 390, height: 844 }, 'dark', false],
  ['mobile-downloads', '/downloads/', { width: 390, height: 844 }, 'dark', false],
];

const browser = await chromium.launch({ executablePath: chrome, headless: true });
const problems = [];
for (const [name, p, viewport, theme, full] of shots) {
  const ctx = await browser.newContext({ viewport, colorScheme: theme, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => m.type() === 'error' && problems.push(`${name}: console ${m.text()}`));
  page.on('pageerror', (e) => problems.push(`${name}: ${e.message}`));
  await page.addInitScript((t) => localStorage.setItem('starlight-theme', t), theme);
  await page.goto(url(p), { waitUntil: 'networkidle' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (overflow > 1) problems.push(`${name}: horizontal overflow ${overflow}px`);
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: full });
  console.log(`wrote ${name}.png`);
  await ctx.close();
}

// Interactions: filter the changelog, copy a checksum, open the lightbox.
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'dark', permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`interactions: ${e.message}`));
await page.goto(url('/changelog/?product=hard-mode'), { waitUntil: 'networkidle' });
const visible = await page.locator('.tl-entry:visible').count();
if (visible !== 1) problems.push(`changelog filter: ${visible} entries for one product`);
await page.screenshot({ path: path.join(out, 'changelog-filtered.png') });
await page.goto(url('/downloads/'), { waitUntil: 'networkidle' });
await page.locator('.copy-btn').first().click();
const copied = await page.evaluate(() => navigator.clipboard.readText());
if (!/^[0-9a-f]{64}$/.test(copied)) problems.push(`copy button copied ${JSON.stringify(copied)}`);
await page.goto(url('/pulsedepot/first-setup/'), { waitUntil: 'networkidle' });
await page.locator('.sl-markdown-content img').first().click();
await page.waitForTimeout(300);
if (!(await page.locator('dialog.lightbox[open]').count())) problems.push('lightbox did not open');
await page.screenshot({ path: path.join(out, 'lightbox.png') });

// Status widgets with sample data (served in place of api/*.json).
const now = new Date().toISOString();
const sample = (n, title, product, status, milestone, fixedIn) => ({ number: n, title, product, status, milestone, fixedIn, updated: now, url: `https://github.com/OWNER/REPO/issues/${n}` });
const issues = [
  sample(12, 'Sample: enemy HP multiplier ignored after a retry', 'hard-mode', 'in-progress', 'Hard Mode 0.1.1', null),
  sample(9, 'Sample: remember the last game folder', 'pulsedepot', 'planned', 'PulseDepot 0.2.0', null),
  sample(7, 'Sample: Crux log rotates too early', 'crux', 'triaged', null, null),
  sample(4, 'Sample: settings page typo', 'hard-mode', 'fixed', 'Hard Mode 0.1.0', '0.1.0'),
];
await page.route('**/api/status.json', (r) => r.fulfill({ json: { generated: now, issues } }));
await page.route('**/api/roadmap.json', (r) =>
  r.fulfill({ json: { generated: now, milestones: [{ title: 'Hard Mode 0.1.1', due: '2026-11-15', state: 'open', url: null, issues: [12] }, { title: 'PulseDepot 0.2.0', due: null, state: 'open', url: null, issues: [9] }], unscheduled: [7] } }),
);
await page.goto(url('/roadmap/'), { waitUntil: 'networkidle' });
if ((await page.locator('[data-roadmap] .st-issue').count()) < 4) problems.push('roadmap sample did not render');
await page.screenshot({ path: path.join(out, 'roadmap-sample.png'), fullPage: true });
await page.goto(url('/mods/hard-mode/'), { waitUntil: 'networkidle' });
if (!(await page.locator('.rc-fixed:not([hidden]) .st-issue').count())) problems.push('fixed-in list did not render');
await page.screenshot({ path: path.join(out, 'mod-page-fixed-sample.png') });

// Virus scan results with sample data (served in place of api/scans.json).
const rel = JSON.parse(readFileSync(path.join(SITE, 'src/data/releases.json'), 'utf8'));
const pd = rel.products.find((p) => p.id === 'pulsedepot');
const crux = rel.products.find((p) => p.id === 'crux');
const vt = (sha, malicious = 0, flagged = []) => ({ status: 'ok', stats: { malicious, suspicious: 0, undetected: 68 - malicious, harmless: 0, 'type-unsupported': 4 }, flagged, scanned_at: now, url: `https://www.virustotal.com/gui/file/${sha}` });
const md = (sha) => ({ status: 'ok', stats: { detected: 0, total: 21 }, result: 'No Threat Detected', engines: [], flagged: [], scanned_at: now, url: `https://metadefender.com/results/hash/${sha}` });
const entry = (id, name, container, product, version, sha256, size, scans) => ({ id, name, container, product, version, release: `${product}-v${version}`, sha256, size, scanned_at: now, scans });
const w = pd.platforms.windows;
const ver = crux.builds.find((b) => b.file === 'version.dll');
const scansDoc = {
  schema: 1,
  generated: now,
  scanners: { virustotal: 'configured', metadefender: 'configured' },
  files: [
    entry('pd-win', w.file, null, 'pulsedepot', pd.version, w.sha256, w.bytes, { virustotal: vt(w.sha256), metadefender: md(w.sha256) }),
    entry('pd-win-ver', 'version.dll', w.file, 'pulsedepot', pd.version, ver.sha256, ver.bytes, { virustotal: vt(ver.sha256, 2, [{ engine: 'SampleEngine', category: 'malicious', result: 'Heur.Generic' }]), metadefender: { status: 'pending' } }),
  ],
};
await page.route('**/api/scans.json', (r) => r.fulfill({ json: scansDoc }));
await page.goto(url('/security/'), { waitUntil: 'networkidle' });
if ((await page.locator('[data-scans] .scan-file').count()) !== 2) problems.push('scans sample did not render');
await page.screenshot({ path: path.join(out, 'security-sample.png'), fullPage: true });
await page.goto(url('/downloads/'), { waitUntil: 'networkidle' });
if (!(await page.locator('.scan-badges .scan-clean').count())) problems.push('release card scan badge did not render');
await page.locator('#pulsedepot').screenshot({ path: path.join(out, 'release-card-scan-badge.png') });
await ctx.close();
await browser.close();
server.close();
console.log(problems.length ? `problems:\n  ${problems.join('\n  ')}` : 'no console errors, no horizontal overflow, interactions OK');
