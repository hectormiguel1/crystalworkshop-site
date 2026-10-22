// Validation of GitHub issue forms (.github/ISSUE_TEMPLATE/*.yml), the
// template chooser config (config.yml) and labels.yml, following GitHub's
// issue-forms syntax rules. Each validator returns { errors, warnings }.
// Unfilled site placeholders ({{SITE_URL}}) are warnings, or errors in strict
// mode (before publishing).

const ID = /^[A-Za-z0-9_-]+$/;
const PLACEHOLDER = /\{\{[A-Z_]+\}\}/;
const TOP_KEYS = new Set(['name', 'description', 'body', 'assignees', 'labels', 'title', 'projects', 'type']);
const TYPES = {
  markdown: { attrs: ['value'], required: ['value'], id: false, validations: false },
  textarea: { attrs: ['label', 'description', 'placeholder', 'value', 'render'], required: ['label'], id: true, validations: true },
  input: { attrs: ['label', 'description', 'placeholder', 'value'], required: ['label'], id: true, validations: true },
  dropdown: { attrs: ['label', 'description', 'multiple', 'options', 'default'], required: ['label', 'options'], id: true, validations: true },
  checkboxes: { attrs: ['label', 'description', 'options'], required: ['label', 'options'], id: true, validations: true },
};

const isStr = (v) => typeof v === 'string';
const nonEmpty = (v) => isStr(v) && v.trim() !== '';
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function stringList(v) {
  if (isStr(v)) return v.split(',').map((s) => s.trim());
  return Array.isArray(v) && v.every(isStr) ? v : null;
}

export function validateForm(form, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!isObj(form)) return { errors: ['the form is not a mapping'], warnings };
  for (const k of Object.keys(form)) if (!TOP_KEYS.has(k)) errors.push(`unknown top-level key "${k}"`);
  if (!nonEmpty(form.name)) errors.push('"name" is required and must be a non-empty string');
  if (!nonEmpty(form.description)) errors.push('"description" is required and must be a non-empty string');
  if (form.title !== undefined && !isStr(form.title)) errors.push('"title" must be a string');
  for (const k of ['labels', 'assignees', 'projects']) {
    if (form[k] !== undefined && !stringList(form[k])) errors.push(`"${k}" must be a list of strings or a comma-separated string`);
  }
  if (!Array.isArray(form.body) || form.body.length === 0) {
    errors.push('"body" is required and must be a non-empty list');
    return { errors, warnings };
  }
  const ids = new Set();
  const labels = new Set();
  let fields = 0;
  form.body.forEach((el, i) => {
    const at = `body[${i}]`;
    if (!isObj(el)) return errors.push(`${at}: must be a mapping`);
    const spec = TYPES[el.type];
    if (!spec) return errors.push(`${at}: unknown type ${JSON.stringify(el.type)}`);
    for (const k of Object.keys(el)) if (!['type', 'id', 'attributes', 'validations'].includes(k)) errors.push(`${at}: unknown key "${k}"`);
    if (el.type !== 'markdown') fields++;
    if (el.id !== undefined) {
      if (!spec.id) errors.push(`${at}: a ${el.type} element cannot have an id`);
      else if (!isStr(el.id) || !ID.test(el.id)) errors.push(`${at}: id ${JSON.stringify(el.id)} may only use letters, digits, "-" and "_"`);
      else if (ids.has(el.id)) errors.push(`${at}: id "${el.id}" is used twice`);
      else ids.add(el.id);
    }
    const a = el.attributes;
    if (!isObj(a)) return errors.push(`${at}: "attributes" is required`);
    for (const k of Object.keys(a)) if (!spec.attrs.includes(k)) errors.push(`${at}: attribute "${k}" is not allowed for ${el.type}`);
    for (const k of spec.required) if (a[k] === undefined) errors.push(`${at}: attribute "${k}" is required for ${el.type}`);
    for (const k of ['label', 'description', 'placeholder', 'value', 'render']) {
      if (a[k] !== undefined && !isStr(a[k])) errors.push(`${at}: attribute "${k}" must be a string`);
    }
    if (a.label !== undefined) {
      if (!nonEmpty(a.label)) errors.push(`${at}: label must not be empty`);
      else if (labels.has(a.label)) errors.push(`${at}: label "${a.label}" is used twice`);
      else labels.add(a.label);
    }
    if (el.type === 'markdown' && !nonEmpty(a.value)) errors.push(`${at}: markdown value must not be empty`);
    if (el.type === 'dropdown' && a.options !== undefined) {
      if (!Array.isArray(a.options) || a.options.length === 0 || !a.options.every(nonEmpty)) errors.push(`${at}: dropdown options must be a non-empty list of strings`);
      else {
        if (new Set(a.options).size !== a.options.length) errors.push(`${at}: dropdown options must be unique`);
        if (a.options.some((o) => o.trim().toLowerCase() === 'none')) errors.push(`${at}: "None" is a reserved dropdown option`);
        if (a.default !== undefined && !(Number.isInteger(a.default) && a.default >= 0 && a.default < a.options.length)) errors.push(`${at}: default must be an index into options`);
      }
      if (a.multiple !== undefined && typeof a.multiple !== 'boolean') errors.push(`${at}: multiple must be true or false`);
    }
    if (el.type === 'checkboxes' && a.options !== undefined) {
      if (!Array.isArray(a.options) || a.options.length === 0) errors.push(`${at}: checkbox options must be a non-empty list`);
      else
        a.options.forEach((o, j) => {
          if (!isObj(o) || !nonEmpty(o.label)) errors.push(`${at}: option ${j} needs a label`);
          else if (o.required !== undefined && typeof o.required !== 'boolean') errors.push(`${at}: option ${j} required must be true or false`);
        });
    }
    if (el.validations !== undefined) {
      if (!spec.validations) errors.push(`${at}: a ${el.type} element cannot have validations`);
      else if (!isObj(el.validations) || Object.keys(el.validations).some((k) => k !== 'required')) errors.push(`${at}: validations only takes "required"`);
      else if (el.validations.required !== undefined && typeof el.validations.required !== 'boolean') errors.push(`${at}: validations.required must be true or false`);
    }
  });
  if (fields === 0) errors.push('"body" needs at least one field that is not markdown');
  const text = JSON.stringify(form);
  if (PLACEHOLDER.test(text)) (strict ? errors : warnings).push(`unfilled placeholder ${text.match(PLACEHOLDER)[0]}`);
  return { errors, warnings };
}

export function validateConfig(cfg, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  if (!isObj(cfg)) return { errors: ['config.yml is not a mapping'], warnings };
  for (const k of Object.keys(cfg)) if (!['blank_issues_enabled', 'contact_links'].includes(k)) errors.push(`unknown key "${k}"`);
  if (cfg.blank_issues_enabled !== undefined && typeof cfg.blank_issues_enabled !== 'boolean') errors.push('blank_issues_enabled must be true or false');
  if (cfg.contact_links !== undefined) {
    if (!Array.isArray(cfg.contact_links)) errors.push('contact_links must be a list');
    else
      cfg.contact_links.forEach((l, i) => {
        for (const k of ['name', 'url', 'about']) if (!nonEmpty(l?.[k])) errors.push(`contact_links[${i}]: "${k}" is required`);
        if (nonEmpty(l?.url)) {
          if (PLACEHOLDER.test(l.url)) (strict ? errors : warnings).push(`contact_links[${i}]: unfilled placeholder ${l.url}`);
          else if (!/^https?:\/\/[^\s/]+/.test(l.url)) errors.push(`contact_links[${i}]: url must be an http(s) URL`);
        }
      });
  }
  return { errors, warnings };
}

export function validateLabels(list) {
  const errors = [];
  if (!Array.isArray(list)) return { errors: ['labels.yml must be a list'], warnings: [] };
  const names = new Set();
  list.forEach((l, i) => {
    if (!isObj(l) || !nonEmpty(l.name)) return errors.push(`labels[${i}]: "name" is required`);
    if (l.name.length > 50) errors.push(`labels[${i}]: "${l.name}" is longer than 50 characters`);
    const key = l.name.toLowerCase();
    if (names.has(key)) errors.push(`labels[${i}]: "${l.name}" is listed twice`);
    names.add(key);
    if (!isStr(l.color) || !/^[0-9a-fA-F]{6}$/.test(l.color)) errors.push(`labels[${i}]: color must be 6 hex digits without "#"`);
    if (l.description !== undefined && (!isStr(l.description) || l.description.length > 100)) errors.push(`labels[${i}]: description must be a string of at most 100 characters`);
  });
  return { errors, warnings: [] };
}

/** Labels a form applies must exist in labels.yml. */
export function crossCheck(forms, labelList) {
  const known = new Set((labelList || []).map((l) => String(l.name).toLowerCase()));
  const errors = [];
  for (const [file, form] of Object.entries(forms)) {
    for (const l of stringList(form?.labels) || []) if (!known.has(l.toLowerCase())) errors.push(`${file}: label "${l}" is not in labels.yml`);
  }
  return errors;
}
