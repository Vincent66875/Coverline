import { useEffect, useMemo, useRef, useState } from 'react';
import { RELATION_TYPES } from '../analysis/relationTypes.js';
import { teamNames, teamRoster } from '../analysis/coverage.js';
import { Keys } from './Panels.jsx';

const SOURCE_TEXT = { 'set in app': 'set here', 'team field': 'Team field', 'jira group': 'Jira group', 'project key': 'main project', none: 'no team' };
const LINK_TYPE_ROWS = {
  builds_on: ['Builds on', 'builds on', 'is built on by'],
  follows_up: ['Follows up', 'follows up on', 'is followed up by'],
  replaces: ['Replaces', 'replaces', 'is replaced by'],
  fixes: ['Fixes', 'fixes', 'is fixed by'],
  related: ['Relates', 'relates to', 'relates to'],
};
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Shown above the map when no blocks / depends links exist: points to what works without them. */
export function EmptyMapNotice({ single, onSingle, onSearch, onSetup }) {
  return (
    <section className="jtm-notice" data-testid="empty-map" aria-labelledby="jtm-empty-title">
      <h2 id="jtm-empty-title">No recorded dependencies yet</h2>
      <p>
        The arrows on this map come from Jira “blocks” and “depends on” links, and this project has none between people yet. You can still see where work rests with one
        person, and who has worked on any task: neither needs links.
      </p>
      <div className="jtm-notice-actions">
        <button type="button" className="jtm-btn jtm-btn--primary" onClick={onSingle}>Work only one person has worked on ({single.count})</button>
        <button type="button" className="jtm-btn" onClick={onSearch}>Find who has worked on a task</button>
        <button type="button" className="jtm-btn" onClick={onSetup}>How to get arrows</button>
      </div>
    </section>
  );
}

/** One-time banner: what would make this map more useful. */
export function SetupBanner({ todo, onOpen, onDismiss }) {
  return (
    <div className="jtm-banner" role="region" aria-label="Setup" data-testid="setup-banner">
      <span>
        <strong>{plural(todo, 'thing')}</strong> would make this map more useful.
      </span>
      <button type="button" className="jtm-btn jtm-btn--small jtm-btn--primary" onClick={onOpen}>Open setup</button>
      <button type="button" className="jtm-link" onClick={onDismiss}>Dismiss</button>
    </div>
  );
}

/** Open work only one person has worked on, grouped by person. */
export function SinglePersonPanel({ model, single, onPerson, onSearch, onOpen }) {
  if (!single.count) return <p className="jtm-muted">Every open task has at least one other person who has worked on it in the last 12 months.</p>;
  return (
    <div data-testid="single-person">
      <p className="jtm-muted">
        <Keys keys={single.keys} title="Open work only one person has worked on" onOpen={onOpen}>{single.count} of {single.openWork} open tasks</Keys> ({single.pct}%) have no one besides
        their assignee who has worked on them, as assignee, sub-task assignee, past assignee or on earlier work they build on, in the last 12 months. Tasks others wait on come first.
      </p>
      <ul className="jtm-single">
        {single.rows.map((r) => (
          <li key={r.personId} data-person={r.personId}>
            <div className="jtm-single-head">
              <button type="button" className="jtm-name" onClick={() => onPerson(r.personId)}>{r.name}</button>
              <span className="jtm-team">{r.team ?? 'No team'}</span>
              <span className="jtm-muted">{plural(r.tasks.length, 'task')}</span>
            </div>
            <ul>
              {r.tasks.map((t) => (
                <li key={t.key} data-single={t.key}>
                  <code>{t.key}</code> {t.summary}{' '}
                  {t.waitingKeys.length > 0 && <span className="jtm-pill jtm-pill--warm">{plural(t.waitingKeys.length, 'task')} waiting</span>}
                  {(t.statusBlocked || t.flagged || t.overdue) && <span className="jtm-pill jtm-pill--red">{[t.statusBlocked && 'Blocked', t.flagged && 'flagged', t.overdue && 'overdue'].filter(Boolean).join(', ')}</span>}
                  {t.stale && <span className="jtm-pill">no update in 14 days</span>}
                  <button type="button" className="jtm-link" onClick={() => onSearch(t.key)}>Who has worked near this?</button>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {model.personEdges.length === 0 && <p className="jtm-muted">Without dependency links this list can't tell which tasks others wait on.</p>}
    </div>
  );
}

/** Setup checklist: status of each kind of data and the action that fixes the gap. */
export function SetupPanel({ setup, onAction, onOpen }) {
  return (
    <div data-testid="setup">
      <p className="jtm-muted">The map works with no setup. Each item below makes it more complete.</p>
      <ol className="jtm-checklist">
        {setup.items.map((i) => (
          <li key={i.id} className={`jtm-check jtm-check--${i.status}`} data-check={i.id}>
            <span className="jtm-check-mark" aria-hidden="true">{i.status === 'ok' ? '✓' : i.status === 'todo' ? '!' : 'i'}</span>
            <div>
              <h4>
                {i.title} <span className="jtm-sr-only">({i.status === 'ok' ? 'done' : i.status === 'todo' ? 'to do' : 'information'})</span>
              </h4>
              <p>{i.detail}</p>
              {i.id === 'linktypes' && i.missing.length > 0 && <LinkTypeTable missing={i.missing} />}
              <div className="jtm-check-actions">
                {i.action && i.action !== 'tickets' && i.action !== 'linktypes' && (
                  <button type="button" className="jtm-btn jtm-btn--small" onClick={() => onAction(i.action)} data-action={i.action}>{i.actionLabel}</button>
                )}
                {i.keys?.length > 0 && (i.action === 'tickets' || !i.action) && (
                  <Keys keys={i.keys} title={i.title} onOpen={onOpen} className="jtm-btn jtm-btn--small">{i.action === 'tickets' ? i.actionLabel : `Show ${plural(i.keys.length, 'task')}`}</Keys>
                )}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function LinkTypeTable({ missing }) {
  return (
    <div className="jtm-linktypes" data-testid="linktype-table">
      <p className="jtm-muted">A Jira admin can add these in Jira settings → Issues → Issue linking:</p>
      <table>
        <thead>
          <tr><th scope="col">Name</th><th scope="col">Outward description</th><th scope="col">Inward description</th></tr>
        </thead>
        <tbody>
          {missing.map((t) => (
            <tr key={t}>{LINK_TYPE_ROWS[t].map((c) => <td key={c}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
      <p className="jtm-muted">After adding them, reload this page. Until then, {missing.map((t) => RELATION_TYPES[t].label).join(', ')} links are saved in the app.</p>
    </div>
  );
}

/**
 * Team editor. Anyone can change teams; teams are shared across all projects on the site.
 * onSave({ [accountId]: team | '' }) saves a batch ('' = back to the suggested team).
 */
export function TeamEditor({ model, onSave, focusId = null, busy = false }) {
  const roster = useMemo(() => teamRoster(model), [model]);
  const names = useMemo(() => teamNames(model), [model]);
  const [newFor, setNewFor] = useState(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [renameTo, setRenameTo] = useState('');
  const guessed = roster.filter((r) => r.source !== 'set in app' && r.suggested);
  const members = (team) => roster.filter((r) => r.team === team);
  const focusRef = useRef(null);
  // after the drawer focuses its heading: move focus to the person's team picker
  useEffect(() => {
    if (!focusId) return undefined;
    const raf = requestAnimationFrame(() => {
      focusRef.current?.scrollIntoView?.({ block: 'center' });
      focusRef.current?.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [focusId]);

  const choose = (r, value) => {
    if (value === '__new') {
      setNewFor(r.accountId);
      setNewName('');
      return;
    }
    if (value === '__suggested') return onSave({ [r.accountId]: '' });
    onSave({ [r.accountId]: value });
  };
  return (
    <div data-testid="team-editor">
      <p className="jtm-muted">Teams set here are used on every project and win over the Team field and projects. Anyone can change them.</p>
      {guessed.length > 0 && (
        <p>
          <button type="button" className="jtm-btn jtm-btn--small" disabled={busy} onClick={() => onSave(Object.fromEntries(guessed.map((r) => [r.accountId, r.suggested])))} data-testid="accept-suggested">
            Keep all {guessed.length} suggested teams
          </button>{' '}
          <span className="jtm-muted">Saves today's guesses so they stop changing with project activity.</span>
        </p>
      )}

      <h4>Teams</h4>
      <ul className="jtm-team-list">
        {names.map((t) => (
          <li key={t} data-team={t}>
            {renaming === t ? (
              <form
                className="jtm-inline-field"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const to = renameTo.trim();
                  if (to && to !== t) onSave(Object.fromEntries(members(t).map((r) => [r.accountId, to])));
                  setRenaming(null);
                }}
              >
                <label className="jtm-sr-only" htmlFor={`jtm-rename-${t}`}>New name for {t}</label>
                <input id={`jtm-rename-${t}`} value={renameTo} autoFocus onChange={(ev) => setRenameTo(ev.target.value)} maxLength={60} onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), setRenaming(null))} />
                <button type="submit" className="jtm-btn jtm-btn--small">Rename</button>
              </form>
            ) : (
              <>
                <strong>{t}</strong> <span className="jtm-muted">{plural(members(t).length, 'person', 'people')}</span>
                {members(t).length > 0 && (
                  <button type="button" className="jtm-link" onClick={() => { setRenaming(t); setRenameTo(t); }} aria-label={`Rename ${t}`}>Rename</button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>

      <h4>People</h4>
      <table className="jtm-roster">
        <thead>
          <tr><th scope="col">Person</th><th scope="col">Team</th><th scope="col">From</th></tr>
        </thead>
        <tbody>
          {roster.map((r) => (
            <tr key={r.accountId} data-roster={r.accountId} className={focusId === r.accountId ? 'jtm-roster--focus' : ''}>
              <th scope="row">{r.name}</th>
              <td>
                {newFor === r.accountId ? (
                  <form
                    className="jtm-inline-field"
                    onSubmit={(ev) => {
                      ev.preventDefault();
                      if (newName.trim()) onSave({ [r.accountId]: newName.trim() });
                      setNewFor(null);
                    }}
                  >
                    <label className="jtm-sr-only" htmlFor={`jtm-new-${r.accountId}`}>New team for {r.name}</label>
                    <input id={`jtm-new-${r.accountId}`} value={newName} autoFocus maxLength={60} placeholder="Team name" onChange={(ev) => setNewName(ev.target.value)} onKeyDown={(ev) => ev.key === 'Escape' && (ev.stopPropagation(), setNewFor(null))} />
                    <button type="submit" className="jtm-btn jtm-btn--small">Add</button>
                  </form>
                ) : (
                  <select value={r.team ?? ''} disabled={busy} onChange={(ev) => choose(r, ev.target.value)} aria-label={`Team for ${r.name}`} ref={focusId === r.accountId ? focusRef : undefined}>
                    {!r.team && <option value="">No team</option>}
                    {names.map((t) => <option key={t} value={t}>{t}</option>)}
                    {r.source === 'set in app' && <option value="__suggested">Back to suggested{r.suggested ? ` (${r.suggested})` : ''}</option>}
                    <option value="__new">+ New team…</option>
                  </select>
                )}
              </td>
              <td className="jtm-muted">{SOURCE_TEXT[r.source] ?? r.source}{r.reporterOnly ? ' · reports only' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
