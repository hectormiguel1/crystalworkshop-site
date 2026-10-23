// Runs every configured scanner over the scan targets and builds the
// api/scans.json document. Each file is looked up by SHA-256 first and
// uploaded only when the service does not know it; uploads are then polled
// until their results are in or the time budget runs out. Files with the
// same SHA-256 are scanned once. Nothing here throws: a failing service or
// file is recorded as "error", a missing API key as "not configured".
import { SCHEMA } from './model.mjs';
import { realSleep } from './http.mjs';

const msg = (e) => String(e?.message || e).slice(0, 200);

/** Results of one scanner: Map sha256 -> scan record. */
export async function scanAll(scanner, targets, { sleep = realSleep, clock = () => Date.now(), pollIntervalMs = 60000, budgetMs = 90 * 60000, enrichBudgetMs = 20 * 60000, log = () => {} } = {}) {
  const out = new Map();
  if (!scanner.configured) {
    for (const t of targets) out.set(t.sha256, { status: 'not configured' });
    return out;
  }
  const started = clock();
  const pending = [];
  const settle = (t, r) => {
    if (r.state === 'ok') out.set(t.sha256, r.result);
    else pending.push({ t, handle: r.handle });
  };
  for (const t of targets) {
    try {
      const found = await scanner.lookup(t);
      if (found.state !== 'unknown') {
        settle(t, found);
        log(`${scanner.name}: ${t.name} ${found.state === 'ok' ? 'known' : 'known, analysis not finished'}`);
        continue;
      }
      log(`${scanner.name}: ${t.name} unknown, uploading`);
      settle(t, await scanner.upload(t));
    } catch (e) {
      log(`${scanner.name}: ${t.name}: ${msg(e)}`);
      out.set(t.sha256, { status: 'error', error: msg(e) });
    }
  }
  while (pending.length && clock() - started < budgetMs) {
    await sleep(pollIntervalMs);
    for (const p of [...pending]) {
      try {
        const r = await scanner.poll(p.t, p.handle);
        if (r.state === 'ok') {
          out.set(p.t.sha256, r.result);
          pending.splice(pending.indexOf(p), 1);
          log(`${scanner.name}: ${p.t.name} done`);
        } else p.handle = r.handle;
      } catch (e) {
        out.set(p.t.sha256, { status: 'error', error: msg(e) });
        pending.splice(pending.indexOf(p), 1);
        log(`${scanner.name}: ${p.t.name}: ${msg(e)}`);
      }
    }
  }
  for (const p of pending) out.set(p.t.sha256, { status: 'pending' });
  // Extra report data for finished results (VirusTotal: file attributes,
  // behaviour, MITRE ATT&CK), within its own time budget. A failure keeps the result.
  if (scanner.enrich) {
    for (const t of targets) {
      const r = out.get(t.sha256);
      if (r?.status !== 'ok') continue;
      if (clock() - started >= budgetMs + enrichBudgetMs) {
        log(`${scanner.name}: no time left for report details`);
        break;
      }
      try {
        out.set(t.sha256, await scanner.enrich(t, r));
      } catch (e) {
        log(`${scanner.name}: ${t.name}: details: ${msg(e)}`);
      }
    }
  }
  return out;
}

/** Keeps an earlier result when this run could not refresh it (error or still pending). */
export function keepPrevious(scanner, sha256, record, previous) {
  if (record.status !== 'error' && record.status !== 'pending') return record;
  const old = previous?.files?.find((f) => f.sha256 === sha256)?.scans?.[scanner];
  return old?.status === 'ok' ? { ...old, stale: true } : record;
}

/** The scans document for `targets` (see model.mjs for the schema). */
export async function runScans({ targets, scanners, previous = null, now = () => new Date(), ...opts }) {
  const unique = [...new Map(targets.map((t) => [t.sha256, t])).values()];
  const results = await Promise.all(scanners.map((s) => scanAll(s, unique, opts)));
  const stamp = now().toISOString();
  return {
    schema: SCHEMA,
    generated: stamp,
    scanners: Object.fromEntries(scanners.map((s) => [s.name, s.configured ? 'configured' : 'not configured'])),
    files: targets.map(({ read, ...t }) => ({
      id: t.id,
      name: t.name,
      container: t.container,
      product: t.product,
      version: t.version,
      release: t.release,
      sha256: t.sha256,
      size: t.size,
      scanned_at: stamp,
      scans: Object.fromEntries(scanners.map((s, i) => [s.name, keepPrevious(s.name, t.sha256, results[i].get(t.sha256), previous)])),
    })),
  };
}
