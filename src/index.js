// Forge resolver: storage only. Jira data is read in the page with requestJira (runs as the current user).
import Resolver from '@forge/resolver';
import { kvs, WhereConditions } from '@forge/kvs';
import { makeStore } from './storage.js';

const store = makeStore(kvs, WhereConditions);
const resolver = new Resolver();

resolver.define('getAppLinks', async () => store.listLinks());
resolver.define('addAppLink', async ({ payload, context }) => store.addLink(payload, context.accountId));
resolver.define('removeAppLink', async ({ payload }) => store.removeLink(payload));
resolver.define('getTeams', async () => store.getTeams());
resolver.define('setTeams', async ({ payload, context }) => store.setTeams(payload?.teams, context.accountId));
resolver.define('getPrefs', async ({ context }) => store.getPrefs(context.accountId));
resolver.define('setPrefs', async ({ payload, context }) => store.setPrefs(context.accountId, payload?.prefs));
resolver.define('getDismissed', async ({ context }) => store.getDismissed(context.accountId));
resolver.define('setDismissed', async ({ payload, context }) => store.setDismissed(context.accountId, payload?.list));

export const handler = resolver.getDefinitions();
