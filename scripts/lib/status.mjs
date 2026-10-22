// Turns GitHub issues and milestones (REST API shapes) into the public
// api/status.json and api/roadmap.json the site reads at runtime. Only public,
// non-personal fields leave this module: number, title, product, status,
// milestone, fixedIn, updated, url. Issue bodies are read only to recover the
// product a form's dropdown named; they are never written.
//
// Status labels: needs-triage -> triaged -> planned -> in-progress, plus
// fixed-in:<version>. Milestones are target releases. The product comes from
// its label (mod:<id>, pulsedepot, crystalworkshop, crux).

export const STATUS_ORDER = ['triaged', 'planned', 'in-progress', 'fixed'];
const PRODUCT_LABELS = new Set(['pulsedepot', 'crystalworkshop', 'crux']);

const names = (issue) => (issue.labels || []).map((l) => (typeof l === 'string' ? l : l?.name || '')).filter(Boolean);

/** fixed-in:<version> label value, or null. */
export function fixedInOf(labels) {
  const l = labels.find((n) => /^fixed-in:\s*\S/i.test(n));
  return l ? l.replace(/^fixed-in:\s*/i, '').replace(/^v(?=\d)/, '').trim() : null;
}

/**
 * Public status of an issue, or null when it does not belong on the site
 * (not triaged yet, or closed without a fix).
 */
export function statusOf(issue) {
  const labels = names(issue).map((n) => n.toLowerCase());
  if (fixedInOf(labels)) return 'fixed';
  if (issue.state === 'closed') return null;
  if (labels.includes('in-progress')) return 'in-progress';
  if (labels.includes('planned')) return 'planned';
  if (labels.includes('triaged')) return 'triaged';
  return null;
}

/** Answer under a form heading in an issue body ("### Mod\n\nHard Mode (FF XIII)"). */
function formAnswer(body, heading) {
  const m = String(body || '').match(new RegExp(`^###\\s+${heading}\\s*\\n+([^\\n]+)`, 'm'));
  return m ? m[1].trim() : null;
}

/**
 * Product id of an issue: a mod:<id> label, then a product label, then the
 * form's dropdown answer mapped through `options` (option text -> id), then
 * "mod" for an unspecified mod, else null.
 */
export function productOf(issue, options = {}) {
  const labels = names(issue).map((n) => n.toLowerCase());
  const mod = labels.find((n) => n.startsWith('mod:'));
  if (mod) return mod.slice(4);
  const product = labels.find((n) => PRODUCT_LABELS.has(n));
  if (product) return product;
  for (const heading of ['Mod', 'Product']) {
    const answer = formAnswer(issue.body, heading);
    if (answer && options[answer]) return options[answer];
  }
  return labels.includes('mod') ? 'mod' : null;
}

/** The public record of one issue, or null. */
export function publicIssue(issue, options = {}) {
  if (issue.pull_request) return null;
  const status = statusOf(issue);
  if (!status) return null;
  return {
    number: issue.number,
    title: String(issue.title || '').slice(0, 200),
    product: productOf(issue, options),
    status,
    milestone: issue.milestone?.title || null,
    fixedIn: fixedInOf(names(issue)),
    updated: issue.updated_at || null,
    url: issue.html_url,
  };
}

const byStatusThenNumber = (a, b) => STATUS_ORDER.indexOf(b.status) - STATUS_ORDER.indexOf(a.status) || a.number - b.number;

/**
 * { status, roadmap } documents from raw issues and milestones.
 * `options` maps form dropdown answers to product ids (see feedback.mjs optionIndex).
 */
export function buildStatus(issues, milestones, { options = {}, now = new Date(), repoUrl = null } = {}) {
  const items = issues.map((i) => publicIssue(i, options)).filter(Boolean).sort(byStatusThenNumber);
  const untriaged = issues.filter((i) => !i.pull_request && i.state !== 'closed' && !statusOf(i)).length;
  const counts = Object.fromEntries(STATUS_ORDER.map((s) => [s, items.filter((i) => i.status === s).length]));
  const generated = now.toISOString();
  const status = { generated, repo: repoUrl, counts: { ...counts, untriaged }, issues: items };
  const ms = [...milestones]
    .map((m) => ({
      title: m.title,
      due: m.due_on ? m.due_on.slice(0, 10) : null,
      state: m.state === 'closed' ? 'released' : 'open',
      url: m.html_url || null,
      issues: items.filter((i) => i.milestone === m.title).map((i) => i.number),
    }))
    .sort((a, b) => (a.state === b.state ? 0 : a.state === 'open' ? -1 : 1) || (a.due || '9999').localeCompare(b.due || '9999') || a.title.localeCompare(b.title));
  const roadmap = {
    generated,
    milestones: ms,
    unscheduled: items.filter((i) => !i.milestone && i.status !== 'fixed').map((i) => i.number),
  };
  return { status, roadmap };
}
