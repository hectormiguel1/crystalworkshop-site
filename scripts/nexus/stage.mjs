// Stages one planned mod release for the Nexus upload action: checks Nexus does
// not have the version yet, downloads the .cws and verifies its SHA-256, writes
// the package (.cws + README + third-party notices as one zip), the changelog and
// the file description, and refuses anything that names internal terms.
// The network and the file system are injected.
import { downloadAsset, sha256 } from '../scans/collect.mjs';
import { HASHED_TERMS, hashedHits } from '../lib/terms.mjs';
import { nexusModFileIds, nexusVersions, outputLine } from './io.mjs';
import { makeZip } from './zipwrite.mjs';

export const DEFAULT_REQUIRES = 'PulseDepot 0.2.0-beta or newer';
export const SITE_URL = 'https://hectormiguel1.github.io/crystalworkshop-site';

/** Terms that must not reach a Nexus page (the site's list, plus internal product names). */
export const TERMS = [
  /party-ai/gi,
  /ghidra/gi,
  /0x[0-9a-f]{6}/gi,
  /\bcrates?\b/gi,
  /ff13-ext/gi,
  /\blanes?\b/gi,
  /coverage/gi,
  /layeredfs/gi,
  /ff13[ -]studio/gi,
  /\bnova\b/gi,
  /app\.ron/gi,
  /\/home\//gi,
];

/** Internal terms found in `fields` ({ label: text }): ["label: term", …]. */
export function termHits(fields, { plain = true, hashes = HASHED_TERMS } = {}) {
  const out = [];
  const cache = new Map();
  for (const [label, text] of Object.entries(fields)) {
    if (plain) for (const re of TERMS) for (const m of text.matchAll(re)) out.push(`${label}: "${m[0]}"`);
    for (const h of hashedHits(text, hashes, cache)) out.push(`${label}: banned name #${h.term + 1}`);
  }
  return out;
}

const SHA_LINE = /^\s*SHA-256\b/i;

/** The `### <version>` section of a release body, without the SHA-256 line. '' when there is none. */
export function changelogOf(body, version) {
  const lines = String(body || '').split(/\r?\n/);
  const start = lines.findIndex((l) => {
    const m = /^###\s+v?(\S+)/.exec(l);
    return m && m[1] === version;
  });
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,3}\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).filter((l) => !SHA_LINE.test(l)).join('\n').trim();
}

/** README.txt of the package: the release text before the version sections, plus the page link. */
export function readmeOf(body, { display_name, version, slug }) {
  const lines = String(body || '').split(/\r?\n/);
  const cut = lines.findIndex((l) => /^#{1,3}\s/.test(l));
  const intro = (cut < 0 ? lines : lines.slice(0, cut)).filter((l) => !SHA_LINE.test(l)).join('\n').trim();
  return `${display_name} ${version}\n\n${intro ? `${intro}\n\n` : ''}Mod page: ${SITE_URL}/mods/${slug}/\n`;
}

/** The standard Nexus file description. */
export function descriptionOf(item) {
  const game = item.game ? ` for ${item.game}` : '';
  return `${item.display_name} ${item.version}${game}. Needs ${item.requires || DEFAULT_REQUIRES}. SHA-256: ${item.sha256}`;
}

/**
 * Stages one plan item. `ctx`: { fetchImpl, token, apiKey, repo, api, outDir,
 * readLegal(slug) -> string|null, writeFile(path, data) }.
 * Returns { skip: true, reason } or { skip: false, zip, changelog, description, warnings }.
 * Throws when the download is wrong or internal terms are found.
 */
export async function stageItem(item, ctx) {
  const { fetchImpl, token, apiKey, outDir } = ctx;
  // Fail before anything is uploaded: the mod must exist and own the file.
  const files = await nexusModFileIds(fetchImpl, apiKey, item.mod_id, ctx.nexusBase);
  if (!files.includes(String(item.file_id))) throw new Error(`${item.slug}: Nexus file ${item.file_id} does not belong to mod ${item.mod_id}`);
  const have = await nexusVersions(fetchImpl, apiKey, item.file_id, ctx.nexusBase);
  if (have.includes(item.version)) return { skip: true, reason: `version ${item.version} is already on Nexus` };

  const bytes = await downloadAsset(fetchImpl, { name: item.asset, url: item.asset_url, digest: `sha256:${item.sha256}` }, { token });
  // Fail closed whatever the digest check above did with a malformed SHA-256.
  if (sha256(bytes) !== item.sha256) throw new Error(`${item.asset}: does not match the scanned SHA-256`);

  const api = (ctx.api || 'https://api.github.com').replace(/\/$/, '');
  const res = await fetchImpl(`${api}/repos/${ctx.repo}/releases/tags/${encodeURIComponent(item.tag)}`, {
    headers: { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (!res.ok) throw new Error(`release ${item.tag}: HTTP ${res.status}`);
  const body = (await res.json()).body || '';

  const changelog = changelogOf(body, item.version) || `Version ${item.version}`;
  const description = descriptionOf(item);
  const readme = readmeOf(body, item);
  const legal = ctx.readLegal(item.slug);
  const warnings = legal ? [] : [`${item.slug}: no third-party notices file, package has none`];

  // The notices legitimately use words like "crate"; only the banned names are checked there.
  const hits = [...termHits({ name: item.display_name, changelog, description, readme }), ...termHits({ notices: legal || '' }, { plain: false, hashes: ctx.hashes })];
  if (hits.length) throw new Error(`${item.slug}: internal terms in the Nexus text: ${hits.slice(0, 5).join('; ')}`);

  const zipName = `${item.asset}.zip`;
  const entries = [{ name: item.asset, data: bytes }, { name: 'README.txt', data: readme }];
  if (legal) entries.push({ name: 'THIRD-PARTY-NOTICES.txt', data: legal });
  ctx.writeFile(`${outDir}/${zipName}`, makeZip(entries));
  return { skip: false, zip: `${outDir}/${zipName}`, zipName, changelog, description, warnings };
}

/**
 * Runs the stage step. `env`: ITEM (the plan item as JSON), GITHUB_REPOSITORY,
 * GITHUB_TOKEN, NEXUS_API_KEY, STAGE_DIR, GITHUB_OUTPUT.
 * `deps`: { fs: { appendFileSync, mkdirSync, writeFileSync, existsSync, readFileSync }, fetchImpl, log, hashes? }.
 * Returns the exit code.
 */
export async function runStage(env, { fs, fetchImpl, log, hashes }) {
  try {
    const item = JSON.parse(env.ITEM);
    const outDir = env.STAGE_DIR || 'stage';
    const out = (k, v) => env.GITHUB_OUTPUT && fs.appendFileSync(env.GITHUB_OUTPUT, outputLine(k, v));
    fs.mkdirSync(outDir, { recursive: true });
    const legalPath = `public/legal/mod-${item.slug}.txt`;
    const r = await stageItem(item, {
      fetchImpl,
      token: env.GITHUB_TOKEN,
      apiKey: env.NEXUS_API_KEY,
      repo: env.GITHUB_REPOSITORY,
      api: env.GITHUB_API_URL,
      outDir,
      hashes,
      readLegal: () => (fs.existsSync(legalPath) ? fs.readFileSync(legalPath, 'utf8') : null),
      writeFile: (p, d) => fs.writeFileSync(p, d),
    });
    out('skip', r.skip);
    if (r.skip) {
      log(`::notice::${item.slug}: ${r.reason}`);
      return 0;
    }
    for (const w of r.warnings) log(`::warning::${w}`);
    out('zip', r.zip);
    out('changelog', r.changelog);
    out('description', r.description);
    return 0;
  } catch (e) {
    log(`::error::${e.message}`);
    return 1;
  }
}
