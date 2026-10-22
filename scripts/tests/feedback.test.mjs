import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from 'yaml';
import { FORMS, feedbackLinks, formFor, isPlaceholder, issueConfig, issueForms, labels, modOption, optionIndex, productOptions } from '../lib/feedback.mjs';
import { renderFeedbackFiles } from '../lib/feedback-files.mjs';
import { crossCheck, validateConfig, validateForm, validateLabels } from '../lib/issue-form-schema.mjs';

const releases = {
  products: [
    { id: 'crystalworkshop', name: 'CrystalWorkshop', kind: 'app', version: '0.1.0-alpha', games: ['xiii', 'xiii2', 'lr'] },
    { id: 'pulsedepot', name: 'PulseDepot', kind: 'app', version: '0.1.0-beta', games: ['xiii', 'xiii2', 'lr'] },
    { id: 'crux', name: 'Crux', kind: 'component', version: '0.1.0-beta', games: ['xiii', 'xiii2', 'lr'] },
  ],
  mods: [
    { id: 'hard-mode', name: 'Hard Mode', title: 'XIII — Hard Mode', kind: 'mod', version: '0.1.0', games: ['xiii'] },
    { id: 'ui-scale', name: 'UI Scale', kind: 'mod', version: '0.2.0', games: ['xiii2'] },
    { id: 'all', name: 'Everywhere', kind: 'mod', version: '1.0.0', games: ['xiii', 'xiii2', 'lr'] },
  ],
};
const config = { siteUrl: 'https://example.github.io/site', repoUrl: '{{REPO_URL}}' };

test('mod options name the mod and its games', () => {
  assert.equal(modOption(releases.mods[0]), 'Hard Mode (FF XIII)');
  assert.equal(modOption(releases.mods[1]), 'UI Scale (FF XIII-2)');
  assert.equal(modOption(releases.mods[2]), 'Everywhere (FF XIII / XIII-2 / LR)');
  assert.equal(modOption({ name: 'Bare', games: [] }), 'Bare');
});

test('one form per product kind, one mod option per published mod', () => {
  const forms = issueForms(releases, config);
  assert.deepEqual(Object.keys(forms).sort(), ['crux-issue.yml', 'crystalworkshop-issue.yml', 'feature-request.yml', 'mod-issue.yml', 'pulsedepot-issue.yml']);
  const mod = forms['mod-issue.yml'];
  const dd = mod.body.find((b) => b.id === 'mod');
  assert.deepEqual(dd.attributes.options, ['Hard Mode (FF XIII)', 'UI Scale (FF XIII-2)', 'Everywhere (FF XIII / XIII-2 / LR)']);
  assert.deepEqual(mod.labels, ['mod', 'needs-triage']);
  assert.equal(mod.title, '[Mod] ');
  for (const [file, form] of Object.entries(forms)) {
    const ids = form.body.map((b) => b.id).filter(Boolean);
    assert.ok(ids.includes('description'), file);
    assert.equal(form.body.find((b) => b.id === 'description').validations.required, true, file);
    const shots = form.body.find((b) => b.id === 'screenshots');
    assert.equal(shots.validations.required, false, file);
    assert.match(shots.attributes.description, /Drag and drop an image/, file);
    assert.deepEqual(validateForm(form), { errors: [], warnings: [] }, file);
    if (file === 'feature-request.yml') continue;
    for (const id of ['version', 'game', 'platform']) assert.equal(form.body.find((b) => b.id === id).validations.required, true, `${file} ${id}`);
    const log = form.body.find((b) => b.id === 'logs');
    assert.equal(log.validations.required, false);
    assert.match(log.attributes.description, /user name or folder paths/);
  }
  assert.ok(forms['crux-issue.yml'].body.find((b) => b.id === 'platform').attributes.options.includes('Linux (Proton)'));
  assert.match(forms['pulsedepot-issue.yml'].body.find((b) => b.id === 'version').attributes.description, /0\.1\.0-beta/);
  assert.match(forms['mod-issue.yml'].body[0].attributes.value, /https:\/\/example\.github\.io\/site\/pulsedepot\/troubleshooting\//);
});

test('the feature form lists apps, mods and extras', () => {
  const opts = productOptions(releases).map((p) => p.option);
  assert.deepEqual(opts.slice(0, 4), ['CrystalWorkshop', 'PulseDepot', 'Crux', 'Hard Mode (FF XIII)']);
  assert.ok(opts.includes('This website'));
  const dd = issueForms(releases, config)['feature-request.yml'].body.find((b) => b.id === 'product');
  assert.deepEqual(dd.attributes.options, opts);
  assert.equal(optionIndex(releases)['UI Scale (FF XIII-2)'], 'ui-scale');
});

test('config.yml disables blank issues and links the docs', () => {
  const c = issueConfig(config);
  assert.equal(c.blank_issues_enabled, false);
  assert.equal(c.contact_links[0].url, 'https://example.github.io/site/');
  assert.deepEqual(validateConfig(c, { strict: true }).errors, []);
  const unset = issueConfig({ siteUrl: '{{SITE_URL}}' });
  assert.equal(validateConfig(unset).errors.length, 0);
  assert.equal(validateConfig(unset).warnings.length, 1);
  assert.equal(validateConfig(unset, { strict: true }).errors.length, 1);
});

test('labels cover every form label and every mod', () => {
  const l = labels(releases);
  assert.deepEqual(validateLabels(l).errors, []);
  for (const n of ['needs-triage', 'triaged', 'planned', 'in-progress', 'mod', 'pulsedepot', 'crystalworkshop', 'crux', 'mod:hard-mode', 'mod:all']) assert.ok(l.some((x) => x.name === n), n);
  assert.deepEqual(crossCheck(issueForms(releases, config), l), []);
});

test('rendered YAML parses back to the same forms', () => {
  const files = renderFeedbackFiles(releases, config);
  const forms = issueForms(releases, config);
  for (const [file, form] of Object.entries(forms)) assert.deepEqual(parse(files[`ISSUE_TEMPLATE/${file}`]), form);
  assert.deepEqual(parse(files['labels.yml']), labels(releases));
  assert.match(files['ISSUE_TEMPLATE/config.yml'], /^# Generated/);
});

test('links prefill the form, the option, the version and the labels', () => {
  assert.equal(feedbackLinks('{{REPO_URL}}', releases.mods[0]), null);
  assert.equal(feedbackLinks('', releases.mods[0]), null);
  const m = feedbackLinks('https://github.com/o/r/', releases.mods[0]);
  const u = new URL(m.problem);
  assert.equal(u.origin + u.pathname, 'https://github.com/o/r/issues/new');
  assert.equal(u.searchParams.get('template'), 'mod-issue.yml');
  assert.equal(u.searchParams.get('mod'), 'Hard Mode (FF XIII)');
  assert.equal(u.searchParams.get('version'), '0.1.0');
  assert.equal(u.searchParams.get('game'), 'FINAL FANTASY XIII');
  assert.equal(u.searchParams.get('labels'), 'mod,needs-triage,mod:hard-mode');
  const f = new URL(m.feature);
  assert.equal(f.searchParams.get('template'), 'feature-request.yml');
  assert.equal(f.searchParams.get('product'), 'Hard Mode (FF XIII)');
  const p = feedbackLinks('https://github.com/o/r', releases.products[1]);
  const pu = new URL(p.problem);
  assert.equal(pu.searchParams.get('template'), 'pulsedepot-issue.yml');
  assert.equal(pu.searchParams.get('version'), '0.1.0-beta');
  assert.equal(pu.searchParams.get('game'), null);
  assert.equal(pu.searchParams.get('area'), null);
  assert.equal(new URL(p.feature).searchParams.get('product'), 'PulseDepot');
  // Every prefilled dropdown answer is an option of its form.
  const forms = issueForms(releases, config);
  for (const it of [...releases.products, ...releases.mods]) {
    const links = feedbackLinks('https://github.com/o/r', it);
    for (const link of [links.problem, links.feature]) {
      const q = new URL(link).searchParams;
      const form = forms[q.get('template')];
      for (const el of form.body.filter((b) => b.type === 'dropdown')) {
        if (q.has(el.id)) assert.ok(el.attributes.options.includes(q.get(el.id)), `${it.id} ${el.id}=${q.get(el.id)}`);
      }
    }
  }
  assert.equal(formFor({ kind: 'app', id: 'unknown' }), null);
  assert.equal(feedbackLinks('https://github.com/o/r', { kind: 'app', id: 'unknown', name: 'X', version: '1' }).problem, null);
  assert.equal(FORMS.crux.label, 'crux');
  assert.ok(isPlaceholder('{{X}}') && isPlaceholder(undefined) && !isPlaceholder('https://x'));
});
