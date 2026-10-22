#!/usr/bin/env node
// Writes api/status.json and api/roadmap.json from the repository's issues and
// milestones (read with the workflow's GITHUB_TOKEN). Run by the status and
// Pages workflows of the public repository, after the site build:
//   GITHUB_TOKEN=… GITHUB_REPOSITORY=OWNER/REPO node scripts/status.mjs dist/api
// When the API cannot be read it writes nothing and exits 0: the site then
// shows its "status not available" state instead of failing the deploy.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { optionIndex } from './lib/feedback.mjs';
import { buildStatus } from './lib/status.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(SITE, 'dist/api'));
const repo = process.env.GITHUB_REPOSITORY;
const api = (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
const server = (process.env.GITHUB_SERVER_URL || 'https://github.com').replace(/\/$/, '');
const MAX_PAGES = 30;

async function all(route) {
  const items = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = route.includes('?') ? '&' : '?';
    const res = await fetch(`${api}/repos/${repo}/${route}${sep}per_page=100&page=${page}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
    const batch = await res.json();
    items.push(...batch);
    if (batch.length < 100) break;
  }
  return items;
}

async function main() {
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.log('::warning::GITHUB_REPOSITORY is not set: no status files written');
    return;
  }
  const releasesFile = path.join(SITE, 'src/data/releases.json');
  const options = existsSync(releasesFile) ? optionIndex(JSON.parse(readFileSync(releasesFile, 'utf8'))) : {};
  let issues;
  let milestones;
  try {
    [issues, milestones] = await Promise.all([all('issues?state=all&sort=updated&direction=desc'), all('milestones?state=all')]);
  } catch (e) {
    console.log(`::warning::could not read issues (${e.message}): no status files written`);
    return;
  }
  const { status, roadmap } = buildStatus(issues, milestones, { options, repoUrl: `${server}/${repo}` });
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, 'status.json'), `${JSON.stringify(status, null, 2)}\n`);
  writeFileSync(path.join(out, 'roadmap.json'), `${JSON.stringify(roadmap, null, 2)}\n`);
  console.log(`status: ${status.issues.length} public issues (${status.counts.untriaged} awaiting triage), ${roadmap.milestones.length} milestones -> ${out}`);
}

main().catch((e) => {
  console.log(`::warning::status failed: ${e.message}`);
});
