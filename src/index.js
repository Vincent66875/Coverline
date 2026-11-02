// Forge resolver: storage only. Jira data is read in the page with requestJira (runs as the current user).
// Namespace imports + pick(): package.json has "type": "module" (for the node tests), and Forge's bundler then
// hands a CommonJS package's default import back as the whole module object ("…namespaceObject is not a constructor").
// pick() finds the export whether it sits at the top, on .default, or on .default.default.
import * as resolverPkg from '@forge/resolver';
import * as kvsPkg from '@forge/kvs';
import { makeStore } from './storage.js';

function pick(mod, name, test) {
  const spots = name === 'default' ? [mod.default?.default, mod.default, mod] : [mod[name], mod.default?.[name], mod.default?.default?.[name]];
  const found = spots.find(test);
  if (!found) throw new Error(`Could not load ${name} from a Forge package`);
  return found;
}

const Resolver = pick(resolverPkg, 'default', (x) => typeof x === 'function');
const kvs = pick(kvsPkg, 'kvs', (x) => x && typeof x.get === 'function');
const WhereConditions = pick(kvsPkg, 'WhereConditions', (x) => x && typeof x.beginsWith === 'function');

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