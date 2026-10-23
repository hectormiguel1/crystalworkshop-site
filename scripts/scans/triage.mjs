// Triage (tria.ge public cloud) API v0: search by hash first
// (GET /search?query=sha256:<sha256>), submit only unknown files
// (POST /samples, multipart "file" + "_json"), then the sample status
// (GET /samples/<id>) until "reported" and its overview
// (GET /samples/<id>/overview.json). Key as "Authorization: Bearer".
// https://tria.ge/docs/cloud-api/samples/
import { HttpError, limiter, realSleep, request } from './http.mjs';
import { triageReportUrl } from './model.mjs';

const API = 'https://tria.ge/api/v0';
export const TRIAGE_UPLOAD_MAX = 200 * 1024 * 1024;
const RUNNING = new Set(['pending', 'static_analysis', 'scheduled', 'running', 'processing']);

const isoOf = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const score = (v) => (Number.isInteger(v) && v >= 0 && v <= 10 ? v : null);

/** The scan record of an overview.json answer. */
export function triageRecord(id, o = {}) {
  const sigs = new Map();
  for (const t of o.targets || []) for (const s of t?.signatures || []) if (s?.name && !sigs.has(s.name)) sigs.set(s.name, { name: s.name, score: score(s.score) });
  const sc = score(o.analysis?.score) ?? score(o.sample?.score);
  const family = [...new Set([...(o.analysis?.family || []), ...(o.targets || []).flatMap((t) => t?.family || [])])].slice(0, 6);
  return {
    status: 'ok',
    score: sc,
    family,
    tags: (o.analysis?.tags || []).slice(0, 10),
    signatures: [...sigs.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 8),
    flagged: sc !== null && sc >= 6 ? [{ engine: 'Triage', result: family[0] || `score ${sc}/10` }] : [],
    scanned_at: isoOf(o.sample?.completed || o.sample?.created),
    url: triageReportUrl(o.sample?.id || id),
  };
}

/** A scanner with lookup/upload/poll (see run.mjs), or one marked not configured. */
export function triage({ apiKey, fetch: fetchImpl = globalThis.fetch, limit, sleep = realSleep, api = API } = {}) {
  if (!apiKey) return { name: 'triage', configured: false };
  const lim = limit || limiter(3000, { sleep, max: 600 });
  const call = (url, init = {}) => request(fetchImpl, lim, url, { ...init, headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', ...(init.headers || {}) } }, { sleep });

  async function overview(id) {
    const res = await call(`${api}/samples/${encodeURIComponent(id)}/overview.json`);
    if (!res.ok) throw new HttpError(res.status, 'overview');
    return { state: 'ok', result: triageRecord(id, await res.json()) };
  }

  async function lookup(t) {
    const res = await call(`${api}/search?query=${encodeURIComponent(`sha256:${t.sha256}`)}`);
    if (res.status === 404) return { state: 'unknown' };
    if (!res.ok) throw new HttpError(res.status, 'search');
    const samples = ((await res.json())?.data || []).filter((s) => s?.id);
    const newest = (st) => samples.filter(st).sort((a, b) => String(b.completed || b.submitted || '').localeCompare(String(a.completed || a.submitted || '')))[0];
    const done = newest((s) => s.status === 'reported');
    if (done) return overview(done.id);
    const running = newest((s) => RUNNING.has(s.status));
    return running ? { state: 'pending', handle: { id: running.id } } : { state: 'unknown' };
  }

  async function upload(t) {
    const bytes = t.read();
    if (bytes.length > TRIAGE_UPLOAD_MAX) throw new Error('file is larger than 200 MB');
    const form = new FormData();
    form.append('_json', JSON.stringify({ kind: 'file', interactive: false }));
    form.append('file', new Blob([bytes]), t.name);
    const res = await call(`${api}/samples`, { method: 'POST', body: form });
    if (!res.ok) throw new HttpError(res.status, 'submission');
    const id = (await res.json())?.id;
    if (!id) throw new Error('submission: no sample id');
    return { state: 'pending', handle: { id } };
  }

  async function poll(t, handle) {
    if (!handle?.id) {
      const r = await lookup(t);
      return r.state === 'unknown' ? { state: 'pending', handle } : r;
    }
    const res = await call(`${api}/samples/${encodeURIComponent(handle.id)}`);
    if (res.status === 404) return { state: 'pending', handle };
    if (!res.ok) throw new HttpError(res.status, 'sample');
    const s = await res.json();
    if (s?.status === 'reported') return overview(handle.id);
    if (s?.status === 'failed') throw new Error('sandbox analysis failed');
    return { state: 'pending', handle };
  }

  return { name: 'triage', configured: true, lookup, upload, poll };
}
