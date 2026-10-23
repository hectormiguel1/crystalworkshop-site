// VirusTotal API v3: hash lookup first, upload only files VirusTotal has not
// seen, then poll the analysis. Finished results are then enriched with the
// file report's extra attributes, the sandbox behaviour summary and the
// MITRE ATT&CK tree. https://docs.virustotal.com/reference/overview
import { HttpError, limiter, realSleep, request } from './http.mjs';
import { VT_STATS, isHeuristic, vtReportUrl } from './model.mjs';

const API = 'https://www.virustotal.com/api/v3';
// Files up to 32 MB go to /files; larger ones (up to 650 MB) to a one-time upload URL.
export const DIRECT_UPLOAD_MAX = 32 * 1024 * 1024;
export const UPLOAD_MAX = 650 * 1024 * 1024;
// Free tier: 4 requests a minute, 500 a day. One run stays under the daily quota.
export const VT_INTERVAL_MS = 15000;
export const VT_RUN_MAX = 450;

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null);
const day = (v) => (/^\d{8}$/.test(String(v || '')) ? `${String(v).slice(0, 4)}-${String(v).slice(4, 6)}-${String(v).slice(6, 8)}` : v ? String(v) : null);
const take = (a, n) => (Array.isArray(a) ? a.slice(0, n) : []);
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);

function record(sha256, stats = {}, results = {}, date = null) {
  return {
    status: 'ok',
    stats: Object.fromEntries(VT_STATS.map((k) => [k, Number(stats[k]) || 0])),
    flagged: Object.entries(results || {})
      .filter(([, r]) => r && (r.category === 'malicious' || r.category === 'suspicious'))
      .map(([engine, r]) => ({
        engine,
        category: r.category,
        result: r.result || null,
        heuristic: isHeuristic(r.result),
        engine_version: str(r.engine_version),
        engine_update: day(r.engine_update),
      }))
      .sort((a, b) => a.engine.localeCompare(b.engine)),
    scanned_at: iso(date),
    url: vtReportUrl(sha256),
  };
}

/** The extra file report attributes worth showing (compact). */
export function fileDetails(a = {}) {
  const ptc = a.popular_threat_classification;
  const counted = (xs) => take(xs, 5).map((x) => ({ value: x.value, count: Number(x.count) || 0 }));
  const si = a.signature_info;
  return {
    tags: take(a.tags, 20),
    threat: ptc ? { label: str(ptc.suggested_threat_label), categories: counted(ptc.popular_threat_category), names: counted(ptc.popular_threat_name) } : null,
    sandboxes: Object.entries(a.sandbox_verdicts || {})
      .map(([k, v]) => ({ sandbox: v?.sandbox_name || k, category: str(v?.category), classification: take(v?.malware_classification, 5), names: take(v?.malware_names, 5), confidence: Number.isFinite(v?.confidence) ? v.confidence : null }))
      .sort((x, y) => x.sandbox.localeCompare(y.sandbox)),
    yara: take(a.crowdsourced_yara_results, 10).map((r) => ({ rule: r.rule_name, ruleset: str(r.ruleset_name), source: str(r.source), description: str(r.description) })),
    sigma: {
      stats: a.sigma_analysis_stats ? Object.fromEntries(['critical', 'high', 'medium', 'low'].map((k) => [k, Number(a.sigma_analysis_stats[k]) || 0])) : null,
      rules: take(a.sigma_analysis_results, 10).map((r) => ({ title: r.rule_title, level: str(r.rule_level), source: str(r.rule_source) })),
    },
    signature: si
      ? { verified: str(si.verified), signers: str(si.signers), product: str(si.product), description: str(si.description), copyright: str(si.copyright), file_version: str(si['file version']), original_name: str(si['original name']) }
      : null,
  };
}

const SEVERITY = { IMPACT_SEVERITY_HIGH: 3, IMPACT_SEVERITY_MEDIUM: 2, IMPACT_SEVERITY_LOW: 1, IMPACT_SEVERITY_INFO: 0 };
const sev = (s) => SEVERITY[s] ?? (typeof s === 'string' ? { high: 3, medium: 2, low: 1 }[s.toLowerCase()] ?? 0 : 0);

/** Top behaviours of a /behaviour_summary answer, or null when the sandboxes reported nothing. */
export function behaviourSummary(d = {}) {
  const techniques = [];
  const seen = new Set();
  for (const t of [...(d.mitre_attack_techniques || [])].sort((x, y) => sev(y.severity) - sev(x.severity))) {
    if (!t?.id || seen.has(t.id)) continue;
    seen.add(t.id);
    techniques.push({ id: t.id, description: str(t.signature_description), severity: str(t.severity) });
  }
  const signatures = [...(d.signature_matches || [])]
    .sort((x, y) => sev(y.severity) - sev(x.severity))
    .slice(0, 10)
    .map((s) => ({ name: str(s.name) || str(s.description), severity: str(s.severity) }));
  const n = (k) => (Array.isArray(d[k]) ? d[k].length : 0);
  const counts = Object.fromEntries(['processes_created', 'files_written', 'files_dropped', 'registry_keys_set', 'dns_lookups', 'ip_traffic'].map((k) => [k, n(k)]));
  const out = { tags: take(d.tags, 15), verdicts: take(d.verdicts, 10), techniques: techniques.slice(0, 10), signatures, counts, tactics: [] };
  const empty = !out.tags.length && !out.verdicts.length && !techniques.length && !signatures.length && Object.values(counts).every((c) => !c);
  return empty ? null : out;
}

/** Tactics of a /behaviour_mitre_trees answer, merged over the sandboxes. */
export function mitreTactics(data = {}) {
  const tactics = new Map();
  for (const tree of Object.values(data || {})) {
    for (const t of tree?.tactics || []) {
      if (!t?.id) continue;
      if (!tactics.has(t.id)) tactics.set(t.id, { id: t.id, name: str(t.name), techniques: new Map() });
      for (const q of t.techniques || []) if (q?.id) tactics.get(t.id).techniques.set(q.id, { id: q.id, name: str(q.name) });
    }
  }
  return [...tactics.values()].map((t) => ({ ...t, techniques: [...t.techniques.values()].slice(0, 20) })).sort((a, b) => a.id.localeCompare(b.id));
}

/** A scanner with lookup/upload/poll/enrich (see run.mjs), or one marked not configured. */
export function virusTotal({ apiKey, fetch: fetchImpl = globalThis.fetch, limit, sleep = realSleep, api = API } = {}) {
  if (!apiKey) return { name: 'virustotal', configured: false };
  const lim = limit || limiter(VT_INTERVAL_MS, { sleep, max: VT_RUN_MAX });
  const headers = { 'x-apikey': apiKey, accept: 'application/json' };
  const call = (url, init = {}) => request(fetchImpl, lim, url, { ...init, headers: { ...headers, ...(init.headers || {}) } }, { sleep });

  async function lookup(t) {
    const res = await call(`${api}/files/${t.sha256}`);
    if (res.status === 404) return { state: 'unknown' };
    if (!res.ok) throw new HttpError(res.status, 'file lookup');
    const a = (await res.json())?.data?.attributes || {};
    if (a.last_analysis_date && a.last_analysis_results && Object.keys(a.last_analysis_results).length) {
      return { state: 'ok', result: { ...record(t.sha256, a.last_analysis_stats, a.last_analysis_results, a.last_analysis_date), details: fileDetails(a) } };
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
      return r.state === 'unknown' ? { state: 'pending', handle: { kind: 'file' } } : r;
    }
    const res = await call(`${api}/analyses/${encodeURIComponent(handle.id)}`);
    // An upload's analysis object can be gone (404) while the file itself gets
    // analysed: follow the file report by SHA-256 from then on.
    if (res.status === 404) {
      const r = await lookup(t);
      return r.state === 'ok' ? r : { state: 'pending', handle: { kind: 'file' } };
    }
    if (!res.ok) throw new HttpError(res.status, 'analysis');
    const a = (await res.json())?.data?.attributes || {};
    if (a.status !== 'completed') return { state: 'pending', handle };
    return { state: 'ok', result: record(t.sha256, a.stats, a.results, a.date) };
  }

  /** Adds the file report attributes (if the result came from an analysis), the behaviour summary and the MITRE tree. */
  async function enrich(t, result) {
    let out = result;
    if (!out.details) {
      const res = await call(`${api}/files/${t.sha256}`);
      if (res.ok) out = { ...out, details: fileDetails((await res.json())?.data?.attributes || {}) };
    }
    // The file report above is kept even when the behaviour requests fail.
    let behaviour;
    try {
      const res = await call(`${api}/files/${t.sha256}/behaviour_summary`);
      if (res.status === 404) return { ...out, behaviour: null };
      if (!res.ok) return out;
      behaviour = behaviourSummary((await res.json())?.data || {});
    } catch {
      return out;
    }
    if (behaviour) {
      try {
        const m = await call(`${api}/files/${t.sha256}/behaviour_mitre_trees`);
        if (m.ok) behaviour.tactics = mitreTactics((await m.json())?.data || {});
      } catch {
        // No tree: the techniques from the summary stay.
      }
    }
    return { ...out, behaviour };
  }

  return { name: 'virustotal', configured: true, lookup, upload, poll, enrich };
}
