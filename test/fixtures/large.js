// Large demo fixture: 4 teams (Design, Frontend, Backend, Mobile), a reporter-only PM,
// a deactivated engineer and a bot. 40 issues incl. 12 months of Done work (2 older).
import { buildFixture } from './build.js';

const DEF = 'jira-software-users';
const h = (id, displayName, extra = {}) => ({ accountId: id, displayName, active: true, accountType: 'atlassian', groups: [DEF], ...extra });
const asg = (at, from, to) => ({ at, items: [{ field: 'assignee', from, to }] });

export default buildFixture({
  name: 'large',
  asOf: '2026-10-29T12:00:00.000+0000',
  projects: { DES: 'Design', WEB: 'Frontend', API: 'Backend', MOB: 'Mobile' },
  users: [
    // Design: team field x2, group x1
    h('u-mia', 'Mia', { team: 'Design' }),
    h('u-noah', 'Noah', { team: 'Design' }),
    h('u-ivy', 'Ivy', { groups: [DEF, 'design-team'] }),
    // Frontend: team field x2, project key x1
    h('u-ken', 'Ken', { team: 'Frontend' }),
    h('u-lea', 'Lea', { team: 'Frontend' }),
    h('u-omar', 'Omar'),
    // Backend: team field x3, group x1
    h('u-sam', 'Sam', { team: 'Backend' }),
    h('u-tara', 'Tara', { groups: [DEF, 'site-admins', 'backend-team'] }),
    h('u-uri', 'Uri', { team: 'Backend' }),
    h('u-vic', 'Vic', { team: 'Backend' }),
    // Mobile: team field x2, project key x1
    h('u-wen', 'Wen', { team: 'Mobile' }),
    h('u-xan', 'Xan', { team: 'Mobile' }),
    h('u-yui', 'Yui'),
    // reporter-only PM
    h('u-paula', 'Paula', { team: 'Product' }),
    // excluded accounts
    { accountId: 'u-dan', displayName: 'Dan', active: false, accountType: 'atlassian', groups: [DEF] },
    { accountId: 'u-bot', displayName: 'Automation for Jira', active: true, accountType: 'app', groups: [] },
  ],
  issues: [
    // ---------------- Design ----------------
    { key: 'DES-1', type: 'Epic', summary: 'Design system 2.0', status: 'In Progress', assignee: 'u-mia', reporter: 'u-paula', created: '2026-07-01', updated: '2026-10-20' },
    { key: 'DES-2', type: 'Story', parent: 'DES-1', summary: 'Design tokens', status: 'In Progress', assignee: 'u-mia', reporter: 'u-paula', components: ['design-system'], labels: ['tokens'], due: '2026-11-01', created: '2026-09-01', updated: '2026-10-27', points: 5 },
    { key: 'DES-3', type: 'Story', parent: 'DES-1', summary: 'Icon set', status: 'In Progress', assignee: 'u-mia', reporter: 'u-paula', components: ['icons'], due: '2026-11-12', created: '2026-09-10', updated: '2026-10-24', points: 3 },
    { key: 'DES-4', type: 'Sub-task', parent: 'DES-3', summary: 'Icon export', status: 'In Progress', assignee: 'u-noah', reporter: 'u-mia', created: '2026-09-15', updated: '2026-10-22' },
    { key: 'DES-5', type: 'Story', summary: 'Checkout flows', status: 'In Review', assignee: 'u-ivy', reporter: 'u-paula', components: ['design-system'], labels: ['checkout-2026'], due: '2026-11-05', created: '2026-09-05', updated: '2026-10-26', points: 3 },
    { key: 'DES-6', type: 'Story', summary: 'Color audit', status: 'Done', assignee: 'u-noah', reporter: 'u-mia', components: ['design-system'], created: '2026-08-01', resolved: '2026-09-15' },
    { key: 'DES-7', type: 'Story', summary: 'Brand palette', status: 'Done', assignee: 'u-mia', reporter: 'u-paula', components: ['design-system'], created: '2026-02-01', resolved: '2026-03-10' },
    { key: 'DES-8', type: 'Story', summary: 'Typography scale', status: 'Done', assignee: 'u-ivy', reporter: 'u-paula', components: ['design-system'], created: '2025-10-15', resolved: '2025-12-01', history: [asg('2025-11-01', 'u-mia', 'u-ivy')] }, // handoff
    { key: 'DES-9', type: 'Task', summary: 'Icon guidelines', status: 'Done', assignee: 'u-noah', reporter: 'u-mia', components: ['icons'], created: '2026-01-05', resolved: '2026-01-20' },

    // ---------------- Frontend ----------------
    { key: 'WEB-1', type: 'Epic', summary: 'Checkout redesign', status: 'In Progress', assignee: 'u-lea', reporter: 'u-paula', created: '2026-05-01', updated: '2026-10-20' },
    { key: 'WEB-2', type: 'Story', summary: 'Token migration', status: 'To Do', assignee: 'u-ken', reporter: 'u-paula', components: ['web-platform'], labels: ['tokens'], created: '2026-09-20', updated: '2026-10-25', points: 5 },
    { key: 'WEB-3', type: 'Story', parent: 'WEB-1', summary: 'Checkout UI', status: 'In Progress', assignee: 'u-lea', reporter: 'u-paula', components: ['checkout'], labels: ['checkout-2026'], due: '2026-11-20', created: '2026-09-10', updated: '2026-10-28', points: 8 },
    { key: 'WEB-4', type: 'Story', summary: 'Form components', status: 'In Progress', assignee: 'u-ken', reporter: 'u-paula', components: ['web-platform'], created: '2026-09-15', updated: '2026-10-23', history: [asg('2026-10-02', 'u-lea', 'u-ken')] }, // handoff
    { key: 'WEB-5', type: 'Story', parent: 'WEB-1', summary: 'Checkout e2e tests', status: 'To Do', assignee: 'u-omar', reporter: 'u-lea', components: ['checkout'], labels: ['checkout-2026'], created: '2026-09-12', updated: '2026-09-30' }, // stale
    { key: 'WEB-6', type: 'Story', summary: 'Webhook dashboard', status: 'To Do', assignee: 'u-ken', reporter: 'u-paula', components: ['web-platform'], created: '2026-10-01', updated: '2026-10-21' },
    { key: 'WEB-7', type: 'Story', parent: 'WEB-1', summary: 'Cart page', status: 'Done', assignee: 'u-lea', reporter: 'u-paula', components: ['checkout'], labels: ['checkout-2026'], created: '2026-04-15', resolved: '2026-06-20', history: [asg('2026-05-01', 'u-omar', 'u-lea')] },
    { key: 'WEB-8', type: 'Story', summary: 'Legacy checkout', status: 'Done', assignee: 'u-ken', reporter: 'u-paula', components: ['checkout'], created: '2025-06-01', resolved: '2025-08-15' }, // > 12 months
    { key: 'WEB-9', type: 'Task', summary: 'Checkout analytics', status: 'Done', assignee: 'u-omar', reporter: 'u-lea', components: ['checkout'], created: '2026-08-01', resolved: '2026-08-30' },

    // ---------------- Backend ----------------
    { key: 'API-1', type: 'Epic', summary: 'Payments v2', status: 'In Progress', assignee: 'u-sam', reporter: 'u-paula', created: '2026-06-01', updated: '2026-10-15' },
    { key: 'API-2', type: 'Story', parent: 'API-1', summary: 'Payment API', status: 'Blocked', assignee: 'u-sam', reporter: 'u-paula', components: ['payments'], labels: ['checkout-2026'], due: '2026-10-25', created: '2026-08-20', updated: '2026-10-27', points: 8 },
    { key: 'API-3', type: 'Story', parent: 'API-1', summary: 'Ledger service', status: 'In Progress', assignee: 'u-tara', reporter: 'u-paula', components: ['ledger'], created: '2026-08-25', updated: '2026-10-26', points: 5 },
    { key: 'API-4', type: 'Sub-task', parent: 'API-3', summary: 'Ledger schema', status: 'In Progress', assignee: 'u-uri', reporter: 'u-tara', created: '2026-09-01', updated: '2026-10-24' },
    { key: 'API-5', type: 'Story', summary: 'Fraud checks', status: 'In Progress', assignee: 'u-vic', reporter: 'u-paula', components: ['payments'], created: '2026-09-05', updated: '2026-10-25' },
    { key: 'API-6', type: 'Sub-task', parent: 'API-2', summary: 'Fraud hook', status: 'To Do', assignee: 'u-vic', reporter: 'u-sam', created: '2026-09-10', updated: '2026-10-20' },
    { key: 'API-7', type: 'Task', summary: 'Legacy webhooks', status: 'In Progress', assignee: 'u-dan', reporter: 'u-sam', components: ['payments'], created: '2026-07-01', updated: '2026-10-18' }, // deactivated assignee
    { key: 'API-8', type: 'Task', summary: 'Dependency upgrade', status: 'In Progress', assignee: 'u-uri', reporter: 'u-bot', created: '2026-10-10', updated: '2026-10-27' }, // bot reporter
    { key: 'API-9', type: 'Story', summary: 'Payment gateway v1', status: 'Done', assignee: 'u-sam', reporter: 'u-paula', components: ['payments'], labels: ['checkout-2026'], created: '2025-05-01', resolved: '2025-09-30', history: [asg('2025-07-01', 'u-dan', 'u-sam')] }, // > 12 months, deactivated past assignee
    { key: 'API-10', type: 'Story', summary: 'Ledger v1', status: 'Done', assignee: 'u-tara', reporter: 'u-paula', components: ['ledger'], labels: ['checkout-2026'], created: '2026-03-01', resolved: '2026-05-01' },
    { key: 'API-11', type: 'Sub-task', parent: 'API-10', summary: 'Ledger migration', status: 'Done', assignee: 'u-sam', reporter: 'u-tara', created: '2026-03-10', resolved: '2026-04-25', history: [asg('2026-04-01', 'u-uri', 'u-sam')] }, // sub-task reassignment
    {
      key: 'API-12', type: 'Story', summary: 'Fraud rules v1', status: 'Done', assignee: 'u-vic', reporter: 'u-paula', components: ['payments'], created: '2026-01-05', resolved: '2026-02-14',
      history: [asg('2026-01-10', null, 'u-vic'), { at: '2026-02-14', author: 'u-vic', items: [{ field: 'status', from: 'In Progress', to: 'Done' }] }], // from-unassigned + status-only
    },

    // ---------------- Mobile ----------------
    { key: 'MOB-1', type: 'Epic', summary: 'Mobile wallet', status: 'In Progress', assignee: 'u-xan', reporter: 'u-paula', created: '2026-03-01', updated: '2026-10-20' },
    { key: 'MOB-2', type: 'Story', parent: 'MOB-1', summary: 'Wallet onboarding', status: 'In Progress', assignee: 'u-wen', reporter: 'u-paula', components: ['wallet'], created: '2026-09-15', updated: '2026-10-26' },
    { key: 'MOB-3', type: 'Story', summary: 'App icon refresh', status: 'To Do', assignee: 'u-wen', reporter: 'u-paula', components: ['wallet'], created: '2026-10-01', updated: '2026-10-22' },
    { key: 'MOB-4', type: 'Story', parent: 'MOB-1', summary: 'Offline cache', status: 'In Progress', assignee: 'u-xan', reporter: 'u-paula', components: ['wallet'], created: '2026-09-20', updated: '2026-10-27' },
    { key: 'MOB-5', type: 'Story', parent: 'MOB-1', summary: 'Wallet payments', status: 'To Do', assignee: 'u-xan', reporter: 'u-paula', components: ['wallet'], due: '2026-11-15', created: '2026-09-25', updated: '2026-10-25', points: 5 },
    { key: 'MOB-6', type: 'Task', summary: 'Push notification certs', status: 'To Do', assignee: null, reporter: 'u-paula', components: ['notifications'], created: '2026-09-20', updated: '2026-10-01' }, // unassigned blocker, stale
    { key: 'MOB-7', type: 'Story', summary: 'Order notifications', status: 'To Do', assignee: 'u-yui', reporter: 'u-paula', components: ['notifications'], created: '2026-09-25', updated: '2026-10-20' },
    { key: 'MOB-8', type: 'Story', parent: 'MOB-1', summary: 'Wallet UI', status: 'In Progress', assignee: 'u-yui', reporter: 'u-paula', components: ['wallet'], created: '2026-09-20', updated: '2026-10-27' },
    {
      key: 'MOB-9', type: 'Story', summary: 'Wallet prototype', status: 'Done', assignee: 'u-xan', reporter: 'u-paula', components: ['wallet'], created: '2026-02-20', resolved: '2026-04-10',
      history: [asg('2026-03-01', 'u-xan', 'u-wen'), asg('2026-03-15', 'u-wen', 'u-xan')], // bounced A->B->A
    },
    { key: 'MOB-10', type: 'Story', summary: 'Payments SDK spike', status: 'Done', assignee: 'u-wen', reporter: 'u-paula', components: ['wallet'], created: '2026-06-01', resolved: '2026-07-01' },
  ],
  links: [
    { id: 2001, type: 'blocks', from: 'DES-2', to: 'WEB-2' }, // Ken waits on Mia
    { id: 2002, type: 'blocks', from: 'DES-3', to: 'MOB-3' }, // Wen waits on Mia
    { id: 2003, type: 'blocks', from: 'DES-2', to: 'MOB-8' }, // Yui waits on Mia
    { id: 2004, type: 'blocks', from: 'DES-5', to: 'WEB-3' }, // Lea waits on Ivy
    { id: 2005, type: 'blocks', from: 'API-2', to: 'WEB-3' }, // Lea waits on Sam
    { id: 2006, type: 'blocks', from: 'WEB-3', to: 'WEB-5' }, // Omar waits on Lea
    { id: 2007, type: 'depends', from: 'MOB-5', to: 'API-2' }, // Xan waits on Sam ("depends on")
    { id: 2008, type: 'blocks', from: 'API-4', to: 'API-2' }, // sub-task -> rolls up to API-3: Sam waits on Tara
    { id: 2009, type: 'blocks', from: 'API-3', to: 'API-2' }, // duplicate of 2008 after rollup
    { id: 2010, type: 'blocks', from: 'API-5', to: 'API-6' }, // to sub-task of API-2: Sam waits on Vic
    { id: 2011, type: 'blocks', from: 'API-2', to: 'API-5' }, // Vic waits on Sam: cycle through a sub-task
    { id: 2012, type: 'blocks', from: 'MOB-6', to: 'MOB-7' }, // unassigned blocker
    { id: 2013, type: 'blocks', from: 'API-7', to: 'WEB-6' }, // deactivated-assignee blocker
    { id: 2014, type: 'blocks', from: 'DES-6', to: 'DES-2' }, // resolved
    { id: 2015, type: 'relates', from: 'WEB-2', to: 'MOB-3' }, // ignored
    { id: 2016, type: 'blocks', from: 'DES-4', to: 'DES-3' }, // sub-task blocks own parent: self after rollup
    { id: 2017, type: 'blocks', from: 'WEB-7', to: 'WEB-3' }, // resolved
    { id: 2018, type: 'blocks', from: 'DES-2', to: 'WEB-4' }, // Ken waits on Mia again (weight 2)
    // "builds on" (earlier work): context only, never arrows; chosen so no coverage score changes
    { id: 2019, type: 'buildsOn', from: 'MOB-4', to: 'MOB-9' }, // Offline cache builds on Wallet prototype (Xan; Wen past assignee)
    { id: 2020, type: 'sequence', from: 'MOB-8', to: 'MOB-9' }, // Wallet UI "follows" Wallet prototype: team's own link wording
    { id: 2021, type: 'buildsOn', from: 'MOB-2', to: 'MOB-10' }, // Wallet onboarding builds on Payments SDK spike (own work)
  ],
});
