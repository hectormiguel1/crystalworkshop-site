#!/usr/bin/env node
// Virus scans of the published downloads, run by the public repository's
// scans workflow:
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=OWNER/REPO VT_API_KEY=… METADEFENDER_API_KEY=… \
//   KASPERSKY_OPENTIP_KEY=… HYBRID_ANALYSIS_KEY=… TRIAGE_API_KEY=… \
//     node scripts/scans/main.mjs public/api/scans.json
// A missing API key skips that service ("not configured"). It always exits 0:
// on any failure it keeps the existing file and prints a warning.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { APPS, downloadAsset, latestReleases, listReleases, scannableAssets, targetsOf } from './collect.mjs';
import { hybridAnalysis } from './hybridanalysis.mjs';
import { kaspersky } from './kaspersky.mjs';
import { metaDefender } from './metadefender.mjs';
import { validateScans } from './model.mjs';
import { runScans } from './run.mjs';
import { triage } from './triage.mjs';
import { virusTotal } from './virustotal.mjs';

const out = path.resolve(process.argv[2] || 'public/api/scans.json');
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const log = (m) => console.log(m);

function readPrevious() {
  try {
    return existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : null;
  } catch {
    return null;
  }
}

async function main() {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.log('::warning::GITHUB_REPOSITORY is not set: nothing scanned');
    return;
  }
  const env = process.env;
  const scanners = [
    virusTotal({ apiKey: env.VT_API_KEY }),
    metaDefender({ apiKey: env.METADEFENDER_API_KEY }),
    kaspersky({ apiKey: env.KASPERSKY_OPENTIP_KEY }),
    hybridAnalysis({ apiKey: env.HYBRID_ANALYSIS_KEY }),
    triage({ apiKey: env.TRIAGE_API_KEY }),
  ];
  for (const s of scanners) if (!s.configured) console.log(`::notice::${s.name}: no API key secret, skipped (recorded as "not configured")`);

  const releases = latestReleases(await listReleases(fetch, { repo, token, api }));
  const rank = (id) => (APPS.includes(id) ? APPS.indexOf(id) : APPS.length);
  releases.sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
  const targets = [];
  for (const rel of releases) {
    for (const asset of scannableAssets(rel)) {
      try {
        const bytes = await downloadAsset(fetch, asset, { token });
        const found = targetsOf(rel, asset.name, bytes);
        targets.push(...found);
        log(`${rel.tag}: ${asset.name} (${found.length - 1} files inside)`);
      } catch (e) {
        console.log(`::warning::${rel.tag}: ${e.message}`);
      }
    }
  }
  if (!targets.length) {
    console.log('::warning::no release files found: scans file left as it was');
    return;
  }
  const doc = await runScans({ targets, scanners, previous: readPrevious(), log });
  const problems = validateScans(doc);
  if (problems.length) {
    console.log(`::warning::scan results do not match the schema, not written: ${problems.slice(0, 5).join('; ')}`);
    return;
  }
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  const count = (st) => doc.files.reduce((n, f) => n + Object.values(f.scans).filter((s) => s.status === st).length, 0);
  console.log(`scans: ${doc.files.length} files, ${count('ok')} results, ${count('pending')} pending, ${count('error')} errors -> ${out}`);
}

main().catch((e) => console.log(`::warning::scans failed: ${e.message}`));
