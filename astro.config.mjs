// @ts-check
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

const config = JSON.parse(readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'));
const releases = JSON.parse(readFileSync(new URL('./src/data/releases.json', import.meta.url), 'utf8'));
const placeholder = (v) => !v || /^\{\{.*\}\}$/.test(v);

// SITE_URL / BASE_PATH come from the Pages workflow (actions/configure-pages).
const site = process.env.SITE_URL || (placeholder(config.siteUrl) ? undefined : config.siteUrl);
const base = process.env.BASE_PATH || '/';
// Inside the private repository the build goes to ../dist/site; elsewhere ./dist.
const outDir = process.env.SITE_OUT_DIR || (existsSync(new URL('../xtask', import.meta.url)) ? '../dist/site' : './dist');

const group = (label, items, extra = {}) => ({ label, items, ...extra });

export default defineConfig({
  site,
  base,
  outDir,
  trailingSlash: 'always',
  telemetry: false,
  integrations: [
    starlight({
      title: 'CrystalWorkshop',
      description: config.tagline,
      logo: { src: './src/assets/brand/crystalworkshop.png', alt: 'CrystalWorkshop' },
      favicon: '/favicon.ico',
      head: [
        { tag: 'link', attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: `${base.replace(/\/$/, '')}/favicon-32.png` } },
        { tag: 'link', attrs: { rel: 'apple-touch-icon', href: `${base.replace(/\/$/, '')}/apple-touch-icon.png` } },
        { tag: 'meta', attrs: { name: 'theme-color', content: '#141731' } },
      ],
      customCss: [
        '@fontsource-variable/inter/index.css',
        '@fontsource/jetbrains-mono/400.css',
        '@fontsource/jetbrains-mono/700.css',
        './src/styles/theme.css',
        './src/styles/components.css',
      ],
      components: {
        Head: './src/components/overrides/Head.astro',
        Footer: './src/components/overrides/Footer.astro',
      },
      lastUpdated: false,
      credits: false,
      pagination: true,
      tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
      sidebar: [
        group('Start here', [
          { label: 'Home', link: '/' },
          { label: 'Downloads', link: '/downloads/' },
          { label: 'Compatibility', link: '/compatibility/' },
          { label: 'Changelog', link: '/changelog/' },
          { label: 'Roadmap', link: '/roadmap/' },
        ]),
        group('PulseDepot', [
          { label: 'Overview', link: '/pulsedepot/', badge: { text: 'Beta', variant: 'tip' } },
          { label: 'Install', link: '/pulsedepot/install/' },
          { label: '1. First setup', link: '/pulsedepot/first-setup/' },
          { label: '2. Install shard mods (.cws)', link: '/pulsedepot/install-shards/' },
          { label: '3. Install Nova Chrysalia mods (.ncmp)', link: '/pulsedepot/install-ncmp/' },
          { label: '4. Order, enable and resolve conflicts', link: '/pulsedepot/order-and-conflicts/' },
          { label: '5. Review and apply', link: '/pulsedepot/review-and-apply/' },
          { label: '6. Launch the game', link: '/pulsedepot/launch/' },
          { label: '7. Update and remove mods', link: '/pulsedepot/update-and-remove/' },
          { label: '8. Uninstall', link: '/pulsedepot/uninstall/' },
          { label: 'Other tools', link: '/pulsedepot/other-tools/' },
          { label: 'Troubleshooting', link: '/pulsedepot/troubleshooting/' },
          { label: 'FAQ', link: '/pulsedepot/faq/' },
          { label: 'Complete guide (one page)', link: '/pulsedepot/reference/' },
        ], { collapsed: true }),
        group('CrystalWorkshop', [
          { label: 'Overview', link: '/crystalworkshop/', badge: { text: 'Alpha', variant: 'caution' } },
          { label: 'Feature status', link: '/crystalworkshop/feature-status/' },
          group('Getting started', [
            { label: 'Install', link: '/crystalworkshop/installing/' },
            { label: 'First run and game setup', link: '/crystalworkshop/first-run/' },
          ]),
          group('Build your first mod', [
            { label: 'The plan', link: '/crystalworkshop/first-mod/' },
            { label: '1. Create your project', link: '/crystalworkshop/first-mod/create-project/' },
            { label: '2. Make an edit', link: '/crystalworkshop/first-mod/make-an-edit/' },
            { label: '3. Review your changes', link: '/crystalworkshop/first-mod/review-changes/' },
            { label: '4. Export a .cws shard', link: '/crystalworkshop/first-mod/export-shard/' },
            { label: '5. Install and test it', link: '/crystalworkshop/first-mod/install-and-test/' },
          ]),
          group('Editing guides', [
            { label: 'Sheets and SQL (DB)', link: '/crystalworkshop/db-edit/' },
            { label: 'Text (ZTR)', link: '/crystalworkshop/ztr-text-edit/' },
            { label: 'Crystarium', link: '/crystalworkshop/crystarium-edit/' },
            { label: 'Models', link: '/crystalworkshop/model-edit/' },
            { label: 'VFX', link: '/crystalworkshop/vfx-edit/' },
            { label: 'Scenes (LYB)', link: '/crystalworkshop/scene-edit/' },
            { label: 'Scripts, actions and sound', link: '/crystalworkshop/scripts-actions-and-sound/' },
          ]),
          group('Share and automate', [
            { label: 'Mod export reference', link: '/crystalworkshop/mod-export/' },
            { label: 'AI clients (MCP)', link: '/crystalworkshop/mcp/' },
            { label: 'Native extensions (SDK)', link: '/sdk/' },
          ]),
          group('Reference', [
            { label: 'FAQ and troubleshooting', link: '/crystalworkshop/faq/' },
            { label: 'Glossary', link: '/crystalworkshop/glossary/' },
          ]),
        ], { collapsed: true }),
        group('Crux', [
          { label: 'What Crux is', link: '/crux/' },
          { label: 'Standalone or NovaFix addon', link: '/crux/hosts/' },
          { label: 'Logs', link: '/crux/logs/' },
          { label: 'Uninstall', link: '/crux/uninstall/' },
          { label: 'FAQ', link: '/crux/faq/' },
        ], { collapsed: true }),
        group('Extension SDK', [
          { label: 'Overview', link: '/sdk/', badge: { text: 'Developers', variant: 'note' } },
          { label: '1. Set up a project', link: '/sdk/setup/' },
          { label: '2. Units and exports', link: '/sdk/units/' },
          { label: '3. Sites and hooks', link: '/sdk/sites-and-hooks/' },
          { label: '4. In-game settings', link: '/sdk/settings/' },
          { label: '5. Storage and per-save state', link: '/sdk/per-save/' },
          { label: '6. Logging', link: '/sdk/logging/' },
          { label: '7. Package a shard', link: '/sdk/packaging/' },
          { label: '8. Testing', link: '/sdk/testing/' },
          { label: 'Walkthrough: hello-unit', link: '/sdk/hello-unit/' },
          { label: 'API reference', link: '/sdk/reference/' },
          { label: 'Source on GitHub', link: 'https://github.com/hectormiguel1/workshop-extension-sdk', attrs: { target: '_blank', rel: 'noopener' } },
        ], { collapsed: true }),
        group('Mods', [
          { label: 'All mods', link: '/mods/' },
          ...releases.mods.map((m) => ({
            label: m.name,
            link: `/mods/${m.id}/`,
            badge: { text: m.games.map((g) => releases.games[g].short).join(' / '), variant: 'note' },
          })),
        ], { collapsed: false }),
        group('Legal', [
          { label: 'Licence', link: '/legal/' },
          { label: 'Mod permissions', link: '/legal/mod-permissions/' },
          { label: 'Third-party notices', link: '/legal/third-party/' },
          { label: 'Trademarks', link: '/legal/trademarks/' },
        ], { collapsed: true }),
      ],
    }),
  ],
});
