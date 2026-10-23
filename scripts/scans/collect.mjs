// Which files get scanned: the assets of the latest CrystalWorkshop,
// PulseDepot and Crux releases, every mod's .cws, and the programs and DLLs
// inside the app packages, read from the repository's GitHub releases.
import { createHash } from 'node:crypto';
import { zipEntries } from '../lib/zip.mjs';
import { fileId } from './model.mjs';

export const APPS = ['crystalworkshop', 'pulsedepot', 'crux'];
// Release assets worth scanning; checksum lists and manifests are text.
const APP_ASSET = /\.(zip|exe|dll|cws)$/i;
const MOD_ASSET = /\.cws$/i;
// Programs and DLLs scanned on their own inside a package (Windows and Linux
// builds), including the DXVK d3d9.dll that ships with CrystalWorkshop.
export const INNER = /^(crystalworkshop|crystalw|pulsedepot)(\.exe)?$|^(crux|version|d3d9)\.dll$/i;

/** { id, version } of a release tag like "pulsedepot-v0.1.0-beta", or null. */
export function parseTag(tag) {
  const m = /^(.+?)-v(\d[\w.+-]*)$/.exec(tag || '');
  return m ? { id: m[1], version: m[2] } : null;
}

/** The newest published (not draft) release of each product and mod. */
export function latestReleases(releases) {
  const out = new Map();
  const sorted = [...releases].filter((r) => !r.draft && parseTag(r.tag_name)).sort((a, b) => (b.published_at || '').localeCompare(a.published_at || ''));
  for (const r of sorted) {
    const { id, version } = parseTag(r.tag_name);
    if (!out.has(id)) out.set(id, { id, version, tag: r.tag_name, assets: r.assets || [] });
  }
  return [...out.values()];
}

/** The assets of a release to download and scan. */
export function scannableAssets(rel) {
  const want = APPS.includes(rel.id) ? APP_ASSET : MOD_ASSET;
  return rel.assets.filter((a) => (a.state ?? 'uploaded') === 'uploaded' && want.test(a.name));
}

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/** Scan targets of one downloaded asset: the asset, then the programs inside it if it is a package. */
export function targetsOf(rel, assetName, bytes) {
  const base = { product: rel.id, version: rel.version, release: rel.tag };
  const out = [{ ...base, id: fileId(assetName), name: assetName, container: null, sha256: sha256(bytes), size: bytes.length, read: () => bytes }];
  if (/\.zip$/i.test(assetName)) {
    for (const e of zipEntries(bytes)) {
      const name = e.name.split('/').pop();
      if (!INNER.test(name)) continue;
      const data = e.read();
      out.push({ ...base, id: fileId(name, assetName), name, container: assetName, sha256: sha256(data), size: data.length, read: () => data });
    }
  }
  return out;
}

/** Every release of `repo` through the GitHub API (paged). */
export async function listReleases(fetchImpl, { repo, token, api = 'https://api.github.com' }) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetchImpl(`${api}/repos/${repo}/releases?per_page=100&page=${page}`, { headers: ghHeaders(token) });
    if (!res.ok) throw new Error(`releases: HTTP ${res.status}`);
    const batch = await res.json();
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/** Downloads one release asset; checks GitHub's own digest when it has one. */
export async function downloadAsset(fetchImpl, asset, { token } = {}) {
  const res = await fetchImpl(asset.url, { headers: { ...ghHeaders(token), accept: 'application/octet-stream' } });
  if (!res.ok) throw new Error(`${asset.name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const digest = /^sha256:([0-9a-f]{64})$/.exec(asset.digest || '')?.[1];
  if (digest && digest !== sha256(bytes)) throw new Error(`${asset.name}: download does not match the release's SHA-256`);
  return bytes;
}

function ghHeaders(token) {
  return { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}
