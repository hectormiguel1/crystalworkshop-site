// Site-only rewrites of the release docs: links to package files become site
// links (`@/slug/` is resolved relative to the page), and lines that only
// matter to earlier development installs are dropped.
const RULES = [
  // Upgrade note for development installs of an earlier mod host.
  [/^\|[^\n]*FF13LayeredFS[^\n]*\|\n/gm, ''],
  [/See PulseDepot's guide \(`docs\/README\.md` in its package\) for/g, 'See the [PulseDepot guide](@/pulsedepot/) for'],
  [/The ALPHA release notes \(`ALPHA\.md`\) list/g, 'The [feature status](@/crystalworkshop/feature-status/) page lists'],
  [/\(see \[Licences\]\(#licences\)\)/g, '(see [Licences](@/legal/))'],
  [/The full guide with screenshots is `?docs\/README\.md`? in the download\./g, 'The full guide with screenshots is on this site.'],
];

export function sanitize(md) {
  return RULES.reduce((s, [re, to]) => s.replace(re, to), md);
}
