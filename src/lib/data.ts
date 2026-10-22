import releasesJson from '../data/releases.json';
import changelogJson from '../data/changelog.json';
import siteConfig from '../../site.config.json';
// Plain ES module shared with scripts/generate.mjs, so links and form options agree.
import { feedbackLinks, isPlaceholder } from '../../scripts/lib/feedback.mjs';

export type Platform = { file: string; bytes: number; sha256: string; requirements: string[]; label: string };
export type Store = { name: string; status?: 'experimental'; note?: string };
export type Item = {
  id: string;
  name: string;
  title?: string;
  kind: 'app' | 'component' | 'mod';
  version: string;
  stage: 'alpha' | 'beta' | 'release';
  date: string;
  games: string[];
  /** PC store versions of the games it supports (status 'experimental': not tested in game yet). */
  stores?: Store[];
  summary: string;
  tag: string;
  docs: string;
  icon: string;
  requires?: string[];
  bundledWith?: string;
  builds?: { file: string; variant: string; bytes: number; sha256: string; install: string }[];
  contents?: string[];
  platforms: { windows: Platform; linux: Platform };
  /** In-game screenshots of a mod (thumb: path under the site base). */
  screenshots?: { id: string; caption: string; alt: string; featured: boolean; thumb: string }[];
};

export const releases = releasesJson as unknown as {
  date: string;
  downloadBase: string;
  games: Record<string, { id: string; short: string; name: string }>;
  products: Item[];
  mods: Item[];
  knownIssues: string[];
};

export type Entry = {
  id: string;
  product: string;
  name: string;
  kind: string;
  games: string[];
  version: string;
  stage: string;
  date: string;
  title: string;
  items: string[];
};
export const changelog = changelogJson as Entry[];

export const allItems = (): Item[] => [...releases.products, ...releases.mods];
export const item = (id: string): Item => {
  const found = allItems().find((i) => i.id === id);
  if (!found) throw new Error(`unknown release item ${id}`);
  return found;
};

/** Site-internal link that respects the deploy base path. */
export function href(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return base + path.replace(/^\//, '');
}

export const placeholderDownloads = /^\{\{.*\}\}$/.test(releases.downloadBase);

export function downloadUrl(i: Item, os: 'windows' | 'linux'): string {
  const base = releases.downloadBase.replace(/\/$/, '');
  return `${base}/download/${encodeURIComponent(i.tag)}/${encodeURIComponent(i.platforms[os].file)}`;
}

export function bytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export const stageVariant = (s: string) => (s === 'alpha' ? 'caution' : s === 'beta' ? 'tip' : 'success');
export const stageLabel = (s: string) => (s === 'release' ? 'Release' : s.charAt(0).toUpperCase() + s.slice(1));
export const gameShort = (g: string) => releases.games[g]?.short ?? g;
export const gameName = (g: string) => releases.games[g]?.name ?? g;

/** Inline markdown (code, bold, links) for requirement lines. */
export function inline(s: string): string {
  const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return s
    .split(/(`[^`]*`)/g)
    .map((part, i) =>
      i % 2 === 1
        ? `<code>${esc(part.slice(1, -1))}</code>`
        : esc(part)
            .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>'),
    )
    .join('');
}

export const productName = (id: string) => allItems().find((i) => i.id === id)?.name ?? id;

/** The public repository whose issues take reports and suggestions (unset: buttons hidden). */
// REPO_URL (set by the public repository's workflows) wins over site.config.json.
const repoSetting = (typeof process !== 'undefined' && process.env.REPO_URL) || siteConfig.repoUrl;
export const repoUrl: string | null = isPlaceholder(repoSetting) ? null : String(repoSetting).replace(/\/+$/, '');

/** Prefilled "Report a problem" / "Suggest a feature" links for a product or mod, or null while unset. */
export const feedbackFor = (i: Item): { problem: string | null; feature: string } | null => feedbackLinks(repoUrl, i);

/** Product id -> display name, for the runtime status widgets. */
export const productNames = (): Record<string, string> => ({
  ...Object.fromEntries(allItems().map((i) => [i.id, i.name])),
  mod: 'Mods',
  'new-mod': 'New mod idea',
  site: 'Website',
});
