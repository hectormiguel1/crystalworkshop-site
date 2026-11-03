// Shared plumbing of the Nexus scripts: GitHub Actions outputs and Nexus API reads.

export const NEXUS_API = 'https://api.nexusmods.com';

/** One `name=value` line for $GITHUB_OUTPUT; multi-line values use a delimiter that is not in the text. */
export function outputLine(name, value) {
  const v = String(value);
  if (!/[\r\n]/.test(v)) return `${name}=${v}\n`;
  let delim = 'EOF_NEXUS';
  while (v.includes(delim)) delim += '_X';
  return `${name}<<${delim}\n${v}\n${delim}\n`;
}

/** The `data` of a Nexus v3 reply (`{ data: … }`). */
async function nexusGet(fetchImpl, apiKey, path, base) {
  const res = await fetchImpl(`${base}${path}`, { headers: { apikey: apiKey, accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nexus ${path}: HTTP ${res.status}`);
  const body = await res.json();
  return body.data ?? body;
}

/** Versions already on a Nexus file (GET /v3/mod-files/{id}/versions → data.versions[].version). */
export async function nexusVersions(fetchImpl, apiKey, fileId, base = NEXUS_API) {
  const data = await nexusGet(fetchImpl, apiKey, `/v3/mod-files/${encodeURIComponent(fileId)}/versions`, base);
  return (data.versions || []).map((v) => String(v.version));
}

/** Ids of the files of a Nexus mod (GET /v3/mods/{id}/files → data.mod_files[].id). */
export async function nexusModFileIds(fetchImpl, apiKey, modId, base = NEXUS_API) {
  const data = await nexusGet(fetchImpl, apiKey, `/v3/mods/${encodeURIComponent(modId)}/files`, base);
  return (data.mod_files || []).map((f) => String(f.id));
}
