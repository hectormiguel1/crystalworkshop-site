// Filescan.io (OPSWAT) API: hash reputation first
// (GET /api/reputation/hash?sha256=<sha256>), upload only unknown files
// (POST /api/scan/file, multipart), then the upload's reports
// (GET /api/scan/<flow_id>/report?filter=finalVerdict…) until allFinished.
// Key in the X-Api-Key header. https://www.filescan.io/api/docs
import { HttpError, limiter, realSleep, request } from './http.mjs';
import { FILESCAN_VERDICTS, filescanReportUrl, filescanSearchUrl } from './model.mjs';

const API = 'https://www.filescan.io';
export const FILESCAN_UPLOAD_MAX = 100 * 1024 * 1024;
const REPORT_FILTERS = ['general', 'finalVerdict', 'allTags'].map((f) => `filter=${f}`).join('&');

const isoOf = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const verdictOf = (v) => {
  const s = String(v || '').toLowerCase();
  return FILESCAN_VERDICTS.includes(s) ? s : 'unknown';
};

/** The scan record of one report of a /api/scan/<flow>/report answer. */
export function filescanRecord(sha256, flowId, reportId, rep = {}, date = null) {
  const fv = rep.finalVerdict || {};
  const verdict = verdictOf(fv.verdict);
  const level = typeof fv.threatLevel === 'number' && fv.threatLevel >= 0 && fv.threatLevel <= 1 ? fv.threatLevel : null;
  const tags = (rep.allTags || rep.sanitizedSummary?.tags || []).map((x) => (typeof x === 'string' ? x : x?.tag?.name)).filter(Boolean);
  return {
    status: 'ok',
    verdict,
    threat_level: level,
    confidence: typeof fv.confidence === 'number' ? fv.confidence : null,
    tags: [...new Set(tags)].slice(0, 10),
    flagged: ['suspicious', 'likely_malicious', 'malicious'].includes(verdict) ? [{ engine: 'Filescan.io', result: verdict.replace(/_/g, ' ') }] : [],
    scanned_at: isoOf(date || rep.created_date),
    url: flowId && reportId ? filescanReportUrl(flowId, reportId) : filescanSearchUrl(sha256),
  };
}

/** The report of `sha256` in a scan answer (else the first). */
function pickReport(sha256, reports = {}) {
  const entries = Object.entries(reports || {});
  return entries.find(([, r]) => [r?.file?.sha256, r?.file?.hash].includes(sha256)) || entries[0] || null;
}

/** A scanner with lookup/upload/poll (see run.mjs), or one marked not configured. */
export function filescan({ apiKey, fetch: fetchImpl = globalThis.fetch, limit, sleep = realSleep, api = API } = {}) {
  if (!apiKey) return { name: 'filescan', configured: false };
  const lim = limit || limiter(6000, { sleep, max: 600 });
  const call = (url, init = {}) => request(fetchImpl, lim, url, { ...init, headers: { 'x-api-key': apiKey, accept: 'application/json', ...(init.headers || {}) } }, { sleep });

  /** The reports of an upload: ok, pending, or throws on a failed job. */
  async function scanReport(t, flowId) {
    const res = await call(`${api}/api/scan/${encodeURIComponent(flowId)}/report?${REPORT_FILTERS}`);
    if (res.status === 404) return { state: 'pending', handle: { flowId } };
    if (!res.ok) throw new HttpError(res.status, 'scan report');
    const j = await res.json();
    if (j?.job?.error) throw new Error(`scan failed${j.job.reason ? `: ${String(j.job.reason).slice(0, 80)}` : ''}`);
    const picked = pickReport(t.sha256, j?.reports);
    if (!j?.allFinished || !picked) return { state: 'pending', handle: { flowId } };
    return { state: 'ok', result: filescanRecord(t.sha256, flowId, picked[0], picked[1], j.scanStartedDate) };
  }

  async function lookup(t) {
    const res = await call(`${api}/api/reputation/hash?sha256=${t.sha256}`);
    if (res.status === 404) return { state: 'unknown' };
    if (!res.ok) throw new HttpError(res.status, 'reputation');
    const j = await res.json();
    const reports = (j?.filescan_reports || []).filter((r) => r?.report_id).sort((a, b) => String(b.report_date || '').localeCompare(String(a.report_date || '')));
    if (!reports.length) return { state: 'unknown' };
    const r = reports[0];
    if (r.flow_id) return scanReport(t, r.flow_id);
    return { state: 'ok', result: filescanRecord(t.sha256, null, null, { finalVerdict: { verdict: r.verdict } }, r.report_date) };
  }

  async function upload(t) {
    const bytes = t.read();
    if (bytes.length > FILESCAN_UPLOAD_MAX) throw new Error('file is larger than 100 MB');
    const form = new FormData();
    form.append('file', new Blob([bytes]), t.name);
    const res = await call(`${api}/api/scan/file`, { method: 'POST', body: form });
    if (!res.ok) throw new HttpError(res.status, 'upload');
    const flowId = (await res.json())?.flow_id;
    if (!flowId) throw new Error('upload: no flow id');
    return { state: 'pending', handle: { flowId } };
  }

  async function poll(t, handle) {
    if (!handle?.flowId) {
      const r = await lookup(t);
      return r.state === 'unknown' ? { state: 'pending', handle } : r;
    }
    return scanReport(t, handle.flowId);
  }

  return { name: 'filescan', configured: true, lookup, upload, poll };
}
