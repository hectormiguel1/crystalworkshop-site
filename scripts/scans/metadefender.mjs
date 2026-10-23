// MetaDefender Cloud API v4: hash lookup first, upload only unknown files,
// then poll the result by data_id.
// https://www.opswat.com/docs/mdcloud/metadefender-cloud-api-v4/ref
import { HttpError, limiter, realSleep, request } from './http.mjs';
import { mdReportUrl } from './model.mjs';

const API = 'https://api.metadefender.com/v4';
// scan_result_i values that mean an engine reported something
// (1 infected, 2 suspicious, 4 cleaned, 6 quarantined, 8 skipped infected).
const FLAGGED = new Set([1, 2, 4, 6, 8]);

function parse(sha256, j) {
  const s = j?.scan_results;
  if (!s) return null;
  if ((s.progress_percentage ?? 100) < 100 || s.scan_all_result_a === 'In Progress') return { state: 'pending', handle: { dataId: j.data_id || s.data_id || null } };
  const engines = Object.entries(s.scan_details || {})
    .map(([engine, d]) => ({ engine, threat: d?.threat_found || null, result: Number.isInteger(d?.scan_result_i) ? d.scan_result_i : null }))
    .sort((a, b) => a.engine.localeCompare(b.engine));
  const total = Number.isInteger(s.total_avs) ? s.total_avs : engines.length;
  return {
    state: 'ok',
    result: {
      status: 'ok',
      stats: { detected: Number(s.total_detected_avs) || 0, total },
      result: s.scan_all_result_a || null,
      engines,
      flagged: engines.filter((e) => FLAGGED.has(e.result) || e.threat).map((e) => ({ engine: e.engine, result: e.threat })),
      scanned_at: s.start_time && !Number.isNaN(Date.parse(s.start_time)) ? new Date(s.start_time).toISOString() : null,
      url: mdReportUrl(sha256),
    },
  };
}

/** A scanner with lookup/upload/poll (see run.mjs), or one marked not configured. */
export function metaDefender({ apiKey, fetch: fetchImpl = globalThis.fetch, limit, sleep = realSleep, api = API } = {}) {
  if (!apiKey) return { name: 'metadefender', configured: false };
  const lim = limit || limiter(6500, { sleep });
  const call = (url, init = {}) => request(fetchImpl, lim, url, { ...init, headers: { apikey: apiKey, accept: 'application/json', ...(init.headers || {}) } }, { sleep });

  async function lookup(t) {
    const res = await call(`${api}/hash/${t.sha256}`);
    if (res.status === 404) return { state: 'unknown' };
    if (!res.ok) throw new HttpError(res.status, 'hash lookup');
    return parse(t.sha256, await res.json()) || { state: 'unknown' };
  }

  async function upload(t) {
    const res = await call(`${api}/file`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', filename: t.name },
      body: t.read(),
    });
    if (!res.ok) throw new HttpError(res.status, 'upload');
    const dataId = (await res.json())?.data_id;
    if (!dataId) throw new Error('upload: no data_id');
    return { state: 'pending', handle: { dataId } };
  }

  async function poll(t, handle) {
    if (!handle?.dataId) {
      const r = await lookup(t);
      return r.state === 'unknown' ? { state: 'pending', handle } : r;
    }
    const res = await call(`${api}/file/${encodeURIComponent(handle.dataId)}`);
    if (!res.ok) throw new HttpError(res.status, 'result');
    const r = parse(t.sha256, await res.json());
    return !r || r.state === 'pending' ? { state: 'pending', handle } : r;
  }

  return { name: 'metadefender', configured: true, lookup, upload, poll };
}
