// Kaspersky Threat Intelligence Portal (OpenTIP) API v1: hash lookup first
// (GET search/hash?request=<sha256>); a file OpenTIP does not know (404, or the
// "Grey" zone: no data) is uploaded for a basic analysis
// (POST scan/file?filename=<name>, raw bytes), and its result is then looked
// up by hash until the verdict is in. Key in the x-api-key header; the free
// quota is 2000 requests a day, uploads up to 256 MB.
// https://opentip.kaspersky.com/Help/Doc_data/HashLookupAPI.htm
import { HttpError, limiter, realSleep, request } from './http.mjs';
import { KASPERSKY_ZONES, kasperskyReportUrl } from './model.mjs';

const API = 'https://opentip.kaspersky.com/api/v1';
export const OPENTIP_UPLOAD_MAX = 256 * 1024 * 1024;
export const OPENTIP_RUN_MAX = 1500;

const isoOf = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/** The scan record of an OpenTIP answer, or null when it has no verdict yet. */
export function parseOpenTip(sha256, j) {
  const zone = j?.Zone;
  if (!KASPERSKY_ZONES.includes(zone)) return null;
  const info = j.FileGeneralInfo || {};
  const det = (d) => ({ name: d?.DetectionName || null, zone: d?.Zone || null, last_detected: isoOf(d?.LastDetectDate), url: typeof d?.DescriptionUrl === 'string' && d.DescriptionUrl.startsWith('https://') ? d.DescriptionUrl : null });
  const detections = [...(j.DetectionsInfo || []), ...(j.DynamicDetections || [])].map(det).filter((d) => d.name);
  return {
    status: 'ok',
    zone,
    file_status: info.FileStatus || null,
    detections: detections.slice(0, 10),
    flagged: detections.filter((d) => d.zone === 'Red' || d.zone === 'Yellow').map((d) => ({ engine: 'Kaspersky', result: d.name })),
    type: info.Type || null,
    signer: info.Signer || null,
    first_seen: isoOf(info.FirstSeen),
    scanned_at: isoOf(info.LastSeen),
    url: kasperskyReportUrl(sha256),
  };
}

/** A scanner with lookup/upload/poll (see run.mjs), or one marked not configured. */
export function kaspersky({ apiKey, fetch: fetchImpl = globalThis.fetch, limit, sleep = realSleep, api = API } = {}) {
  if (!apiKey) return { name: 'kaspersky', configured: false };
  const lim = limit || limiter(3000, { sleep, max: OPENTIP_RUN_MAX });
  const call = (url, init = {}) => request(fetchImpl, lim, url, { ...init, headers: { 'x-api-key': apiKey, accept: 'application/json', ...(init.headers || {}) } }, { sleep });

  async function byHash(t) {
    const res = await call(`${api}/search/hash?request=${t.sha256}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpError(res.status, 'hash lookup');
    return parseOpenTip(t.sha256, await res.json());
  }

  async function lookup(t) {
    const r = await byHash(t);
    // Grey: OpenTIP has no data on the file yet, so it is worth an upload.
    return r && r.zone !== 'Grey' ? { state: 'ok', result: r } : { state: 'unknown' };
  }

  async function upload(t) {
    const bytes = t.read();
    if (bytes.length > OPENTIP_UPLOAD_MAX) throw new Error('file is larger than 256 MB');
    const res = await call(`${api}/scan/file?filename=${encodeURIComponent(t.name)}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: bytes });
    if (!res.ok) throw new HttpError(res.status, 'upload');
    // The basic analysis may answer at once; sections can still be missing.
    const r = parseOpenTip(t.sha256, await res.json().catch(() => null));
    return r ? { state: 'ok', result: r } : { state: 'pending', handle: {} };
  }

  async function poll(t, handle) {
    const r = await byHash(t);
    return r ? { state: 'ok', result: r } : { state: 'pending', handle };
  }

  return { name: 'kaspersky', configured: true, lookup, upload, poll };
}
