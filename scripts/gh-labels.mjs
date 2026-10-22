#!/usr/bin/env node
// Prints one `gh label create` command per label in labels.yml, to create or
// update the labels of the public repository:
//   node scripts/gh-labels.mjs OWNER/REPO | sh
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = process.argv[2];
if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
  console.error('usage: node scripts/gh-labels.mjs OWNER/REPO [labels.yml]');
  process.exit(2);
}
const file = process.argv[3] || path.join(SITE, 'deploy-template/.github/labels.yml');
const q = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
for (const l of parse(readFileSync(file, 'utf8'))) {
  console.log(`gh label create ${q(l.name)} --repo ${q(repo)} --color ${q(l.color)} --description ${q(l.description || '')} --force`);
}
