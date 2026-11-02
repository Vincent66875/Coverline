// Forge storage for links that the site has no Jira link type for, and per-user dismissed suggestions.
// The kvs client is injected so this runs in node tests with a fake.

// Forge storage keys allow letters, digits and : . _ - # (no "~"), so parts are joined with ":".
const RELATIONS = new Set(['builds_on', 'follows_up', 'replaces', 'fixes', 'related']);
const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/;
export const linkKey = (l) => `wl:${l.fromKey}:${l.type}:${l.toKey}`;
const dismissedKey = (accountId) => `dismissed:${accountId}`;
const teamKey = (accountId) => `team:${accountId}`;
const prefsKey = (accountId) => `prefs:${accountId}`;
const ACCOUNT_RE = /^[A-Za-z0-9:._-]{1,128}$/;
const cleanTeam = (t) => (typeof t === 'string' ? t.trim().replace(/\s+/g, ' ').slice(0, 60) : '');

function validLink(l) {
  return l && KEY_RE.test(l.fromKey ?? '') && KEY_RE.test(l.toKey ?? '') && l.fromKey !== l.toKey && RELATIONS.has(l.type);
}

export function makeStore(kvs, WhereConditions) {
  return {
    async listLinks() {
      const out = [];
      let cursor;
      do {
        let q = kvs.query().where('key', WhereConditions.beginsWith('wl:')).limit(100);
        if (cursor) q = q.cursor(cursor);
        const page = await q.getMany();
        out.push(...page.results.map((r) => r.value));
        cursor = page.nextCursor;
      } while (cursor);
      return out;
    },
    async addLink(link, accountId, now = new Date().toISOString()) {
      if (!validLink(link)) throw new Error('Invalid link');
      const value = { fromKey: link.fromKey, toKey: link.toKey, type: link.type, createdBy: accountId ?? null, createdAt: now };
      await kvs.set(linkKey(value), value);
      return value;
    },
    async removeLink(link) {
      if (!validLink(link)) throw new Error('Invalid link');
      await kvs.delete(linkKey(link));
      return true;
    },
    /** Teams set in the app: { [accountId]: teamName }. Site-wide, not per project. */
    async getTeams() {
      const out = {};
      let cursor;
      do {
        let q = kvs.query().where('key', WhereConditions.beginsWith('team:')).limit(100);
        if (cursor) q = q.cursor(cursor);
        const page = await q.getMany();
        for (const r of page.results) out[r.key.slice(5)] = r.value.team;
        cursor = page.nextCursor;
      } while (cursor);
      return out;
    },
    /** Set (or clear, with an empty team) one person's team. */
    async setTeam(accountId, team, by, now = new Date().toISOString()) {
      if (!ACCOUNT_RE.test(accountId ?? '')) throw new Error('Invalid person');
      const name = cleanTeam(team);
      if (!name) {
        await kvs.delete(teamKey(accountId));
        return null;
      }
      await kvs.set(teamKey(accountId), { team: name, by: by ?? null, at: now });
      return name;
    },
    /** Set several people at once: { [accountId]: teamName | '' }. */
    async setTeams(map, by) {
      const entries = Object.entries(map ?? {}).slice(0, 500);
      for (const [id, team] of entries) await this.setTeam(id, team, by);
      return this.getTeams();
    },
    async getPrefs(accountId) {
      return (await kvs.get(prefsKey(accountId))) ?? {};
    },
    async setPrefs(accountId, prefs) {
      const clean = { setupBannerDismissed: !!prefs?.setupBannerDismissed };
      await kvs.set(prefsKey(accountId), clean);
      return clean;
    },
    async getDismissed(accountId) {
      return (await kvs.get(dismissedKey(accountId))) ?? [];
    },
    async setDismissed(accountId, list) {
      const clean = [...new Set((Array.isArray(list) ? list : []).filter((x) => typeof x === 'string' && x.length < 64))].slice(-500);
      await kvs.set(dismissedKey(accountId), clean);
      return clean;
    },
  };
}
