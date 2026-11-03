// Which mod releases are ready to go to Nexus Mods: the plan.
//
// A mod is a candidate when the mapping (nexus/products.json) knows its slug,
// its newest release is final (not a draft, a prerelease or a test build) and
// carries a .cws. It is ready when the virus scans of that exact file (the
// SHA-256 GitHub reports for the asset) are clean on VirusTotal, MetaDefender
// and Kaspersky; pending or missing results mean "try again later", a flagged
// result blocks it. Versions listed in the ledger (nexus/published.json) are
// already on Nexus. The plan uses no Nexus credential.
import { listReleases, parseTag } from '../scans/collect.mjs';
import { SCANNER_NAMES, ratio, usableScans, validateScans, verdict } from '../scans/model.mjs';
import { outputLine } from './io.mjs';

/** Scanners every file must be clean on before it is published. */
export const GATE = ['virustotal', 'metadefender', 'kaspersky'];
export const CATEGORIES = ['main', 'optional', 'miscellaneous'];
const CWS = /\.cws$/i;
const SHA = /^[0-9a-f]{64}$/;

/** A Nexus v3 id (a string; a positive integer is accepted too) as a string, or null. */
export function idOf(v) {
  if (Number.isInteger(v) && v > 0) return String(v);
  return typeof v === 'string' && /^[\w-]+$/.test(v) ? v : null;
}

/** Problems with the mapping file: [] when it is usable. */
export function validateMapping(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return ['mapping must be an object keyed by release slug'];
  const errors = [];
  const id = (v) => v === null || idOf(v) !== null;
  for (const [slug, e] of Object.entries(map)) {
    if (!e || typeof e !== 'object') {
      errors.push(`${slug}: entry must be an object`);
      continue;
    }
    if (!id(e.mod_id)) errors.push(`${slug}.mod_id must be an id (string or positive integer) or null`);
    if (!id(e.file_id)) errors.push(`${slug}.file_id must be an id (string or positive integer) or null`);
    if (typeof e.display_name !== 'string' || !e.display_name) errors.push(`${slug}.display_name must be a non-empty string`);
    if (!CATEGORIES.includes(e.category)) errors.push(`${slug}.category must be one of ${CATEGORIES.join(', ')}`);
    if (typeof e.archive_old !== 'boolean') errors.push(`${slug}.archive_old must be true or false`);
    if (e.kind !== undefined && !['mod', 'app'].includes(e.kind)) errors.push(`${slug}.kind must be mod or app`);
  }
  return errors;
}

/** Problems with the ledger ({ slug: [versions] }): [] when it is usable. */
export function validateLedger(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return ['ledger must be an object keyed by release slug'];
  return Object.entries(l).filter(([, v]) => !Array.isArray(v) || v.some((x) => typeof x !== 'string')).map(([k]) => `${k}: must be a list of version strings`);
}

/** Newest final release per mapped slug: [{ slug, version, tag, rel }]. */
export function candidates(releases, mapping) {
  const out = new Map();
  const sorted = [...releases].sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  for (const rel of sorted) {
    if (rel.draft || rel.prerelease || /-test/i.test(rel.tag_name || '')) continue;
    const t = parseTag(rel.tag_name);
    if (!t || !Object.hasOwn(mapping, t.id) || out.has(t.id)) continue;
    out.set(t.id, { slug: t.id, version: t.version, tag: rel.tag_name, rel });
  }
  return [...out.values()];
}

/** { state: 'ready' | 'waiting' | 'blocked', reasons } of one scanned file. */
export function gate(entry) {
  if (!entry) return { state: 'waiting', reasons: ['not scanned yet'] };
  const waiting = [];
  const blocked = [];
  for (const s of GATE) {
    const scan = entry.scans?.[s];
    const v = verdict(s, scan);
    const counted = s === 'kaspersky' ? null : ratio(s, scan);
    if (!v) waiting.push(`${SCANNER_NAMES[s]}: ${scan?.status && scan.status !== 'ok' ? scan.status : 'no result'}`);
    else if (v.state === 'flagged') blocked.push(`${SCANNER_NAMES[s]}: flagged (${v.text})`);
    else if (v.state !== 'clean') waiting.push(`${SCANNER_NAMES[s]}: ${v.text}`);
    else if (counted && !(counted.total > 0)) waiting.push(`${SCANNER_NAMES[s]}: no engines reported`);
  }
  if (blocked.length) return { state: 'blocked', reasons: blocked };
  return waiting.length ? { state: 'waiting', reasons: waiting } : { state: 'ready', reasons: [] };
}

/**
 * The plan: { items, waiting, blocked, skipped, done }. Every list entry has the
 * slug, version and a reason; items carry everything the stage step needs.
 * `only`: a slug to limit the plan to ('all' or '' for every mod).
 * `ledger`: { slug: [versions] } already on Nexus.
 */
export function buildPlan({ mapping, releases, scans, ledger = {}, only = 'all' }) {
  const plan = { items: [], waiting: [], blocked: [], skipped: [], done: [] };
  for (const c of candidates(releases, mapping)) {
    if (only && only !== 'all' && only !== c.slug) continue;
    const m = mapping[c.slug];
    const note = (list, reason) => list.push({ slug: c.slug, version: c.version, reason });
    if (m.kind === 'app') {
      note(plan.skipped, 'apps are not published by this workflow');
      continue;
    }
    const asset = (c.rel.assets || []).find((a) => CWS.test(a.name) && (a.state ?? 'uploaded') === 'uploaded');
    if (!asset) {
      note(plan.skipped, 'the release has no .cws file');
      continue;
    }
    const modId = idOf(m.mod_id);
    const fileId = idOf(m.file_id);
    if (!modId || !fileId) {
      note(plan.skipped, 'no Nexus IDs');
      continue;
    }
    if (ledger[c.slug]?.includes(c.version)) {
      note(plan.done, 'recorded as published');
      continue;
    }
    const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest || '')?.[1] ?? null;
    const entry = scans?.files?.find((f) => f.release === c.tag && f.name === asset.name && !f.container && SHA.test(f.sha256 || ''));
    if (entry && digest && entry.sha256 !== digest) {
      note(plan.waiting, 'the scan is of an older file: waiting for a new scan');
      continue;
    }
    const g = gate(entry);
    if (g.state !== 'ready') {
      note(plan[g.state], g.reasons.join('; '));
      continue;
    }
    plan.items.push({
      slug: c.slug,
      version: c.version,
      tag: c.tag,
      asset: asset.name,
      asset_url: asset.url,
      sha256: entry.sha256,
      mod_id: modId,
      file_id: fileId,
      display_name: m.display_name,
      category: m.category,
      archive_old: m.archive_old,
      game: m.game || '',
      requires: m.requires || '',
    });
  }
  return plan;
}

/** The plan as a Markdown step summary. */
export function summaryMarkdown(plan, { dryRun }) {
  const rows = (title, list, fmt) => (list.length ? [`### ${title}`, '', ...list.map(fmt), ''] : []);
  const line = (x) => `- \`${x.slug}\` ${x.version}: ${x.reason}`;
  const any = [plan.items, plan.blocked, plan.waiting, plan.skipped, plan.done].some((l) => l.length);
  return [
    `## Nexus Mods publish plan${dryRun ? ' (dry run: nothing is uploaded)' : ''}`,
    '',
    ...rows('Ready to publish', plan.items, (x) => `- \`${x.slug}\` ${x.version} as "${x.display_name}" (mod ${x.mod_id}, file ${x.file_id})`),
    ...rows('Already published', plan.done, line),
    ...rows('Blocked: a scanner flagged the file', plan.blocked, line),
    ...rows('Waiting for scans', plan.waiting, line),
    ...rows('Skipped', plan.skipped, line),
    any ? '' : 'No mapped mod releases.',
  ].join('\n');
}

/**
 * Runs the plan for the workflow. `env`: GITHUB_REPOSITORY, GITHUB_TOKEN,
 * PRODUCT, INPUT_DRY_RUN ('true'/'false' from a manual run, else ''),
 * VAR_DRY_RUN (the NEXUS_DRY_RUN variable), GITHUB_OUTPUT, GITHUB_STEP_SUMMARY.
 * `deps`: { fs: { readFileSync, appendFileSync }, fetchImpl, log }.
 * Returns the exit code.
 */
export async function runPlan(env, { fs, fetchImpl, log }) {
  try {
    const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
    const mapping = readJson('nexus/products.json');
    const bad = [...validateMapping(mapping), ...validateLedger(readJson('nexus/published.json')).map((m) => `published.json ${m}`)];
    if (bad.length) throw new Error(`nexus: ${bad.slice(0, 5).join('; ')}`);
    const raw = readJson('public/api/scans.json');
    const scans = usableScans(raw);
    if (!scans) log(`::warning::public/api/scans.json is empty or invalid (${validateScans(raw).slice(0, 3).join('; ') || 'no scan data yet'}): nothing is ready`);
    const releases = await listReleases(fetchImpl, { repo: env.GITHUB_REPOSITORY, token: env.GITHUB_TOKEN, api: (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '') });
    const plan = buildPlan({ mapping, releases, scans, ledger: readJson('nexus/published.json'), only: env.PRODUCT || 'all' });
    const dryRun = env.INPUT_DRY_RUN ? env.INPUT_DRY_RUN !== 'false' : env.VAR_DRY_RUN !== 'false';
    for (const s of plan.skipped) log(`::notice::${s.slug} ${s.version}: ${s.reason}`);
    for (const b of plan.blocked) log(`::warning::${b.slug} ${b.version} blocked: ${b.reason}`);
    const md = summaryMarkdown(plan, { dryRun });
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${md}\n`);
    else log(md);
    if (env.GITHUB_OUTPUT) {
      const out = { items: JSON.stringify(plan.items), publish: String(!dryRun && plan.items.length > 0), dry_run: String(dryRun) };
      for (const [k, v] of Object.entries(out)) fs.appendFileSync(env.GITHUB_OUTPUT, outputLine(k, v));
    }
    return 0;
  } catch (e) {
    log(`::error::${e.message}`);
    return 1;
  }
}
