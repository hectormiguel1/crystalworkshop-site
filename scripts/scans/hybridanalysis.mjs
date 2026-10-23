// Hybrid Analysis (Falcon Sandbox) API v2: hash search first
// (GET /search/hash?hash=<sha256>), sandbox submission only for unknown files
// (POST /submit/file, multipart, environment_id), then the job's state
// (GET /report/<job>/state) and summary (GET /report/<job>/summary).
// Key in the api-key header; the API wants a "Falcon Sandbox" user agent.
// https://hybrid-analysis.com/docs/api/v2
import { HttpError, limiter, realSleep, request } from './http.mjs';
import { haReportUrl } from './model.mjs';

const API = 'https://hybrid-analysis.com/api/v2';
// Sandbox environments: Windows 10 64-bit for Windows files, Ubuntu 64-bit for Linux programs.
export const HA_WINDOWS = 160;
export const HA_LINUX = 310;
export const HA_UPLOAD_MAX = 100 * 1024 * 1024;

const isoOf = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : null);
const jobOf = (r) => r?.job_id || r?.id || null;

/** Environment for a file: Linux programs have no extension. */
export const haEnvironment = (name) => (/\.[a-z0-9]+$/i.test(name) ? HA_WINDOWS : HA_LINUX);

/** The scan record of a report summary. */
export function haRecord(sha256, s = {}) {
  return {
    status: 'ok',
    verdict: typeof s.verdict === 'string' && s.verdict ? s.verdict : null,
    threat_score: int(s.threat_score, 100),
    av_detect: int(s.av_detect, 100),
    family: s.vx_family || null,
    environment: s.environment_description || null,
    tags: (s.classification_tags || s.tags || []).slice(0, 10),
    flagged: ['malicious', 'suspicious'].includes(s.verdict) ? [{ engine: 'Hybrid Analysis', result: s.vx_family || s.verdict }] : [],
    scanned_at: isoOf(s.analysis_start_time),
    url: haReportUrl(sha256),
  };
}

/** A scanner with lookup/upload/poll (see run.mjs), or one marked not configured. */
export function hybridAnalysis({ apiKey, fetch: fetchImpl = globalThis.fetch, limit, sleep = realSleep, api = API } = {}) {
  if (!apiKey) return { name: 'hybridanalysis', configured: false };
  const lim = limit || limiter(4000, { sleep, max: 600 });
  const call = (url, init = {}) => request(fetchImpl, lim, url, { ...init, headers: { 'api-key': apiKey, 'user-agent': 'Falcon Sandbox', accept: 'application/json', ...(init.headers || {}) } }, { sleep });

  async function summary(t, job) {
    const res = await call(`${api}/report/${encodeURIComponent(job)}/summary`);
    if (!res.ok) throw new HttpError(res.status, 'report summary');
    return { state: 'ok', result: haRecord(t.sha256, await res.json()) };
  }

  async function lookup(t) {
    const res = await call(`${api}/search/hash?hash=${t.sha256}`);
    if (res.status === 404) return { state: 'unknown' };
    if (!res.ok) throw new HttpError(res.status, 'hash search');
    const j = await res.json();
    const reports = (Array.isArray(j) ? j : j?.reports || []).filter((r) => r && typeof r === 'object');
    const by = (st) => reports.filter((r) => String(r.state || '').toUpperCase() === st).sort((a, b) => String(b.analysis_start_time || '').localeCompare(String(a.analysis_start_time || '')));
    const done = by('SUCCESS');
    if (done.length) return 'verdict' in done[0] ? { state: 'ok', result: haRecord(t.sha256, done[0]) } : summary(t, jobOf(done[0]));
    const running = [...by('IN_PROGRESS'), ...by('IN_QUEUE')];
    if (running.length && jobOf(running[0])) return { state: 'pending', handle: { job: jobOf(running[0]) } };
    return { state: 'unknown' };
  }

  async function upload(t) {
    const bytes = t.read();
    if (bytes.length > HA_UPLOAD_MAX) throw new Error('file is larger than 100 MB');
    const form = new FormData();
    form.append('file', new Blob([bytes]), t.name);
    form.append('environment_id', String(haEnvironment(t.name)));
    const res = await call(`${api}/submit/file`, { method: 'POST', body: form });
    if (!res.ok) throw new HttpError(res.status, 'submission');
    const job = (await res.json())?.job_id;
    if (!job) throw new Error('submission: no job id');
    return { state: 'pending', handle: { job } };
  }

  async function poll(t, handle) {
    if (!handle?.job) {
      const r = await lookup(t);
      return r.state === 'unknown' ? { state: 'pending', handle } : r;
    }
    const res = await call(`${api}/report/${encodeURIComponent(handle.job)}/state`);
    if (res.status === 404) return { state: 'pending', handle };
    if (!res.ok) throw new HttpError(res.status, 'report state');
    const s = await res.json();
    const state = String(s?.state || '').toUpperCase();
    if (state === 'SUCCESS') return summary(t, handle.job);
    if (state === 'ERROR') throw new Error(`sandbox analysis failed${s?.error ? `: ${String(s.error).slice(0, 80)}` : ''}`);
    return { state: 'pending', handle };
  }

  return { name: 'hybridanalysis', configured: true, lookup, upload, poll };
}
