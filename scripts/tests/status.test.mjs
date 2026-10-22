import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStatus, fixedInOf, productOf, publicIssue, statusOf } from '../lib/status.mjs';

const issue = (n, labels, extra = {}) => ({
  number: n,
  title: `Issue ${n}`,
  state: 'open',
  labels: labels.map((name) => ({ name, color: 'ffffff', id: n })),
  body: 'secret body with C:\\Users\\someone',
  user: { login: 'someone' },
  html_url: `https://github.com/o/r/issues/${n}`,
  updated_at: '2026-10-20T10:00:00Z',
  milestone: null,
  ...extra,
});

test('status follows the label model', () => {
  assert.equal(statusOf(issue(1, ['needs-triage'])), null);
  assert.equal(statusOf(issue(1, [])), null);
  assert.equal(statusOf(issue(1, ['triaged'])), 'triaged');
  assert.equal(statusOf(issue(1, ['triaged', 'planned'])), 'planned');
  assert.equal(statusOf(issue(1, ['planned', 'In-Progress'])), 'in-progress');
  assert.equal(statusOf(issue(1, ['in-progress', 'fixed-in:0.1.1'])), 'fixed');
  assert.equal(statusOf(issue(1, ['fixed-in:0.1.1'], { state: 'closed' })), 'fixed');
  assert.equal(statusOf(issue(1, ['planned'], { state: 'closed' })), null);
  assert.equal(fixedInOf(['fixed-in: v0.2.0']), '0.2.0');
  assert.equal(fixedInOf(['fixed-in:']), null);
});

test('the product comes from its label, then the form answer', () => {
  const opts = { 'Hard Mode (FF XIII)': 'hard-mode', PulseDepot: 'pulsedepot' };
  assert.equal(productOf(issue(1, ['mod', 'mod:hard-mode'])), 'hard-mode');
  assert.equal(productOf(issue(1, ['crux'])), 'crux');
  assert.equal(productOf(issue(1, ['mod'], { body: '### Mod\n\nHard Mode (FF XIII)\n\n### Version\n\n0.1.0' }), opts), 'hard-mode');
  assert.equal(productOf(issue(1, ['feature-request'], { body: '### Product\n\nPulseDepot\n' }), opts), 'pulsedepot');
  assert.equal(productOf(issue(1, ['mod'], { body: '### Mod\n\nUnknown' }), opts), 'mod');
  assert.equal(productOf(issue(1, [], { body: null })), null);
  assert.equal(productOf({ labels: ['crystalworkshop'] }), 'crystalworkshop');
});

test('only public, non-personal fields are published', () => {
  const p = publicIssue(issue(7, ['pulsedepot', 'planned'], { milestone: { title: 'PulseDepot 0.2.0', description: 'private plans' } }));
  assert.deepEqual(Object.keys(p).sort(), ['fixedIn', 'milestone', 'number', 'product', 'status', 'title', 'updated', 'url']);
  assert.deepEqual(p, {
    number: 7,
    title: 'Issue 7',
    product: 'pulsedepot',
    status: 'planned',
    milestone: 'PulseDepot 0.2.0',
    fixedIn: null,
    updated: '2026-10-20T10:00:00Z',
    url: 'https://github.com/o/r/issues/7',
  });
  assert.equal(publicIssue(issue(8, ['planned'], { pull_request: {} })), null);
  assert.equal(publicIssue(issue(9, ['triaged'], { title: 'x'.repeat(500) })).title.length, 200);
});

test('status.json and roadmap.json', () => {
  const issues = [
    issue(1, ['mod', 'mod:hard-mode', 'in-progress'], { milestone: { title: 'Hard Mode 0.2.0' } }),
    issue(2, ['pulsedepot', 'planned'], { milestone: { title: 'PulseDepot 0.2.0' } }),
    issue(3, ['crux', 'triaged']),
    issue(4, ['pulsedepot', 'fixed-in:0.1.1'], { state: 'closed', milestone: { title: 'PulseDepot 0.1.1' } }),
    issue(5, ['needs-triage']),
    issue(6, ['planned'], { state: 'closed' }),
    issue(10, ['planned'], { pull_request: { url: 'x' } }),
  ];
  const milestones = [
    { title: 'PulseDepot 0.2.0', due_on: '2026-12-01T08:00:00Z', state: 'open', html_url: 'https://github.com/o/r/milestone/2', description: 'private' },
    { title: 'Hard Mode 0.2.0', due_on: null, state: 'open', html_url: 'https://github.com/o/r/milestone/3' },
    { title: 'PulseDepot 0.1.1', due_on: '2026-10-30T08:00:00Z', state: 'closed', html_url: 'https://github.com/o/r/milestone/1' },
  ];
  const now = new Date('2026-10-21T12:00:00Z');
  const { status, roadmap } = buildStatus(issues, milestones, { now, repoUrl: 'https://github.com/o/r' });
  assert.equal(status.generated, '2026-10-21T12:00:00.000Z');
  assert.deepEqual(status.issues.map((i) => [i.number, i.status]), [
    [4, 'fixed'],
    [1, 'in-progress'],
    [2, 'planned'],
    [3, 'triaged'],
  ]);
  assert.deepEqual(status.counts, { triaged: 1, planned: 1, 'in-progress': 1, fixed: 1, untriaged: 1 });
  const text = JSON.stringify({ status, roadmap });
  assert.doesNotMatch(text, /secret body|someone|private/);
  assert.deepEqual(
    roadmap.milestones.map((m) => [m.title, m.state, m.due, m.issues]),
    [
      ['PulseDepot 0.2.0', 'open', '2026-12-01', [2]],
      ['Hard Mode 0.2.0', 'open', null, [1]],
      ['PulseDepot 0.1.1', 'released', '2026-10-30', [4]],
    ],
  );
  assert.deepEqual(roadmap.unscheduled, [3]);
  const empty = buildStatus([], [], { now });
  assert.deepEqual(empty.status.issues, []);
  assert.deepEqual(empty.roadmap, { generated: '2026-10-21T12:00:00.000Z', milestones: [], unscheduled: [] });
});
