// Team renames. Pure, no React.
// Renames are stored next to the per-person teams (same storage, same resolver), under keys
// "alias:<base64url of the old name>" whose value is the new name. Real accountIds never start with "alias:".
export const ALIAS_PREFIX = 'alias:';

const toB64url = (s) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const aliasKey = (oldName) => `${ALIAS_PREFIX}${toB64url(oldName)}`;

/** Stored map -> { overrides: { accountId: team }, aliases: { oldName: newName } }. */
export function splitTeams(stored = {}) {
  const overrides = {};
  const aliases = {};
  for (const [k, v] of Object.entries(stored)) {
    if (!k.startsWith(ALIAS_PREFIX)) overrides[k] = v;
    else {
      try {
        aliases[fromB64url(k.slice(ALIAS_PREFIX.length))] = v;
      } catch {
        /* unreadable key: ignore */
      }
    }
  }
  return { overrides, aliases };
}

/** Follow renames (A -> B -> C), stopping on loops. */
export function resolveAlias(aliases, name) {
  let t = name;
  const seen = new Set();
  while (t && aliases[t] && !seen.has(t)) {
    seen.add(t);
    t = aliases[t];
  }
  return t;
}

/**
 * Changes to save when team `from` is renamed to `to`:
 * - every person whose saved team is `from` moves to `to`;
 * - the old name (and any name that was already renamed to it) now points at `to`, so people whose team
 *   comes from the Team field, a group or a project with that name follow the rename too.
 * Renaming back to an original name removes the rename.
 */
export function renameChanges({ overrides, aliases }, from, to) {
  const changes = {};
  for (const [id, team] of Object.entries(overrides)) if (team === from) changes[id] = to;
  const olds = [from, ...Object.keys(aliases).filter((o) => resolveAlias(aliases, o) === from)];
  const madeByRename = new Set(Object.values(aliases)); // in-between names exist only because of an earlier rename
  for (const old of new Set(olds)) changes[aliasKey(old)] = old === to || madeByRename.has(old) ? '' : to;
  if (aliases[to]) changes[aliasKey(to)] = ''; // `to` is a real team name again
  return changes;
}
