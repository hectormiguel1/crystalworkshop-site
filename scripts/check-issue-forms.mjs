#!/usr/bin/env node
// Checks the issue forms, config.yml and labels.yml against GitHub's
// issue-forms rules, and that the generated files match the release data.
// Usage: node scripts/check-issue-forms.mjs [GITHUB_DIR] [--strict]
//   GITHUB_DIR defaults to deploy-template/.github; --strict also fails on
//   unfilled placeholders such as {{SITE_URL}} (use it before publishing).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { crossCheck, validateConfig, validateForm, validateLabels } from './lib/issue-form-schema.mjs';
import { renderFeedbackFiles } from './lib/feedback-files.mjs';

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_DIR = path.join(SITE, 'deploy-template/.github');
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const dir = path.resolve(args.find((a) => !a.startsWith('--')) || DEFAULT_DIR);
const tplDir = path.join(dir, 'ISSUE_TEMPLATE');

const errors = [];
const warnings = [];
const load = (file) => {
  try {
    return parse(readFileSync(file, 'utf8'), { uniqueKeys: true, prettyErrors: true });
  } catch (e) {
    errors.push(`${path.relative(dir, file)}: YAML error: ${e.message.split('\n')[0]}`);
    return undefined;
  }
};
const report = (file, r) => {
  for (const e of r.errors) errors.push(`${file}: ${e}`);
  for (const w of r.warnings) warnings.push(`${file}: ${w}`);
};

if (!existsSync(tplDir)) errors.push(`no ISSUE_TEMPLATE folder in ${dir}`);
const forms = {};
let sawConfig = false;
for (const f of existsSync(tplDir) ? readdirSync(tplDir).sort() : []) {
  if (!/\.ya?ml$/.test(f)) continue;
  const v = load(path.join(tplDir, f));
  if (v === undefined) continue;
  if (/^config\.ya?ml$/.test(f)) {
    sawConfig = true;
    report(`ISSUE_TEMPLATE/${f}`, validateConfig(v, { strict }));
  } else {
    forms[f] = v;
    report(`ISSUE_TEMPLATE/${f}`, validateForm(v, { strict }));
  }
}
if (existsSync(tplDir) && !sawConfig) errors.push('ISSUE_TEMPLATE/config.yml is missing');
const labelsFile = path.join(dir, 'labels.yml');
if (!existsSync(labelsFile)) errors.push('labels.yml is missing');
else {
  const labelList = load(labelsFile);
  if (labelList !== undefined) {
    report('labels.yml', validateLabels(labelList));
    errors.push(...crossCheck(forms, labelList));
  }
}

// The generated files must match the committed release data and config.
const releasesFile = path.join(SITE, 'src/data/releases.json');
if (dir === DEFAULT_DIR && existsSync(releasesFile)) {
  const releases = JSON.parse(readFileSync(releasesFile, 'utf8'));
  const config = JSON.parse(readFileSync(path.join(SITE, 'site.config.json'), 'utf8'));
  for (const [rel, text] of Object.entries(renderFeedbackFiles(releases, config))) {
    const file = path.join(dir, rel);
    if (!existsSync(file)) errors.push(`${rel}: missing (run npm run generate)`);
    else if (readFileSync(file, 'utf8') !== text) errors.push(`${rel}: out of date with the release data (run npm run generate)`);
  }
}

console.log(`${Object.keys(forms).length} issue forms, config.yml and labels.yml checked${strict ? ' (strict)' : ''}`);
console.log(`${errors.length} errors, ${warnings.length} warnings`);
for (const e of errors) console.log(`  ERROR ${e}`);
for (const w of warnings) console.log(`  WARN  ${w}`);
process.exit(errors.length ? 1 : 0);
