// Feedback through GitHub issues on the public site repository: the issue
// forms, their labels, and the prefilled "Report a problem" / "Suggest a
// feature" links. Pure functions over the release data (src/data/releases.json
// shape) and site.config.json, shared by scripts/generate.mjs and the site's
// components so a form option and the link that prefills it never drift.

export const isPlaceholder = (v) => !v || /^\{\{.*\}\}$/.test(String(v).trim());

/** "FF XIII", "FF XIII-2", "LR" for the option labels. */
const GAME_TAG = { xiii: 'FF XIII', xiii2: 'XIII-2', lr: 'LR' };
export const GAME_OPTIONS = {
  xiii: 'FINAL FANTASY XIII',
  xiii2: 'FINAL FANTASY XIII-2',
  lr: 'LIGHTNING RETURNS: FINAL FANTASY XIII',
};

/** "Hard Mode (FF XIII)", "Some Mod (FF XIII / XIII-2 / LR)", "XIII-2 UI Scale (FF XIII-2)". */
export function modOption(mod) {
  const games = (mod.games || []).filter((g) => GAME_TAG[g]);
  if (!games.length) return mod.name;
  const tags = games.map((g, i) => (i === 0 ? (g === 'xiii2' ? 'FF XIII-2' : GAME_TAG[g]) : GAME_TAG[g]));
  return `${mod.name} (${tags.join(' / ')})`;
}

const PLATFORM_GAME = ['Windows', 'Linux (Proton)'];
const PLATFORM_APP = ['Windows', 'Linux'];

/** Areas offered by each app form. */
export const AREAS = {
  pulsedepot: [
    'Installing or starting PulseDepot',
    'First setup (game folder, how Crux runs)',
    'Adding shard mods (.cws)',
    'Adding Nova Chrysalia mods (.ncmp)',
    'Load order, enabling and conflicts',
    'Review and apply',
    'Launching the game',
    'Updating or removing mods',
    'Uninstalling',
    'Something else',
  ],
  crystalworkshop: [
    'Installing or first run',
    'Sheets and SQL (DB)',
    'Text (ZTR)',
    'Crystarium',
    'Models',
    'VFX',
    'Scenes (LYB)',
    'Scripts, actions and sound',
    'Exporting a .cws shard',
    'AI clients (MCP)',
    'Something else',
  ],
  crux: [
    'The game does not start or crashes',
    'Mods have no effect in game',
    'Standalone build',
    'NovaFix addon build',
    'Logs and console',
    'Uninstalling',
    'Something else',
  ],
};

/** One issue form per product kind. `field` is the dropdown id the links prefill. */
export const FORMS = {
  mod: { file: 'mod-issue.yml', label: 'mod', title: '[Mod] ', field: 'mod' },
  pulsedepot: { file: 'pulsedepot-issue.yml', label: 'pulsedepot', title: '[PulseDepot] ', field: 'area' },
  crystalworkshop: { file: 'crystalworkshop-issue.yml', label: 'crystalworkshop', title: '[CrystalWorkshop] ', field: 'area' },
  crux: { file: 'crux-issue.yml', label: 'crux', title: '[Crux] ', field: 'area' },
  feature: { file: 'feature-request.yml', label: 'feature-request', title: '[Feature] ', field: 'product' },
};

export const TRIAGE_LABEL = 'needs-triage';

/** Label that names one mod, e.g. `mod:hard-mode`. */
export const modLabel = (id) => `mod:${id}`;

/** Feature-request product options: apps first, then one per mod, then extras. */
export function productOptions(releases) {
  const apps = (releases.products || []).map((p) => ({ id: p.id, option: p.name }));
  const mods = (releases.mods || []).map((m) => ({ id: m.id, option: modOption(m) }));
  return [...apps, ...mods, { id: 'new-mod', option: 'A new mod idea' }, { id: 'site', option: 'This website' }];
}

/** Maps every dropdown answer the forms can produce back to a product id. */
export function optionIndex(releases) {
  const map = {};
  for (const p of productOptions(releases)) map[p.option] = p.id;
  return map;
}

const LOG_WARNING =
  '**Check before you paste.** Logs such as `Crux.jsonl` can contain your user name or folder paths. Replace them (for example with `USER`) and remove anything else personal.';

function descriptionField() {
  return {
    type: 'textarea',
    id: 'description',
    attributes: {
      label: 'What happened?',
      description: 'What you did, what you expected, and what happened instead. Steps that make it happen again help the most.',
      placeholder: '1. I did …\n2. I expected …\n3. Instead …',
    },
    validations: { required: true },
  };
}

function screenshotField() {
  return {
    type: 'textarea',
    id: 'screenshots',
    attributes: {
      label: 'Screenshots',
      description: 'Optional. Drag and drop an image here, or paste it.',
    },
    validations: { required: false },
  };
}

function logField(what) {
  return {
    type: 'textarea',
    id: 'logs',
    attributes: {
      label: 'Log',
      description: `Optional. ${what} ${LOG_WARNING}`,
      render: 'text',
    },
    validations: { required: false },
  };
}

function dropdown(id, label, description, options, required = true) {
  return { type: 'dropdown', id, attributes: { label, description, options }, validations: { required } };
}

function versionField(description, example) {
  return {
    type: 'input',
    id: 'version',
    attributes: { label: 'Version', description, placeholder: `e.g. ${example}` },
    validations: { required: true },
  };
}

const intro = (text) => ({ type: 'markdown', attributes: { value: text } });

function header(form) {
  return { title: form.title, labels: [form.label, TRIAGE_LABEL] };
}

/**
 * The issue forms as plain objects, keyed by file name.
 * `releases` is the src/data/releases.json shape; `config` is site.config.json.
 */
export function issueForms(releases, config = {}) {
  const products = Object.fromEntries((releases.products || []).map((p) => [p.id, p]));
  const mods = releases.mods || [];
  const docs = isPlaceholder(config.siteUrl) ? '' : config.siteUrl.replace(/\/?$/, '/');
  const docsLink = (path, text) => (docs ? `[${text}](${docs}${path})` : text);
  const games = Object.values(GAME_OPTIONS);
  const version = (id, fallback) => products[id]?.version || fallback;
  const out = {};

  const modForm = FORMS.mod;
  const latestMod = mods[0]?.version || '0.1.0';
  out[modForm.file] = {
    name: 'Problem with a mod',
    description: 'Something in one of the mods does not work as described.',
    ...header(modForm),
    body: [
      intro(
        `Thanks for the report. Please check the mod's page and ${docsLink('pulsedepot/troubleshooting/', 'Troubleshooting')} first. One problem per report, please. Mods by other authors are reported to their authors.`,
      ),
      dropdown('mod', 'Mod', 'Which mod is it about?', mods.map(modOption)),
      versionField('The mod version, shown in PulseDepot’s mod details.', latestMod),
      dropdown('game', 'Game', 'The game you play it with.', games),
      dropdown('platform', 'Platform', 'Where you play.', PLATFORM_GAME),
      descriptionField(),
      screenshotField(),
      logField('Paste the end of `Crux.jsonl` (in the `addons` folder beside the game executable).'),
    ],
  };

  const app = (id, name, what, platforms, logHint, docsPath) => {
    const form = FORMS[id];
    out[form.file] = {
      name: `Problem with ${name}`,
      description: what,
      ...header(form),
      body: [
        intro(`Thanks for the report. Please check ${docsLink(docsPath, `the ${name} FAQ`)} first. One problem per report, please.`),
        dropdown('area', 'Area', `Which part of ${name} is it about?`, AREAS[id]),
        versionField(`The ${name} version${products[id] ? ` (the current release is ${products[id].version})` : ''}.`, version(id, '0.1.0')),
        dropdown('game', 'Game', 'The game you mod.', games),
        dropdown('platform', 'Platform', `Where you run ${name}.`, platforms),
        descriptionField(),
        screenshotField(),
        logField(logHint),
      ],
    };
  };
  app('pulsedepot', 'PulseDepot', 'PulseDepot, the mod manager, does not work as described.', PLATFORM_GAME, 'Copy the status line and paste the end of `Crux.jsonl` if the game is involved.', 'pulsedepot/faq/');
  app('crystalworkshop', 'CrystalWorkshop', 'CrystalWorkshop, the modding editor, does not work as described.', PLATFORM_APP, 'Paste the error message or the end of the log the app shows.', 'crystalworkshop/faq/');
  app('crux', 'Crux', 'Crux, the mod host the game loads, does not work as described.', PLATFORM_GAME, 'Paste the end of `Crux.jsonl` (in the `addons` folder beside the game executable).', 'crux/faq/');

  const feature = FORMS.feature;
  out[feature.file] = {
    name: 'Suggest a feature',
    description: 'An idea for CrystalWorkshop, PulseDepot, Crux, a mod or this website.',
    ...header(feature),
    body: [
      intro('Thanks for the idea. One idea per suggestion, please.'),
      dropdown('product', 'Product', 'What is the idea for?', productOptions(releases).map((p) => p.option)),
      {
        type: 'textarea',
        id: 'description',
        attributes: {
          label: 'Your idea',
          description: 'What you would like, and what it would help you do.',
        },
        validations: { required: true },
      },
      screenshotField(),
    ],
  };
  return out;
}

/** ISSUE_TEMPLATE/config.yml. */
export function issueConfig(config = {}) {
  const docs = isPlaceholder(config.siteUrl) ? config.siteUrl || '{{SITE_URL}}' : config.siteUrl.replace(/\/?$/, '/');
  return {
    blank_issues_enabled: false,
    contact_links: [
      {
        name: 'Guides and FAQ',
        url: docs,
        about: 'Installation guides, troubleshooting and answers to common questions.',
      },
    ],
  };
}

/** `.github/labels.yml`: name, color, description. */
export function labels(releases) {
  const base = [
    ['needs-triage', 'fbca04', 'New report, not looked at yet'],
    ['triaged', 'c5def5', 'Confirmed and understood'],
    ['planned', '0075ca', 'Will be worked on; see the milestone for the target release'],
    ['in-progress', '5319e7', 'Being worked on now'],
    ['mod', '7a5cf5', 'About a mod'],
    ['pulsedepot', '1e8fb8', 'About PulseDepot'],
    ['crystalworkshop', '4e36c2', 'About CrystalWorkshop'],
    ['crux', 'ff9b3d', 'About Crux'],
    ['feature-request', 'a2eeef', 'An idea for a new feature'],
  ].map(([name, color, description]) => ({ name, color, description }));
  const mods = (releases.mods || []).map((m) => ({ name: modLabel(m.id), color: 'd4c5f9', description: `About the ${m.name} mod` }));
  return [...base, ...mods];
}

/** Issue form and dropdown answer that a product or mod prefills. */
export function formFor(item) {
  if (item.kind === 'mod') return { form: FORMS.mod, value: modOption(item), extra: [modLabel(item.id)] };
  const form = FORMS[item.id];
  return form ? { form, value: null, extra: [] } : null;
}

function query(params) {
  return Object.entries(params)
    .filter(([, v]) => v)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v).replace(/%2C/g, ',')}`)
    .join('&');
}

/**
 * Links for one product or mod: { problem, feature }, or null while the
 * repository URL is unset. `item` is a releases.json product or mod.
 */
export function feedbackLinks(repoUrl, item) {
  if (isPlaceholder(repoUrl)) return null;
  const base = `${repoUrl.replace(/\/+$/, '')}/issues/new`;
  const f = formFor(item);
  const game = item.games?.length === 1 ? GAME_OPTIONS[item.games[0]] : null;
  const problem = f
    ? `${base}?${query({
        template: f.form.file,
        [f.form.field]: f.value,
        version: item.version,
        game,
        labels: [f.form.label, TRIAGE_LABEL, ...f.extra].join(','),
      })}`
    : null;
  const featureValue = item.kind === 'mod' ? modOption(item) : item.name;
  const feature = `${base}?${query({
    template: FORMS.feature.file,
    product: featureValue,
    labels: [FORMS.feature.label, TRIAGE_LABEL, item.kind === 'mod' ? modLabel(item.id) : item.id].join(','),
  })}`;
  return { problem, feature };
}
