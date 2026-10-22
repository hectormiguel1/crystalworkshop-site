#!/usr/bin/env node
// Checks every internal link, image and script reference of the built site,
// including #fragments on other pages. Usage: node scripts/check-links.mjs [DIST]
// (default: the build output from astro.config.mjs). BASE_PATH as for the build.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.argv[2] || process.env.SITE_OUT_DIR || (existsSync(path.join(SITE, '../xtask')) ? path.join(SITE, '../dist/site') : path.join(SITE, 'dist')));
const base = (process.env.BASE_PATH || '/').replace(/\/?$/, '/');

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(p);
  }
})(dist);
const html = files.filter((f) => f.endsWith('.html'));
const ids = new Map();
const idsOf = (file) => {
  if (!ids.has(file)) {
    const s = readFileSync(file, 'utf8');
    ids.set(file, new Set([...s.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return ids.get(file);
};

function target(urlPath) {
  let p = decodeURIComponent(urlPath);
  if (!p.startsWith(base)) return null;
  p = p.slice(base.length);
  const file = path.join(dist, p);
  if (p === '' || p.endsWith('/')) return path.join(file, 'index.html');
  if (existsSync(file) && statSync(file).isFile()) return file;
  if (existsSync(path.join(file, 'index.html'))) return path.join(file, 'index.html');
  return file;
}

const broken = [];
let checked = 0;
for (const file of html) {
  const s = readFileSync(file, 'utf8');
  const pageUrl = `${base}${path.relative(dist, file).split(path.sep).join('/').replace(/index\.html$/, '')}`;
  const refs = [];
  for (const m of s.matchAll(/\s(?:href|src)="([^"]*)"/g)) refs.push(m[1]);
  for (const m of s.matchAll(/\ssrcset="([^"]*)"/g)) for (const part of m[1].split(',')) refs.push(part.trim().split(/\s+/)[0]);
  for (const raw of refs) {
    const ref = raw.replace(/&amp;/g, '&');
    if (!ref || /^(https?:|mailto:|data:|javascript:|blob:)/i.test(ref) || /\{\{|%7B%7B/i.test(ref)) continue;
    const u = new URL(ref, `https://site.invalid${pageUrl}`);
    if (u.host !== 'site.invalid') continue;
    checked++;
    const t = target(u.pathname);
    if (!t || !existsSync(t)) {
      broken.push(`${path.relative(dist, file)}: ${raw}`);
      continue;
    }
    if (u.hash && t.endsWith('.html') && u.hash.length > 1) {
      const id = decodeURIComponent(u.hash.slice(1));
      if (!idsOf(t).has(id)) broken.push(`${path.relative(dist, file)}: ${raw} (no #${id})`);
    }
  }
}
console.log(`${html.length} pages, ${checked} internal references checked, ${broken.length} broken`);
for (const b of broken) console.log(`  BROKEN ${b}`);
process.exit(broken.length ? 1 : 0);
