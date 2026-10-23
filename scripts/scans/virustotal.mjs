// VirusTotal API v3: hash lookup first, upload only files VirusTotal has not
// seen, then poll the analysis. https://docs.virustotal.com/reference/overview
import { HttpError, limiter, realSleep, request } from './http.mjs';
import { VT_STATS, vtReportUrl } from './model.mjs';

const API = 'https://www.virustotal.com/api/v3';
// Files up to 32 MB go to /files; larger ones (up to 650 MB) to a one-time upload URL.
export const DIRECT_UPLOAD_MAX = 32 * 1024 * 1024;
export const UPLOAD_MAX = 650 * 1024 * 1024;

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);

function record(sha256, stats = {}, results = {}, date = null) {
  return {
    status: 'ok',
    stats: Object.fromEntries(VT_STATS.map((k) => [k, Number(stats[k]) || 0])),
    flagged: Object.entries(results || {})
      .filter(([, r]) => r && (r.category === 'malicious' || r.category === 'suspicious'))
      .map(([engine, r]) => ({ engine, category: r.category, result: r.result || null }))
      .sort((a, b) => a.engine.localeCompare(b.engine)),
    scanned_at: iso(date),
    url: vtReportUrl(sha256),
  };
}

/** A scanner with lookup/upload/poll (see run.mjs), or one marked not configured. */
export function virusTotal({ apiKey, fetch: fetchImpl = globalThis.fetch, limit, sleep = realSleep, api = API } = {}) {
  if (!apiKey) return { name: 'virustotal', configured: false };
  const lim = limit || limiter(15000, { sleep });
  const headers = { 'x-apikey': apiKey, accept: 'application/json' };
  const call = (url, init = {}) => request(fetchImpl, lim, url, { ...init, headers: { ...headers, ...(init.headers || {}) } }, { sleep });

  async function lookup(t) {
    const res = await call(`${api}/files/${t.sha256}`);
    if (res.status === 404) return { state: 'unknown' };
    if (!res.ok) throw new HttpError(res.status, 'file lookup');
    const a = (await res.json())?.data?.attributes || {};
    if (a.last_analysis_date && a.last_analysis_results && Object.keys(a.last_analysis_results).length) {
      return { state: 'ok', result: record(t.sha256, a.last_analysis_stats, a.last_analysis_results, a.last_analysis_date) };
    }
    return { state: 'pending', handle: { kind: 'file' } };
  }

  async function upload(t) {
    const bytes = t.read();
    if (bytes.length > UPLOAD_MAX) throw new Error(`file is larger than ${UPLOAD_MAX / 1024 / 1024} MB`);
    let url = `${api}/files`;
    if (bytes.length > DIRECT_UPLOAD_MAX) {
      const res = await call(`${api}/files/upload_url`);
      if (!res.ok) throw new HttpError(res.status, 'upload URL');
      url = (await res.json())?.data;
      if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('upload URL: unexpected answer');
    }
    const form = new FormData();
    form.append('file', new Blob([bytes]), t.name);
    const res = await call(url, { method: 'POST', body: form });
    if (!res.ok) throw new HttpError(res.status, 'upload');
    const id = (await res.json())?.data?.id;
    if (!id) throw new Error('upload: no analysis id');
    return { state: 'pending', handle: { kind: 'analysis', id } };
  }

  async function poll(t, handle) {
    if (handle?.kind !== 'analysis') {
      const r = await lookup(t);
      return r.state === 'unknown' ? { state: 'pending', handle } : r;
    }
    const res = await call(`${api}/analyses/${encodeURIComponent(handle.id)}`);
    if (!res.ok) throw new HttpError(res.status, 'analysis');
    const a = (await res.json())?.data?.attributes || {};
    if (a.status !== 'completed') return { state: 'pending', handle };
    return { state: 'ok', result: record(t.sha256, a.stats, a.results, a.date) };
  }

  return { name: 'virustotal', configured: true, lookup, upload, poll };
}
