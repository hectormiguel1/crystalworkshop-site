// Runtime status widgets: reads api/status.json and api/roadmap.json from the
// same origin (written by the public repository's status workflow) and fills
//   [data-status-working]  the "Being worked on" list,
//   [data-status-fixed]    "Fixed in this release" on release cards and changelogs,
//   [data-roadmap]         the Roadmap page.
// Without the files (local builds, before the first status run) every widget
// shows its empty state.

type Issue = {
  number: number;
  title: string;
  product: string | null;
  status: 'triaged' | 'planned' | 'in-progress' | 'fixed';
  milestone: string | null;
  fixedIn: string | null;
  updated: string | null;
  url: string;
};
type Status = { generated: string; issues: Issue[] };
type Milestone = { title: string; due: string | null; state: 'open' | 'released'; url: string | null; issues: number[] };
type Roadmap = { generated: string; milestones: Milestone[]; unscheduled: number[] };

const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
const cache: Record<string, Promise<unknown | null>> = {};
// The site ships placeholder files with "generated": null; they count as "not available yet".
function load<T>(file: string): Promise<T | null> {
  cache[file] ??= fetch(`${base}api/${file}`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => (d && d.generated && Array.isArray(d.issues ?? d.milestones) ? d : null))
    .catch(() => null);
  return cache[file] as Promise<T | null>;
}

const STATUS_LABEL: Record<Issue['status'], string> = {
  triaged: 'Confirmed',
  planned: 'Planned',
  'in-progress': 'In progress',
  fixed: 'Fixed',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function names(root: HTMLElement): Record<string, string> {
  try {
    return JSON.parse(root.dataset.products || '{}');
  } catch {
    return {};
  }
}

function issueItem(i: Issue, products: Record<string, string>, showStatus = true): HTMLLIElement {
  const li = el('li', 'st-issue');
  const a = el('a', 'st-title', i.title);
  a.href = i.url;
  a.rel = 'noopener';
  li.append(a);
  const meta = el('span', 'st-meta');
  if (showStatus) meta.append(el('span', `pill st-${i.status}`, i.status === 'fixed' && i.fixedIn ? `Fixed in ${i.fixedIn}` : STATUS_LABEL[i.status]));
  if (i.product) meta.append(el('span', 'pill kind', products[i.product] ?? i.product));
  meta.append(el('span', 'st-num', `#${i.number}`));
  li.append(meta);
  return li;
}

function fillList(root: HTMLElement, items: Issue[], products: Record<string, string>, showStatus = true) {
  const list = root.querySelector<HTMLElement>('[data-list]');
  const empty = root.querySelector<HTMLElement>('[data-empty]');
  if (!list) return;
  list.replaceChildren(...items.map((i) => issueItem(i, products, showStatus)));
  list.hidden = items.length === 0;
  if (empty) empty.hidden = items.length > 0;
}

function available(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-unavailable]').forEach((e) => (e.hidden = true));
}

function unavailable(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('[data-unavailable]').forEach((e) => (e.hidden = false));
  root.querySelectorAll<HTMLElement>('[data-empty], [data-list]').forEach((e) => (e.hidden = true));
  root.dataset.state = 'unavailable';
}

async function working(root: HTMLElement) {
  const s = await load<Status>('status.json');
  if (!s) return unavailable(root);
  available(root);
  const product = root.dataset.product;
  const items = s.issues.filter((i) => i.status === 'in-progress' && (!product || i.product === product));
  fillList(root, items.slice(0, Number(root.dataset.limit || 20)), names(root), false);
  root.dataset.state = 'ready';
}

async function fixed(root: HTMLElement) {
  const s = await load<Status>('status.json');
  if (!s) return;
  const { product, version } = root.dataset;
  const items = s.issues.filter((i) => i.fixedIn === version && i.product === product);
  if (!items.length) return;
  fillList(root, items, names(root), false);
  root.hidden = false;
}

async function roadmap(root: HTMLElement) {
  const [s, r] = await Promise.all([load<Status>('status.json'), load<Roadmap>('roadmap.json')]);
  if (!s) return unavailable(root);
  available(root);
  const products = names(root);
  const byNumber = new Map(s.issues.map((i) => [i.number, i]));
  const groups = root.querySelector<HTMLElement>('[data-milestones]');
  const open = (r?.milestones || []).filter((m) => m.state === 'open' && m.issues.length);
  groups?.replaceChildren(
    ...open.map((m) => {
      const sec = el('section', 'st-milestone');
      const h = el('h3', undefined, m.title);
      sec.append(h);
      if (m.due) sec.append(el('p', 'st-due', `Target date: ${m.due}`));
      const ul = el('ul', 'st-list');
      ul.append(...m.issues.map((n) => byNumber.get(n)).filter((i): i is Issue => !!i).map((i) => issueItem(i, products)));
      sec.append(ul);
      return sec;
    }),
  );
  const planned = root.querySelector<HTMLElement>('[data-planned]');
  if (planned) planned.hidden = open.length === 0;
  const unscheduled = (r?.unscheduled || []).map((n) => byNumber.get(n)).filter((i): i is Issue => !!i);
  const fixedItems = s.issues.filter((i) => i.status === 'fixed').sort((a, b) => (b.updated || '').localeCompare(a.updated || '')).slice(0, 20);
  for (const [key, items] of [
    ['unscheduled', unscheduled],
    ['fixed', fixedItems],
  ] as const) {
    const part = root.querySelector<HTMLElement>(`[data-part="${key}"]`);
    if (part) fillList(part, items, products);
  }
  const anything = open.length + unscheduled.length + fixedItems.length > 0;
  root.querySelectorAll<HTMLElement>('[data-roadmap-empty]').forEach((e) => (e.hidden = anything));
  root.querySelectorAll<HTMLElement>('[data-roadmap-content]').forEach((e) => (e.hidden = !anything));
  const stamp = root.querySelector<HTMLElement>('[data-generated]');
  if (stamp && s.generated) {
    stamp.textContent = `Updated ${s.generated.slice(0, 16).replace('T', ' ')} UTC.`;
    stamp.hidden = false;
  }
  root.dataset.state = 'ready';
}

function init() {
  document.querySelectorAll<HTMLElement>('[data-status-working]').forEach(working);
  document.querySelectorAll<HTMLElement>('[data-status-fixed]').forEach(fixed);
  document.querySelectorAll<HTMLElement>('[data-roadmap]').forEach(roadmap);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
