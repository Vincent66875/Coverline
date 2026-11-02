// Browser stand-in for @forge/bridge, for checking the Forge page outside Jira.
// URL params: ?project=DES&as=u-mia&types=builds_on,fixes&fail=search|storage&empty=1
import large from '../fixtures/large.js';
import { mockJira, fakeKvs } from './jira.js';
import { makeStore } from '../../src/storage.js';

const params = new URLSearchParams(globalThis.location?.search ?? '');
const EXTRA = {
  builds_on: { id: '20000', name: 'Builds on', inward: 'is built on by', outward: 'builds on' },
  fixes: { id: '20001', name: 'Fixes', inward: 'is fixed by', outward: 'fixes' },
};
const extraLinkTypes = (params.get('types') ?? '').split(',').filter(Boolean).map((t) => EXTRA[t]);
const flagged = (params.get('flagged') ?? '').split(',').filter(Boolean);
const jira = mockJira(large, { pageSize: 10, changelogCap: 20, extraLinkTypes, flagged, noLinks: params.get('nolinks') === '1' });
const { kvs, WhereConditions } = fakeKvs();
const store = makeStore(kvs, WhereConditions);
const ACCOUNT = params.get('as') ?? 'u-mia';
globalThis.__mock = { jira, kvs, calls: jira.calls, invokes: [] };

export const view = {
  getContext: async () => ({ accountId: ACCOUNT, cloudId: 'cloud-1', moduleKey: 'team-map-project-page', extension: { type: 'jira:projectPage', project: { id: '10000', key: params.get('empty') ? 'NONE' : params.get('project') ?? 'DES', type: 'software' } } }),
  theme: { enable: async () => {} },
};

export async function requestJira(path, init) {
  await new Promise((r) => setTimeout(r, 5));
  if (params.get('fail') === 'search' && path.startsWith('/rest/api/3/search/jql'))
    return { status: 403, ok: false, headers: { get: () => null }, json: async () => ({ errorMessages: ['No permission'] }), text: async () => '' };
  return jira.fetcher(path, init);
}

export async function invoke(fn, payload) {
  globalThis.__mock.invokes.push({ fn, payload });
  if (params.get('fail') === 'storage') throw new Error('storage down');
  const ctx = { accountId: ACCOUNT };
  switch (fn) {
    case 'getAppLinks': return store.listLinks();
    case 'addAppLink': return store.addLink(payload, ctx.accountId);
    case 'removeAppLink': return store.removeLink(payload);
    case 'getDismissed': return store.getDismissed(ctx.accountId);
    case 'getTeams': return store.getTeams();
    case 'setTeams': return store.setTeams(payload?.teams, ctx.accountId);
    case 'getPrefs': return store.getPrefs(ctx.accountId);
    case 'setPrefs': return store.setPrefs(ctx.accountId, payload?.prefs);
    case 'setDismissed': return store.setDismissed(ctx.accountId, payload?.list);
    default: throw new Error(`no resolver ${fn}`);
  }
}
