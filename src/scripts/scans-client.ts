// Runtime virus scan results: reads api/scans.json from the same origin
// (committed by the public repository's scans workflow) and, when it is newer
// than what the page was built with, re-renders
//   [data-scans]        the list on the Security page,
//   [data-scan-badges]  the scan badges on release cards (data-file: the download).
// Without the file the build-time content stays.
import { cardBadgesHtml, day, filesHtml, usableScans } from '../../scripts/scans/model.mjs';

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
let pending: Promise<any | null> | null = null;
const load = () =>
  (pending ??= fetch(`${base}api/scans.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => usableScans(d))
    .catch(() => null));

function parse<T>(s: string | undefined, fallback: T): T {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
}

async function page(root: HTMLElement) {
  const doc = await load();
  if (!doc || doc.generated === root.dataset.generated) return;
  const list = root.querySelector<HTMLElement>('[data-scans-list]');
  if (list) list.innerHTML = filesHtml(doc.files, parse(root.dataset.products, {}), parse(root.dataset.order, []));
  const stamp = root.querySelector<HTMLElement>('[data-scans-stamp]');
  if (stamp) {
    stamp.textContent = `Last checked ${day(doc.generated)}.`;
    stamp.hidden = false;
  }
  root.querySelectorAll<HTMLElement>('[data-scans-empty]').forEach((e) => (e.hidden = true));
  root.dataset.generated = doc.generated;
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

async function badges(els: HTMLElement[]) {
  if (!els.length) return;
  const doc = await load();
  if (!doc) return;
  for (const el of els) {
    if (el.dataset.generated === doc.generated) continue;
    el.innerHTML = cardBadgesHtml(doc, el.dataset.file || '', el.dataset.security || `${base}security/`);
    el.dataset.generated = doc.generated;
  }
}

function init() {
  document.querySelectorAll<HTMLElement>('[data-scans]').forEach(page);
  badges([...document.querySelectorAll<HTMLElement>('[data-scan-badges]')]);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
