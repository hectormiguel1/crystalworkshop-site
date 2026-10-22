// Store badges: which PC store versions of the games a release supports.
// releases.json `stores`: [{ name, status?, note? }], status 'experimental'
// for a version that is coded but not tested in game.

export const STEAM = 'Steam';
export const MS_STORE = 'Microsoft Store';
export const EXPERIMENTAL = 'experimental';

const steam = () => ({ name: STEAM });
const msExperimental = (note) => ({ name: MS_STORE, status: EXPERIMENTAL, ...(note ? { note } : {}) });

/** Stores of the apps and of Crux (fixed per product; see the Compatibility page). */
export const APP_STORES = {
  crystalworkshop: [steam(), msExperimental('XIII-2 only')],
  pulsedepot: [steam(), msExperimental('XIII-2 only; cannot start the game')],
  crux: [steam(), msExperimental('XIII-2 only')],
};

/** Stores of an app or component by id ([] when unknown). */
export function appStores(id) {
  return (APP_STORES[id] || []).map((s) => ({ ...s }));
}

/**
 * Stores of a mod from its README requirement lines:
 * Steam when a game line names the Steam version; the Microsoft Store when a
 * line names it, experimental when that line (or the game line) says so.
 */
export function modStores(lines) {
  const list = (Array.isArray(lines) ? lines : String(lines || '').split('\n')).map((l) => String(l));
  const out = [];
  if (list.some((l) => /\bSteam\b/.test(l))) out.push(steam());
  const ms = list.find((l) => /Microsoft Store/.test(l));
  if (ms) out.push(/experimental|not tested/i.test(ms) ? msExperimental() : { name: MS_STORE });
  return out.length ? out : [steam()];
}

/** Plain text for a store list, e.g. "Steam, Microsoft Store (experimental)". */
export function storesText(stores) {
  return (stores || []).map((s) => (s.status === EXPERIMENTAL ? `${s.name} (${EXPERIMENTAL})` : s.name)).join(', ');
}

/** Tooltip and accessible label of one store badge. */
export function storeLabel(s) {
  if (s.status === EXPERIMENTAL) return `${s.name}: experimental, not tested yet${s.note ? ` (${s.note})` : ''}`;
  return `${s.name}: supported${s.note ? ` (${s.note})` : ''}`;
}
