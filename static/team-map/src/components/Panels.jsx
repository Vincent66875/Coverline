import { useState } from 'react';
import { FORMULA, FORMULA_NOTES } from '../analysis/scoring.js';
import { areas, evidenceText } from '../analysis/search.js';
import { ZOOMS } from '../analysis/labels.js';
import { linksOf } from '../analysis/relations.js';
import { RELATION_TYPES } from '../analysis/relationTypes.js';
import Avatar from './Avatar.jsx';
import Icon from './Icons.jsx';
import { Combobox } from './Combobox.jsx';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Any number or phrase backed by ticket keys opens those tickets. */
export function Keys({ keys, title, onOpen, children, className = 'jtm-num' }) {
  if (!keys?.length) return <span className={className.replace(/\bjtm-num\b/, '').trim() || undefined}>{children}</span>;
  return (
    <button type="button" className={className} onClick={() => onOpen(title ?? String(children), keys)} title={keys.join(', ')}>
      {children}
    </button>
  );
}

function Panel({ title, testid, onClose, children, level = 3, bare = false }) {
  const H = `h${level}`;
  if (bare)
    return (
      <section className="jtm-panel jtm-panel--bare" aria-label={title} data-testid={testid}>
        {children}
      </section>
    );
  return (
    <section className="jtm-panel" aria-label={title} data-testid={testid}>
      <header>
        <H>{title}</H>
        {onClose && <button type="button" className="jtm-close" onClick={onClose} aria-label={`Close ${title}`}>×</button>}
      </header>
      {children}
    </section>
  );
}

// ------------------------------------------------------------------ tickets
export function TicketList({ model, title, keys, onClose, bare }) {
  return (
    <Panel title={title} testid="ticket-list" onClose={onClose} bare={bare}>
      <ul className="jtm-tickets">
        {keys.map((k) => {
          const i = model.issueByKey.get(k);
          return (
            <li key={k}>
              <code>{k}</code> {i.summary} <span className="jtm-status">{i.status}{i.ownerId ? ` · ${model.nameOf(i.ownerId)}` : ' · unassigned'}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

// ------------------------------------------------------------------ search
/** compact: one-line box for the top bar (label hidden, Enter or the button searches). */
export function SearchBox({ model, onSearch, defaultValue = '', compact = false, inputRef = null, id = 'jtm-search-input' }) {
  const [value, setValue] = useState(defaultValue);
  const a = areas(model);
  const options = [
    ...model.issues.filter((i) => !i.isEpic).map((i) => ({ v: i.key, l: i.summary })),
    ...a.epics.map((e) => ({ v: `epic:${e.key}`, l: e.summary })),
    ...a.components.map((c) => ({ v: `component:${c}`, l: 'component' })),
    ...a.labels.map((l) => ({ v: `label:${l}`, l: 'label' })),
  ];
  if (compact) {
    const tags = { epic: 'Epic', component: 'Component', label: 'Label' };
    return (
      <Combobox
        id={id}
        icon="search"
        label="Who has worked on this?"
        placeholder="Who has worked on…"
        title="Ticket key (DES-2), epic:KEY, component:name or label:name"
        inputRef={inputRef}
        testid="search-input"
        value={value}
        onChange={setValue}
        onSubmit={onSearch}
        options={options
          .filter((o) => o.v !== 'label:jtm-seed')
          .map((o) => {
            const kind = o.v.includes(':') ? o.v.split(':')[0] : null;
            return { value: o.v, title: kind === 'component' || kind === 'label' ? null : o.l, tag: tags[kind] };
          })}
      />
    );
  }
  return (
    <form
      className={`jtm-search${compact ? ' jtm-search--compact' : ''}`}
      role="search"
      onSubmit={(ev) => {
        ev.preventDefault();
        if (value.trim()) onSearch(value);
      }}
    >
      <label htmlFor={id} className={compact ? 'jtm-sr-only' : undefined}>Who has worked on this?</label>
      {compact && <Icon name="search" className="jtm-search-icon" />}
      <input
        id={id}
        ref={inputRef}
        list={`${id}-options`}
        placeholder={compact ? 'Who has worked on…' : 'Ticket key, epic:, component: or label:'}
        title="Ticket key (DES-2), epic:KEY, component:name or label:name"
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        data-testid="search-input"
      />
      <datalist id={`${id}-options`}>
        {options.map((o) => (
          <option key={o.v} value={o.v}>{o.l}</option>
        ))}
      </datalist>
      {!compact && <button type="submit" className="jtm-btn">Search</button>}
    </form>
  );
}

export function WorkedOnPanel({ result, onClose, onOpen, bare }) {
  if (!result.query)
    return (
      <Panel title="Who has worked on this?" testid="worked-on" onClose={onClose} bare={bare}>
        <p>No ticket or area matches “{result.input}”. Try a key like DES-2, or epic:, component:, label:.</p>
      </Panel>
    );
  return (
    <Panel title={`Who has worked on ${result.label}?`} testid="worked-on" onClose={onClose} bare={bare}>
      <p className="jtm-muted">
        People who have worked on this or related work in the last 12 months, closest first:{' '}
        <Keys keys={result.keys} title={`Related work for ${result.label}`} onOpen={onOpen}>{plural(result.keys.length, 'related ticket')}</Keys>.
      </p>
      {result.people.length === 0 ? (
        <p>No one in the last 12 months.</p>
      ) : (
        <ol className="jtm-worked">
          {result.people.map((p) => (
            <li key={p.personId} data-person={p.personId}>
              <strong>{p.name}</strong>
              {p.out && <span className="jtm-pill jtm-pill--out">marked out</span>}
              <span className="jtm-tier">{p.tierLabel}</span>
              <span className="jtm-evidence">{p.evidence.map(evidenceText).join(' · ')}</span>
            </li>
          ))}
        </ol>
      )}
      {result.more > 0 && <p className="jtm-muted">{result.more} more not shown.</p>}
      {result.dropped > 0 && <p className="jtm-muted">{plural(result.dropped, 'record')} older than 12 months left out.</p>}
    </Panel>
  );
}

// ------------------------------------------------------------------ ranking
/** "How coverage risk is counted": collapsed by default. */
export function FormulaLine() {
  const short = { cold: 'cold task', warm: 'warm task', blockedOrOverdue: 'task Blocked, flagged or overdue', waiting: 'each person left waiting', soleTeamLink: 'sole team link', leadChange: 'lead change' };
  return (
    <details className="jtm-formula" data-testid="formula">
      <summary>How coverage risk is counted</summary>
      <p>
        <strong>Coverage risk</strong> = what is left uncovered if this person is also out:{' '}
        {FORMULA.map((f, i) => (
          <span key={f.kind}>
            {i > 0 && ' · '}
            {short[f.kind]} <b>+{f.points}</b>
          </span>
        ))}
      </p>
      <ul>
        {FORMULA.map((f) => (
          <li key={f.kind}>+{f.points} {f.unit}: {f.text}</li>
        ))}
        {FORMULA_NOTES.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

/** One person: avatar, name, team, score, mark out; "How N is counted" opens their parts. */
function RankingRow({ r, absent, selected, onSelect, onToggleOut, onOpen, avatarUrl }) {
  const [open, setOpen] = useState(false);
  const allKeys = [...new Set(r.components.flatMap((c) => c.keys))];
  const partsId = `jtm-parts-${r.personId}`;
  return (
    <li data-person={r.personId} className={`${r.out ? 'jtm-row--out' : ''}${selected ? ' jtm-row--selected' : ''}`}>
      <div className="jtm-row-head">
        <Avatar name={r.name} url={avatarUrl} className="jtm-avatar jtm-avatar--row" />
        <span className="jtm-row-who">
          <button type="button" className="jtm-name" onClick={() => onSelect(r.personId)} aria-pressed={selected}>
            {r.name}
          </button>
          <span className="jtm-team">{r.team ?? 'No team'}{r.out && <span className="jtm-pill jtm-pill--out">marked out</span>}</span>
        </span>
        <Keys keys={allKeys} title={`${r.name}: tickets behind coverage risk ${r.score}`} onOpen={onOpen} className="jtm-num jtm-score">
          {r.score}
        </Keys>
        {absent.size > 0 && !r.out && r.delta !== 0 && (
          <span className="jtm-delta" data-testid="delta" aria-label={`${r.delta > 0 ? 'up' : 'down'} ${Math.abs(r.delta)} since people were marked out`}>
            {r.delta > 0 ? `▲ +${r.delta}` : `▼ ${r.delta}`}
          </span>
        )}
        <button type="button" className="jtm-btn jtm-btn--small jtm-absence-control" onClick={() => onToggleOut(r.personId)} aria-pressed={r.out}>
          <Icon name={r.out ? 'personIn' : 'personOut'} size={14} />
          {r.out ? 'Mark back in' : 'Mark out'}
        </button>
      </div>
      {r.components.length > 0 && (
        <>
          <button type="button" className="jtm-disclose" aria-expanded={open} aria-controls={partsId} onClick={() => setOpen((o) => !o)} data-testid="row-parts-toggle">
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> How {r.score} is counted
          </button>
          {open && (
            <ul className="jtm-reasons" id={partsId}>
              {r.components.map((c, i) => (
                <li key={i}>
                  <Keys keys={c.keys} title={`${r.name}: ${c.text}`} onOpen={onOpen} className="jtm-reason">
                    {c.text} <b>+{c.points}</b>
                  </Keys>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

export function Ranking({ rows, absent, selectedId, onSelect, onToggleOut, onOpen, avatarOf = () => null }) {
  return (
    <section className="jtm-ranking" aria-label="Coverage risk ranking" data-testid="ranking">
      <h2 className="jtm-sr-only">Coverage risk</h2>
      <FormulaLine />
      {rows.length === 0 ? (
        <p>No one has a coverage risk above 0.</p>
      ) : (
        <ol className="jtm-rows">
          {rows.map((r) => (
            <RankingRow key={r.personId} r={r} avatarUrl={avatarOf(r.personId)} absent={absent} selected={selectedId === r.personId} onSelect={onSelect} onToggleOut={onToggleOut} onOpen={onOpen} />
          ))}
        </ol>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ person detail
export function PersonDetail({ model, r, out, knowledge, near, onClose, onToggleOut, onOpen, onSearch, bare, onEditTeam }) {
  const person = model.personById.get(r.personId);
  const from = { 'set in app': 'set here', 'team field': 'Team field', 'jira group': 'Jira group', 'project key': 'main project', none: '' }[person?.teamSource] ?? '';
  const sec = (title, items, render, testid) =>
    items.length > 0 && (
      <div className="jtm-sec" data-testid={testid}>
        <h4>{title}</h4>
        <ul>{items.map(render)}</ul>
      </div>
    );
  const issue = (k) => model.issueByKey.get(k);
  return (
    <Panel title={`${r.name}${r.team ? ` · ${r.team}` : ''}`} testid="person-detail" onClose={onClose} bare={bare}>
      <div className="jtm-detail-head">
        <span>
          Coverage risk{' '}
          <Keys keys={[...new Set(r.components.flatMap((c) => c.keys))]} title={`${r.name}: tickets behind coverage risk`} onOpen={onOpen}>
            {r.score}
          </Keys>
        </span>
        <button type="button" className="jtm-btn jtm-btn--small jtm-absence-control" onClick={onToggleOut} aria-pressed={out} data-testid="toggle-out">
          {out ? 'Mark back in' : `Mark ${r.name} out`}
        </button>
      </div>
      {onEditTeam && (
        <p className="jtm-team-line" data-testid="team-line">
          Team: <strong>{person?.team ?? 'none'}</strong>{from && <span className="jtm-muted"> (from {from})</span>}{' '}
          <button type="button" className="jtm-link" onClick={onEditTeam}>Change</button>
        </p>
      )}
      <p className="jtm-unblock" data-testid="unblock">
        <Keys keys={[...r.unblock.startKeys, ...r.unblock.alsoWaitKeys]} title={`Tasks waiting on ${r.name}'s blocking work`} onOpen={onOpen} className="jtm-num jtm-plain">
          {r.unblock.sentence}
        </Keys>
      </p>

      {sec('Tasks with no one else left on them', r.noOneLeft, (t) => (
        <li key={t.key}>
          <Keys keys={[t.key]} onOpen={onOpen} title={t.key}><code>{t.key}</code></Keys> {t.summary}{' '}
          <span className={`jtm-pill ${t.warm ? 'jtm-pill--warm' : 'jtm-pill--cold'}`}>{t.warm ? 'warm' : 'cold'}</span>
          {(t.blocked || t.overdue) && <span className="jtm-pill jtm-pill--red">{[t.statusBlocked && 'Blocked', t.flagged && 'flagged', t.overdue && 'overdue'].filter(Boolean).join(', ')}</span>}
          {t.warm && <span className="jtm-evidence">{t.workedBefore.join(', ')} worked on it before</span>}
          <button type="button" className="jtm-link" onClick={() => onSearch(t.key)}>Who has worked on {t.key}?</button>
        </li>
      ), 'no-one-left')}

      {sec('Someone else is still on it', r.covered, (c) => (
        <li key={c.key}><code>{c.key}</code> {issue(c.key).summary}: {c.leftOn.join(', ')}</li>
      ))}

      {sec('People left waiting', r.waiting, (w) => (
        <li key={w.personId} data-testid="chain">
          <Keys keys={w.keys} title={`${w.chainText}`} onOpen={onOpen} className="jtm-num jtm-plain">{w.chainText}</Keys>
          <span className="jtm-evidence">{w.keysText}</span>
        </li>
      ), 'waiting')}

      {sec('Only link between teams', r.soleTeamLinks, (s) => (
        <li key={s.id}><Keys keys={s.keys} title={`Only link between ${s.id}`} onOpen={onOpen} className="jtm-num jtm-plain">{s.id}</Keys></li>
      ))}

      {sec('Lead would change', r.leadChanges, (l) => (
        <li key={l.key}><code>{l.key}</code> {l.summary}: {l.why}; next lead: {l.nextLead ?? 'none'}</li>
      ))}

      {sec('Stale (no update in 14 days, not scored)', r.stale, (k) => (
        <li key={k}><code>{k}</code> {issue(k).summary}</li>
      ), 'stale')}

      {sec('Solo tasks nothing depends on (not scored)', r.solo, (k) => (
        <li key={k}><code>{k}</code> {issue(k).summary}</li>
      ))}

      {sec('Lead of tasks nothing depends on (not scored)', r.leadOnly, (l) => (
        <li key={l.key}><code>{l.key}</code> {issue(l.key).summary}: {l.why}</li>
      ))}

      {sec(`Has worked on ${r.name}'s open work`, knowledge, (k) => (
        <li key={k.personId} data-testid="knowledge-line">{k.line}</li>
      ), 'knowledge')}

      {sec('Linked work', [...new Map((model.personById.get(r.personId)?.openKeys ?? []).flatMap((k) => linksOf(model, k)).map((l) => [l.id, l])).values()], (link) => {
        const e = issue(link.toKey);
        return (
          <li key={link.id} data-testid="work-link-line">
            <code>{link.fromKey}</code> {RELATION_TYPES[link.type].label} <code>{link.toKey}</code> {e.summary} ({e.ownerId ? model.nameOf(e.ownerId) : 'unassigned'})
            <span className="jtm-pill">{link.source === 'jira' ? 'Jira link' : 'added in My work'}</span>
          </li>
        );
      }, 'work-links')}

      {sec('Who has worked near this', near.filter((n) => n.people.length), (n) => (
        <li key={n.issueKey}>
          <button type="button" className="jtm-link" onClick={() => onSearch(n.issueKey)}><code>{n.issueKey}</code></button> {n.summary}:{' '}
          {n.people.map((p) => `${p.name}${p.out ? ' (out)' : ''}`).join(', ')}
        </li>
      ), 'near')}
    </Panel>
  );
}

// ------------------------------------------------------------------ absence
export function AbsencePanel({ model, impact, onToggleOut, onClear, onOpen, bare }) {
  return (
    <Panel title="Marked out" testid="absence" onClose={onClear} bare={bare}>
      <div className="jtm-chips">
        {bare && <span className="jtm-muted">Marked out:</span>}
        {impact.absent.map((id) => (
          <button key={id} type="button" className="jtm-chip" onClick={() => onToggleOut(id)} aria-label={`Mark ${model.nameOf(id)} back in`}>
            {model.nameOf(id)} ×
          </button>
        ))}
        {bare && (
          <button type="button" className="jtm-btn jtm-btn--small" onClick={onClear}>
            Clear all
          </button>
        )}
      </div>
      <p>
        Work that stalls:{' '}
        <Keys keys={impact.stalledKeys} title="Work that stalls" onOpen={onOpen}>{plural(impact.stalledKeys.length, 'task')}</Keys>
        {impact.stalledKeys.length > 0 && ` (${impact.stalledKeys.join(', ')})`}
      </p>
      <div className="jtm-sec">
        <h4>Left waiting <i className="jtm-ring-key jtm-ring-key--waiting" /></h4>
        {impact.leftWaiting.length ? (
          <ul>
            {impact.leftWaiting.map((w) => (
              <li key={w.personId}><Keys keys={w.keys} title={w.chainText} onOpen={onOpen} className="jtm-num jtm-plain">{w.chainText}</Keys> <span className="jtm-evidence">{w.keysText}</span></li>
            ))}
          </ul>
        ) : (
          <p className="jtm-muted">No one.</p>
        )}
      </div>
      <div className="jtm-sec">
        <h4>Have worked on stalled work <i className="jtm-ring-key jtm-ring-key--context" /></h4>
        {impact.context.length ? (
          <ul>
            {impact.context.map((c) => (
              <li key={c.personId}>
                {c.name}: {c.items.map((i) => (i.how.length === 1 && i.how[0] === 'earlier work'
                  ? `worked on ${i.via.join(', ')}, which ${i.key} builds on`
                  : `${i.how.join('/')} ${i.key}${i.via.some((v) => v !== i.key) ? ` via ${i.via.filter((v) => v !== i.key).join(', ')}` : ''} (${i.current ? 'now' : 'before'})`)).join(' · ')}
              </li>
            ))}
          </ul>
        ) : (
          <p className="jtm-muted">No one else has worked on it in the last 12 months.</p>
        )}
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ data quality
export function DataQuality({ model, onOpen }) {
  const dq = model.dataQuality;
  const n = (keys, title, text) => <Keys keys={keys} title={title} onOpen={onOpen}>{text}</Keys>;
  const linkKeys = (xs) => [...new Set(xs.flatMap((x) => x.keys))];
  return (
    <details className="jtm-dq" data-testid="data-quality">
      <summary>Data quality</summary>
      <ul>
        <li>
          {n(dq.issues.keys, 'All issues', `${dq.issues.total} issues`)}: {n(dq.issues.openWork, 'Open work', `${dq.issues.openWork.length} open work items`)},{' '}
          {n(dq.issues.doneWork, 'Done work (history only)', `${dq.issues.doneWork.length} done`)}, {n(dq.issues.epics, 'Epics', `${dq.issues.epics.length} epics`)},{' '}
          {n(dq.issues.subtasks, 'Sub-tasks', `${dq.issues.subtasks.length} sub-tasks`)}
        </li>
        <li>
          Open work assigned: {n(dq.openWorkAssigned.keys, 'Assigned open work', `${dq.openWorkAssigned.pct}%`)} · unassigned{' '}
          {n(dq.openWorkAssigned.unassigned, 'Unassigned open work', String(dq.openWorkAssigned.unassigned.length))} · assigned to an excluded account{' '}
          {n(dq.openWorkAssigned.assignedToExcluded, 'Open work assigned to excluded accounts', String(dq.openWorkAssigned.assignedToExcluded.length))}
        </li>
        <li>
          Links: {dq.links.total} total · {n(dq.dependencies.keys, 'Open dependency tickets', `${dq.dependencies.open.length} open dependencies`)} ·{' '}
          {dq.dependencies.resolved.length} resolved · {n(linkKeys(dq.links.ignored), 'Ignored links (not block/depend)', `${dq.links.ignored.length} ignored (other link types)`)} ·{' '}
          {n(linkKeys(dq.links.duplicatesMerged), 'Duplicates merged after sub-task rollup', `${dq.links.duplicatesMerged.length} merged after sub-task rollup`)} ·{' '}
          {n(linkKeys(dq.links.selfAfterRollup), 'Sub-task links inside one task', `${dq.links.selfAfterRollup.length} inside one task`)} · {dq.links.oneSided.length} one-sided
        </li>
        <li>
          Blockers with no assignee:{' '}
          {n(dq.blockersWithoutAssignee.map((b) => b.blockerKey), 'Blockers with no assignee', String(dq.blockersWithoutAssignee.length))}
          {dq.blockersWithoutAssignee.length > 0 && ` (${dq.blockersWithoutAssignee.map((b) => `${b.blockerKey} ${b.reason}`).join(', ')})`}
        </li>
        <li>
          Excluded accounts: {dq.excludedAccounts.map((e, i) => (
            <span key={e.accountId}>{i > 0 && ', '}{n(e.keys, `${e.displayName} (${e.reason})`, `${e.displayName} (${e.reason})`)}</span>
          ))}
        </li>
        <li>
          Team from: {Object.entries(dq.teamSources).map(([src, ids], i) => (
            <span key={src}>{i > 0 && ' · '}{src}: {ids.map(model.nameOf).join(', ')}</span>
          ))}
        </li>
        <li>
          Open work with a second person who has worked on it: {n(dq.secondPerson.keys, 'Open work with a second person', `${dq.secondPerson.pct}%`)}
        </li>
        <li>Stale (no update in 14 days): {n(dq.stale, 'Stale work', String(dq.stale.length))}</li>
        <li>
          Work links: {dq.workLinks.fromJira} from Jira links · {dq.workLinks.addedInApp} added in My work ·{' '}
          {n(dq.workLinks.openWithEarlier.keys, 'Open work linked to earlier work', `${dq.workLinks.openWithEarlier.pct}%`)} of open work is linked to earlier work
        </li>
        <li>
          Changelog: {dq.changelog.histories} histories parsed · {dq.changelog.assigneeChanges} assignee changes · {dq.changelog.used} past assignees used · skipped:{' '}
          {dq.changelog.fromUnassigned} from unassigned, {dq.changelog.fromExcluded} from excluded accounts, {dq.changelog.supersededByCurrent} same as current assignee ·{' '}
          {dq.changelog.statusOnlyHistories} status-only
        </li>
      </ul>
    </details>
  );
}

// ------------------------------------------------------------------ zoom
export function ZoomControl({ zoom, onZoom }) {
  const names = { ticket: 'Ticket', theme: 'Theme (epic)', team: 'Team' };
  return (
    <div className="jtm-zoom" role="radiogroup" aria-label="Arrow labels">
      <span className="jtm-zoom-label">Labels</span>
      {ZOOMS.map((z) => (
        <button key={z} type="button" role="radio" aria-checked={zoom === z} className={`jtm-seg${zoom === z ? ' jtm-seg--on' : ''}`} onClick={() => onZoom(z)} data-zoom={z}>
          {names[z]}
        </button>
      ))}
    </div>
  );
}
