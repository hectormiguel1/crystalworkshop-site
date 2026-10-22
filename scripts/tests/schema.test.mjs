import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crossCheck, validateConfig, validateForm, validateLabels } from '../lib/issue-form-schema.mjs';

const ok = () => ({
  name: 'Bug',
  description: 'A bug',
  labels: ['bug'],
  body: [
    { type: 'markdown', attributes: { value: 'Hi' } },
    { type: 'dropdown', id: 'pick', attributes: { label: 'Pick', options: ['A', 'B'] }, validations: { required: true } },
    { type: 'input', id: 'version', attributes: { label: 'Version' } },
  ],
});
const errs = (f) => validateForm(f).errors.join('\n');

test('a valid form passes', () => assert.deepEqual(validateForm(ok()), { errors: [], warnings: [] }));

test('the GitHub issue-forms rules are enforced', () => {
  const cases = [
    [(f) => delete f.name, /"name" is required/],
    [(f) => delete f.description, /"description" is required/],
    [(f) => (f.body = []), /"body" is required/],
    [(f) => (f.body = [f.body[0]]), /at least one field/],
    [(f) => (f.extra = 1), /unknown top-level key/],
    [(f) => (f.body[1].type = 'select'), /unknown type/],
    [(f) => (f.body[2].id = 'pick'), /used twice/],
    [(f) => (f.body[2].id = 'bad id'), /may only use/],
    [(f) => (f.body[0].id = 'm'), /cannot have an id/],
    [(f) => (f.body[0].validations = { required: true }), /cannot have validations/],
    [(f) => (f.body[2].attributes.label = 'Pick'), /label "Pick" is used twice/],
    [(f) => delete f.body[1].attributes.options, /"options" is required/],
    [(f) => (f.body[1].attributes.options = ['A', 'A']), /unique/],
    [(f) => (f.body[1].attributes.options = ['None', 'A']), /reserved/],
    [(f) => (f.body[1].attributes.options = []), /non-empty list/],
    [(f) => (f.body[1].attributes.default = 5), /default must be an index/],
    [(f) => (f.body[1].validations = { required: 'yes' }), /true or false/],
    [(f) => (f.body[1].validations = { min: 1 }), /only takes "required"/],
    [(f) => (f.body[2].attributes.render = 'text'), /"render" is not allowed for input/],
    [(f) => (f.body[2].attributes = undefined), /"attributes" is required/],
    [(f) => (f.labels = 3), /"labels" must be/],
    [(f) => (f.body.push({ type: 'checkboxes', id: 'c', attributes: { label: 'C', options: [{}] } })), /needs a label/],
  ];
  for (const [mutate, re] of cases) {
    const f = ok();
    mutate(f);
    assert.match(errs(f), re, re.source);
  }
  assert.match(validateForm(null).errors[0], /not a mapping/);
});

test('placeholders warn, and fail in strict mode', () => {
  const f = ok();
  f.body[0].attributes.value = 'See {{SITE_URL}}';
  assert.equal(validateForm(f).warnings.length, 1);
  assert.equal(validateForm(f, { strict: true }).errors.length, 1);
});

test('config.yml and labels.yml rules', () => {
  assert.match(validateConfig({ blank_issues_enabled: 'no' }).errors[0], /true or false/);
  assert.match(validateConfig({ contact_links: [{ name: 'x', url: 'ftp://x', about: 'y' }] }).errors[0], /http/);
  assert.match(validateConfig({ contact_links: [{ name: 'x' }] }).errors.join(), /"url" is required/);
  assert.match(validateConfig({ other: 1 }).errors[0], /unknown key/);
  assert.match(validateConfig([]).errors[0], /not a mapping/);
  assert.match(validateLabels([{ name: 'a', color: '#fff' }]).errors[0], /6 hex/);
  assert.match(validateLabels([{ name: 'a', color: 'ffffff' }, { name: 'A', color: 'ffffff' }]).errors[0], /twice/);
  assert.match(validateLabels([{ color: 'ffffff' }]).errors[0], /"name" is required/);
  assert.match(validateLabels({}).errors[0], /must be a list/);
  assert.deepEqual(crossCheck({ 'a.yml': { labels: 'x, y' } }, [{ name: 'x' }]), ['a.yml: label "y" is not in labels.yml']);
});
