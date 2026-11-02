// Small test fixture: 7 accounts, 11 issues, 8 links. Exact expected values live in test/.
import { buildFixture } from './build.js';

const DEF = 'jira-software-users';

export default buildFixture({
  name: 'small',
  asOf: '2026-10-29T12:00:00.000+0000',
  projects: { PLAT: 'Platform', APP: 'App' },
  users: [
    { accountId: 'u-ana', displayName: 'Ana', active: true, accountType: 'atlassian', team: 'Platform', groups: [DEF] },
    { accountId: 'u-ben', displayName: 'Ben', active: true, accountType: 'atlassian', groups: [DEF, 'platform-team'] },
    { accountId: 'u-cy', displayName: 'Cy', active: true, accountType: 'atlassian', groups: [DEF] },
    { accountId: 'u-dee', displayName: 'Dee', active: true, accountType: 'atlassian', team: 'App', groups: [DEF] },
    { accountId: 'u-pam', displayName: 'Pam', active: true, accountType: 'atlassian', team: 'Product', groups: [DEF] },
    { accountId: 'u-eli', displayName: 'Eli', active: false, accountType: 'atlassian', groups: [DEF] },
    { accountId: 'u-bot', displayName: 'Automation for Jira', active: true, accountType: 'app', groups: [] },
  ],
  issues: [
    {
      key: 'PLAT-1', type: 'Story', summary: 'Auth service', status: 'In Progress', assignee: 'u-ana', reporter: 'u-pam',
      components: ['auth'], due: '2026-11-01', created: '2026-08-20', updated: '2026-10-27', points: 5,
      history: [{ at: '2026-09-01', items: [{ field: 'assignee', from: 'u-ben', to: 'u-ana' }] }], // handoff
    },
    {
      key: 'PLAT-2', type: 'Sub-task', parent: 'PLAT-1', summary: 'Token refresh', status: 'In Progress', assignee: 'u-ben',
      reporter: 'u-ana', created: '2026-08-25', updated: '2026-10-20',
      history: [{ at: '2026-09-05', items: [{ field: 'assignee', from: 'u-eli', to: 'u-ben' }] }], // deactivated past assignee
    },
    {
      key: 'PLAT-3', type: 'Story', summary: 'Rate limiter', status: 'Blocked', assignee: 'u-ben', reporter: 'u-bot',
      created: '2026-09-01', updated: '2026-10-10', points: 3,
      history: [
        { at: '2026-09-10', author: 'u-ben', items: [{ field: 'assignee', from: null, to: 'u-ben' }] }, // from-unassigned
        { at: '2026-09-20', author: 'u-ben', items: [{ field: 'status', from: 'To Do', to: 'Blocked' }] }, // status-only
      ],
    },
    { key: 'PLAT-4', type: 'Task', summary: 'Logging', status: 'To Do', assignee: null, reporter: 'u-pam', created: '2026-10-01', updated: '2026-10-25' },
    {
      key: 'PLAT-5', type: 'Story', summary: 'DB migration', status: 'Done', assignee: 'u-ana', reporter: 'u-pam',
      created: '2026-06-01', resolved: '2026-08-01', updated: '2026-08-01',
    },
    {
      key: 'PLAT-6', type: 'Task', summary: 'Metrics', status: 'In Progress', assignee: 'u-eli', reporter: 'u-ana',
      due: '2026-10-20', created: '2026-09-15', updated: '2026-10-28',
    },
    { key: 'APP-5', type: 'Epic', summary: 'Login revamp', status: 'In Progress', assignee: 'u-dee', reporter: 'u-pam', created: '2026-08-01', updated: '2026-10-01' },
    {
      key: 'APP-1', type: 'Story', parent: 'APP-5', summary: 'Login screen', status: 'To Do', assignee: 'u-cy', reporter: 'u-pam',
      components: ['auth'], labels: ['login'], due: '2026-11-10', created: '2026-09-20', updated: '2026-10-28',
      history: [
        { at: '2026-10-01', items: [{ field: 'assignee', from: 'u-cy', to: 'u-dee' }] }, // bounce A->B
        { at: '2026-10-05', items: [{ field: 'assignee', from: 'u-dee', to: 'u-cy' }] }, // B->A
      ],
    },
    { key: 'APP-2', type: 'Story', summary: 'Session handling', status: 'To Do', assignee: 'u-dee', reporter: 'u-pam', created: '2026-09-25', updated: '2026-10-26' },
    {
      key: 'APP-3', type: 'Story', parent: 'APP-5', summary: 'Checkout', status: 'To Do', assignee: 'u-dee', reporter: 'u-pam',
      labels: ['login'], due: '2026-10-25', created: '2026-09-25', updated: '2026-10-27',
    },
    {
      key: 'APP-4', type: 'Sub-task', parent: 'APP-2', summary: 'Session store', status: 'In Progress', assignee: 'u-cy',
      reporter: 'u-dee', created: '2026-10-01', updated: '2026-10-26',
      history: [{ at: '2026-10-12', items: [{ field: 'assignee', from: 'u-dee', to: 'u-cy' }] }], // sub-task reassignment
    },
  ],
  links: [
    { id: 1001, type: 'blocks', from: 'PLAT-1', to: 'APP-1' },
    { id: 1002, type: 'depends', from: 'APP-2', to: 'PLAT-3' }, // reversed wording
    { id: 1003, type: 'blocks', from: 'APP-1', to: 'APP-3' },
    { id: 1004, type: 'blocks', from: 'PLAT-4', to: 'APP-3' }, // unassigned blocker
    { id: 1005, type: 'blocks', from: 'PLAT-2', to: 'APP-1' }, // duplicate of 1001 after rollup
    { id: 1006, type: 'blocks', from: 'APP-4', to: 'PLAT-3' }, // cycle with 1002 through a sub-task
    { id: 1007, type: 'relates', from: 'APP-1', to: 'PLAT-3' }, // ignored
    { id: 1008, type: 'blocks', from: 'PLAT-5', to: 'PLAT-1' }, // resolved
    { id: 1009, type: 'buildsOn', from: 'APP-2', to: 'PLAT-5' }, // Session handling builds on DB migration (Ana's earlier work)
  ],
});
