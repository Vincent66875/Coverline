import { useCallback, useEffect, useMemo, useState } from 'react';
import App from './App.jsx';
import { makeRequest } from './jira/request.js';
import { loadProjectData, refreshLinks } from './jira/loadData.js';
import { makeLinkStore } from './jira/linkStore.js';
import { RELATION_ORDER } from './analysis/relationTypes.js';

const STEP_TEXT = {
  fields: 'Checking fields',
  issues: 'Reading issues',
  linked: 'Reading linked issues in other projects',
  parents: 'Reading parent epics',
  history: 'Reading assignee history',
  'link types': 'Reading link types',
  storage: 'Reading links saved in the app',
};

function progressText(p) {
  if (!p) return 'Starting…';
  const base = STEP_TEXT[p.step] ?? p.step;
  if (p.of) return `${base}… ${p.loaded} of ${p.of}`;
  if (p.loaded != null) return `${base}… ${p.loaded}`;
  return `${base}…`;
}

function notesFrom(meta) {
  const n = [];
  n.push(`${meta.projectIssues} issues from ${meta.projectKey} (open, or resolved in the last 12 months), plus ${meta.linkedIssues} linked issues from other projects and ${meta.parentIssues} parent epics.`);
  n.push(meta.teamField ? 'Team columns use teams set in the app first, then the Atlassian Team field, then each person’s most common project.' : 'This site has no Team field, so team columns use teams set in the app, then each person’s most common project.');
  n.push(meta.flaggedField ? 'Flagged work counts as blocked.' : 'This site has no Flagged field; only a status named “Blocked” counts as blocked.');
  if (meta.truncated) n.push('Only the first 2,000 project issues were read.');
  if (meta.hiddenLinked.length) n.push(`${meta.hiddenLinked.length} linked issues could not be read (deleted, or in projects you cannot browse): ${meta.hiddenLinked.slice(0, 8).join(', ')}${meta.hiddenLinked.length > 8 ? '…' : ''}.`);
  if (meta.changelogFetched) n.push(`Full assignee history read for ${meta.changelogFetched} issues with long histories.`);
  if (meta.changelogIncomplete) n.push(`Assignee history may be incomplete for ${meta.changelogIncomplete} issues.`);
  for (const w of meta.warnings) n.push(w);
  return n;
}

/**
 * Forge wrapper: loads the current project from Jira (as the signed-in user), the links saved in the app,
 * and this user's dismissed suggestions; then renders the same App as the MVP.
 * bridge: { view, requestJira, invoke } from @forge/bridge (injected so it can be mocked).
 */
export default function ForgeRoot({ bridge }) {
  const { view, requestJira, invoke } = bridge;
  const request = useMemo(() => makeRequest(requestJira), [requestJira]);
  const [ctx, setCtx] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [appLinks, setAppLinks] = useState([]);
  const [dismissed, setDismissed] = useState([]);
  const [teams, setTeams] = useState({});
  const [prefs, setPrefs] = useState({});

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const c = await view.getContext();
      setCtx(c);
      const key = c?.extension?.project?.key;
      if (!key) throw new Error('This page needs to be opened from a Jira project.');
      const d = await loadProjectData(request, key, { onProgress: setProgress });
      setProgress({ step: 'storage' });
      const [links, dis, savedTeams, savedPrefs] = await Promise.all([
        invoke('getAppLinks').catch(() => {
          d.meta.warnings.push('Links saved in the app could not be read.');
          return [];
        }),
        invoke('getDismissed').catch(() => []),
        invoke('getTeams').catch(() => {
          d.meta.warnings.push('Teams set in the app could not be read.');
          return {};
        }),
        invoke('getPrefs').catch(() => ({})),
      ]);
      setData(d);
      setAppLinks(links ?? []);
      setDismissed(dis ?? []);
      setTeams(savedTeams ?? {});
      setPrefs(savedPrefs ?? {});
      setPhase('ready');
    } catch (e) {
      setError(e);
      setPhase('error');
    }
  }, [view, request, invoke]);

  useEffect(() => {
    load();
  }, [load]);

  const linkOps = useMemo(() => {
    if (!data) return null;
    const store = makeLinkStore({ request, invoke, linkTypes: data.linkTypes });
    const after = async (r) => {
      if (r.keys.length) setData(await refreshLinks(request, data, r.keys));
      if (r.saved === 'app' || r.next) setAppLinks((await invoke('getAppLinks')) ?? []);
      return r;
    };
    return {
      add: async (link) => after(await store.add(link)),
      change: async (link, change) => after(await store.change(link, change)),
      remove: async (link) => {
        const r = await store.remove(link);
        if (link.source !== 'jira') setAppLinks((await invoke('getAppLinks')) ?? []);
        if (r.keys.length) setData(await refreshLinks(request, data, r.keys));
        return r;
      },
      coverage: store.coverage(RELATION_ORDER),
    };
  }, [data, request, invoke]);

  const teamOps = useMemo(
    () => ({
      teams,
      save: async (changes) => setTeams((await invoke('setTeams', { teams: changes })) ?? {}),
    }),
    [teams, invoke],
  );
  const onPrefs = useCallback(
    (next) => {
      setPrefs(next);
      invoke('setPrefs', { prefs: next }).catch(() => {});
    },
    [invoke],
  );

  const onDismiss = useCallback(
    (pair) => {
      const next = [...new Set([...dismissed, pair])];
      setDismissed(next);
      invoke('setDismissed', { list: next }).catch(() => {});
    },
    [dismissed, invoke],
  );

  if (phase === 'loading')
    return (
      <div className="jtm jtm-state" role="status" aria-live="polite" data-testid="loading">
        <div className="jtm-spinner" aria-hidden="true" />
        <p>{progressText(progress)}</p>
      </div>
    );
  if (phase === 'error')
    return (
      <div className="jtm jtm-state" role="alert" data-testid="load-error">
        <h2>Team map could not load</h2>
        <p>{error?.status === 403 ? 'You do not have permission to read this project’s issues.' : error?.status === 429 ? 'Jira is busy (rate limit). Try again in a minute.' : error?.message ?? 'Unknown error.'}</p>
        <button type="button" className="jtm-btn" onClick={load}>Try again</button>
      </div>
    );
  if (!data.issues.length)
    return (
      <div className="jtm jtm-state" data-testid="empty">
        <h2>No issues to map yet</h2>
        <p>{ctx?.extension?.project?.key} has no open issues and nothing resolved in the last 12 months.</p>
      </div>
    );
  return (
    <App
      fixture={data}
      initialViewer={ctx?.accountId ?? null}
      linkOps={linkOps}
      extraRelations={appLinks}
      dismissed={dismissed}
      onDismiss={onDismiss}
      dataNotes={notesFrom(data.meta)}
      linkCoverage={linkOps?.coverage}
      meta={data.meta}
      teamOps={teamOps}
      prefs={prefs}
      onPrefs={onPrefs}
    />
  );
}
