// The ledger of versions already on Nexus (nexus/published.json: { slug: [versions] }),
// so the plan does not ask for approval again. The record job adds every version
// the publish jobs finished (one small JSON note each: { slug, version }).
import { validateLedger } from './plan.mjs';

const LEDGER = 'nexus/published.json';

/** The ledger with `version` added to `slug` (that slug's versions sorted, slugs sorted). */
export function withVersion(ledger, slug, version) {
  const next = { ...ledger, [slug]: [...new Set([...(ledger[slug] || []), version])].sort() };
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Records every note ({ slug, version } JSON file) in env.LEDGER_DIR in the ledger file.
 * `deps`: { fs: { readFileSync, writeFileSync, readdirSync }, log }. Returns the exit code.
 */
export function runLedger(env, { fs, log }) {
  try {
    if (!env.LEDGER_DIR) throw new Error('LEDGER_DIR is required');
    const names = fs.readdirSync(env.LEDGER_DIR).filter((n) => n.endsWith('.json')).sort();
    let ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
    const bad = validateLedger(ledger);
    if (bad.length) throw new Error(`${LEDGER}: ${bad[0]}`);
    for (const n of names) {
      const note = JSON.parse(fs.readFileSync(`${env.LEDGER_DIR}/${n}`, 'utf8'));
      if (typeof note?.slug !== 'string' || !note.slug || typeof note.version !== 'string' || !note.version) throw new Error(`${n}: a note needs a slug and a version`);
      ledger = withVersion(ledger, note.slug, note.version);
      log(`recorded ${note.slug} ${note.version}`);
    }
    fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
    return 0;
  } catch (e) {
    log(`::error::${e.message}`);
    return 1;
  }
}
