#!/usr/bin/env node
// Scans the built site's text files for terms that must not appear on the
// public site (internal names, dev history, local paths). Hits inside files
// listed in JUSTIFIED are reported separately with the reason; any other hit
// fails. Usage: node scripts/check-terms.mjs [DIST]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HASHED_TERMS, hashedHits } from './lib/terms.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.resolve(process.argv[2] || process.env.SITE_OUT_DIR || (existsSync(path.join(SITE, '../xtask')) ? path.join(SITE, '../dist/site') : path.join(SITE, 'dist')));

// Generic dev terms, in plain text. Names of people and of their tools are
// matched by hash (scripts/lib/terms.mjs) so they never appear in this repo.
const TERMS = [
  /party-ai/gi,
  /ghidra/gi,
  /0x[0-9a-f]{6}/gi,
  /\bcrates?\b/gi,
  /ff13-ext/gi,
  /\blanes?\b/gi,
  /coverage/gi,
  /layeredfs/gi,
  /ff13 studio/gi,
  /app\.ron/gi,
  /\/home\//gi,
];

// Terms that are ordinary vocabulary on some pages: [path, term, reason].
// Only the listed term is allowed there; every other term still fails.
const ALLOWED = [
  [/^sdk\//, /\bcrates?\b/i, 'Rust packaging vocabulary (crate, crate-type) in the extension SDK developer guide'],
];

// Verbatim legal texts: they must match what ships in the packages.
const JUSTIFIED = [
  [/^legal\/(crystalworkshop|pulsedepot)-(windows|linux)\.txt$/, 'verbatim THIRD-PARTY-NOTICES.txt of a package (upstream licence texts and source URLs)'],
  [/^legal\/mod-[\w-]+\.txt$/, 'verbatim THIRD-PARTY-NOTICES.txt of a mod (names the open-source extension SDK it is built from)'],
  [/^legal\/index\.html$/, 'verbatim LICENSE text as shipped (names the open-source extension SDK)'],
  [/^legal\/third-party\/index\.html$/, 'third-party component names and upstream source URLs, as in the shipped notices'],
  [/^pagefind\/pagefind(-worker)?\.js$/, 'Pagefind search library code (a "coverage" ranking field)'],
];

const files = [];
(function walk(d) {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(html|js|mjs|css|json|txt|xml|svg|webmanifest)$/i.test(f)) files.push(p);
  }
})(dist);

const failures = [];
const justified = new Map();
const cache = new Map();
for (const file of files) {
  const rel = path.relative(dist, file).split(path.sep).join('/');
  const text = readFileSync(file, 'utf8');
  const hits = [];
  for (const re of TERMS) for (const m of text.matchAll(re)) hits.push({ index: m.index, text: m[0], key: m[0].toLowerCase() });
  for (const h of hashedHits(text, HASHED_TERMS, cache, { stripTags: /\.(html|svg|xml)$/i.test(rel) })) hits.push({ index: h.index, text: h.text, key: `banned name #${h.term + 1}` });
  for (const h of hits) {
    if (ALLOWED.some(([r, term]) => r.test(rel) && term.test(h.text))) continue;
    const why = JUSTIFIED.find(([r]) => r.test(rel));
    if (why) {
      const cur = justified.get(rel) || { why: why[1], hits: new Map() };
      cur.hits.set(h.key, (cur.hits.get(h.key) || 0) + 1);
      justified.set(rel, cur);
    } else {
      const ctx = text.slice(Math.max(0, h.index - 50), h.index + h.text.length + 50).replace(/\s+/g, ' ');
      failures.push(`${rel}: "${h.text}" … ${ctx}`);
    }
  }
}
console.log(`${files.length} text files scanned for ${TERMS.length + HASHED_TERMS.length} banned terms`);
console.log(`${failures.length} unjustified hits`);
for (const f of failures) console.log(`  HIT ${f}`);
console.log(`${justified.size} files with justified hits`);
for (const [f, { why, hits }] of justified) console.log(`  ${f}: ${[...hits].map(([t, n]) => `${t}×${n}`).join(', ')} (${why})`);
process.exit(failures.length ? 1 : 0);
