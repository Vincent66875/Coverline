import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Drawer from './Drawer.jsx';
import { boardColumns } from '../analysis/board.js';
import { canAdd, linksOf } from '../analysis/relations.js';
import { DEFAULT_RELATION, RELATION_ORDER, RELATION_TYPES, givesContext } from '../analysis/relationTypes.js';
import { workedOn } from '../analysis/scoring.js';
import { toMs } from '../analysis/dates.js';
import { routeLines, LANE_GAP } from '../graph/boardRoute.js';
import Avatar from './Avatar.jsx';
import Icon from './Icons.jsx';
import { InfoButton, ToolButton } from './Toolbar.jsx';
import { Combobox, PersonPicker } from './Combobox.jsx';
import Select from './Select.jsx';

const DRAG_START_PX = 6;
const owner = (model, issue) => (issue.ownerId ? model.nameOf(issue.ownerId) : 'unassigned');
const statusClass = (i) => (i.done ? 'done' : i.statusCategory === 'indeterminate' ? 'progress' : 'todo');
const effectText = (type) => (givesContext(type) ? 'gives context on the team map' : 'search only');

/** The newer task reads first: "newer builds on earlier". Open work is newest. */
function orient(model, a, b) {
  const ia = model.issueByKey.get(a);
  const ib = model.issueByKey.get(b);
  const t = (i) => (i.done ? toMs(i.resolved ?? i.updated) : Infinity);
  return t(ia) >= t(ib) ? [a, b] : [b, a];
}

/** Radio list of relation types, with what each one does. */
function TypeChoice({ name, value, onChange, autoFocus }) {
  return (
    <div className="jtm-types" role="radiogroup" aria-label="Relation">
      {RELATION_ORDER.map((t, i) => (
        <label key={t} className={`jtm-type${value === t ? ' jtm-type--on' : ''}`}>
          <input type="radio" name={name} value={t} checked={value === t} onChange={() => onChange(t)} autoFocus={autoFocus && i === RELATION_ORDER.indexOf(value)} data-type={t} />
          <span>{RELATION_TYPES[t].label}</span>
          <small>{effectText(t)}</small>
        </label>
      ))}
    </div>
  );
}

/** Popup after a line is dropped on a card: pick the relation, optionally swap direction. */
function LinkPopup({ model, pending, onAdd, onCancel }) {
  const [type, setType] = useState(DEFAULT_RELATION);
  const [[from, to], setPair] = useState([pending.fromKey, pending.toKey]);
  const check = canAdd(model, from, to, type);
  return (
    <div
      className="jtm-popup"
      role="dialog"
      aria-label="Choose how these tasks are related"
      data-testid="link-popup"
      style={{ left: pending.x, top: pending.y }}
      onKeyDown={(ev) => {
        if (ev.key === 'Escape') {
          ev.stopPropagation();
          onCancel();
        }
      }}
    >
      <p className="jtm-popup-sentence">
        <code>{from}</code> <strong>{RELATION_TYPES[type].label}</strong> <code>{to}</code>
      </p>
      <TypeChoice name="jtm-popup-type" value={type} onChange={setType} autoFocus />
      {!check.ok && <p className="jtm-warn" role="alert">{check.reason}</p>}
      <div className="jtm-popup-actions">
        <button type="button" className="jtm-link" onClick={() => setPair([to, from])} aria-label={`Swap direction: ${to} first`}>⇄ Swap</button>
        <span>
          <button type="button" className="jtm-btn jtm-btn--small" onClick={onCancel}>Cancel</button>{' '}
          <button type="button" className="jtm-btn jtm-btn--small jtm-btn--primary" disabled={!check.ok} onClick={() => onAdd({ fromKey: from, toKey: to, type })}>Add link</button>
        </span>
      </div>
    </div>
  );
}

/** Edit one existing link: type, direction, remove (app links) or a note (Jira links). */
function LinkEditor({ model, link, onChange, onRemove, jiraEditable = false }) {
  const e = model.issueByKey.get(link.toKey);
  const s = model.issueByKey.get(link.fromKey);
  return (
    <li className="jtm-link-item" data-link-item={link.id}>
      <p>
        <code>{link.fromKey}</code> {s.summary} <strong>{RELATION_TYPES[link.type].label}</strong> <code>{link.toKey}</code> {e.summary}
      </p>
      {link.source === 'jira' && jiraEditable && <p className="jtm-muted"><span className="jtm-pill jtm-pill--jira">Jira link</span></p>}
      {link.source === 'jira' && !jiraEditable ? (
        <p className="jtm-muted"><span className="jtm-pill jtm-pill--jira">Jira link</span> Change or remove it in Jira.</p>
      ) : (
        <div className="jtm-link-edit">
          <span className="jtm-link-edit-field">
            <span aria-hidden="true">Relation</span>
            <Select
              small
              label={`Relation for ${link.fromKey} and ${link.toKey}`}
              value={link.type}
              onChange={(v) => onChange(link, { type: v })}
              testid="link-relation"
              options={RELATION_ORDER.map((t) => ({ value: t, label: RELATION_TYPES[t].label }))}
            />
          </span>
          <button type="button" className="jtm-link" onClick={() => onChange(link, { swap: true })}>⇄ Swap</button>
          <button type="button" className="jtm-link jtm-danger" onClick={() => onRemove(link)} aria-label={`Remove link: ${link.fromKey} ${RELATION_TYPES[link.type].label} ${link.toKey}`}>Remove</button>
        </div>
      )}
    </li>
  );
}

/** Context sentence for a link, as the team map will use it. */
function linkEffect(model, link) {
  if (!givesContext(link.type)) return 'Used only by “Who has worked on this?” search. No effect on coverage risk.';
  const owner = model.issueByKey.get(link.fromKey).ownerId;
  const people = workedOn(model, link.toKey, { earlierWork: false }).map((w) => w.personId).filter((p) => p !== owner);
  if (!people.length) return `No one besides the owner has worked on ${link.toKey}, so this adds no context yet.`;
  return `On the team map, ${people.map(model.nameOf).join(', ')} ${people.length === 1 ? 'counts' : 'count'} as having context for ${link.fromKey}.`;
}

function CardPanel({ model, cardKey, boardKeys, onAdd, onChange, onRemove, onUnpin, pinned, jiraEditable }) {
  const i = model.issueByKey.get(cardKey);
  const links = linksOf(model, cardKey);
  const others = boardKeys.filter((k) => k !== cardKey);
  const [target, setTarget] = useState(others[0] ?? '');
  const [type, setType] = useState(DEFAULT_RELATION);
  const [from, to] = target ? orient(model, cardKey, target) : [cardKey, ''];
  const check = target ? canAdd(model, from, to, type) : { ok: false, reason: 'No other card on the board' };
  return (
    <div data-testid="card-panel">
      <p className="jtm-muted">
        <span className={`jtm-lozenge jtm-lozenge--${statusClass(i)}`}>{i.status}</span> · {owner(model, i)} · {i.done ? `done ${new Date(toMs(i.resolved)).toISOString().slice(0, 10)}` : 'open'}
      </p>
      <div className="jtm-sec">
        <h4>Links</h4>
        {links.length === 0 ? <p className="jtm-muted">No links yet.</p> : <ul className="jtm-link-list">{links.map((l) => <LinkEditor key={l.id} model={model} link={l} onChange={onChange} onRemove={onRemove} jiraEditable={jiraEditable} />)}</ul>}
      </div>
      <div className="jtm-sec">
        <h4>Link to another card</h4>
        {others.length === 0 ? (
          <p className="jtm-muted">Add a card first (“Add a card” above).</p>
        ) : (
          <>
            <span className="jtm-field jtm-link-edit-field">
              <span aria-hidden="true">Card</span>
              <Select
                small
                label="Card to link"
                value={target}
                onChange={setTarget}
                testid="link-target"
                options={others.map((k) => ({ value: k, label: `${k} ${model.issueByKey.get(k).summary}` }))}
              />
            </span>
            <p className="jtm-popup-sentence"><code>{from}</code> <strong>{RELATION_TYPES[type].label}</strong> <code>{to}</code></p>
            <TypeChoice name={`jtm-card-type-${cardKey}`} value={type} onChange={setType} />
            {!check.ok && <p className="jtm-warn">{check.reason}</p>}
            <button type="button" className="jtm-btn jtm-btn--small jtm-btn--primary" disabled={!check.ok} onClick={() => onAdd({ fromKey: from, toKey: to, type })}>Add link</button>
          </>
        )}
      </div>
      {pinned && links.length === 0 && (
        <button type="button" className="jtm-link" onClick={() => onUnpin(cardKey)}>Remove card from this board</button>
      )}
    </div>
  );
}

/**
 * My work: one person's tasks as Kanban-style cards in time columns, left (now) to right (past).
 * Drag a line from one card to another, then pick the relation. Lines feed the team map's context signals.
 */
/** toolbarSlot: element in the app's top bar; when given, the board's controls render there (same spot as the Team search). */
export default function MyWork({ model, personId, onPerson, onAddLink, onChangeLink, onRemoveLink, onShowOnMap, status, compact, jiraEditable = false, toolbarSlot = null }) {
  const me = model.personById.get(personId);
  const [pinned, setPinned] = useState([]);
  const [view, setView] = useState(null); // { kind: 'card' | 'link', key | link }
  const [pending, setPending] = useState(null); // dropped line waiting for its relation type
  const [drag, setDrag] = useState(null); // { fromKey, x, y } while drawing a line
  const [geo, setGeo] = useState({ boxes: new Map(), w: 0, h: 0 });
  const [addValue, setAddValue] = useState('');
  const innerRef = useRef(null);
  const pressRef = useRef(null);

  useEffect(() => {
    setPinned([]);
    setView(null);
    setPending(null);
  }, [personId]);

  const board = useMemo(() => boardColumns(model, personId, { pinned, suggestions: false }), [model, personId, pinned]);
  const boardKeys = board.columns.flatMap((c) => c.cards.map((x) => x.key));

  // measure card boxes (relative to the scrolling board) for drawing lines
  const measure = useCallback(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const base = inner.getBoundingClientRect();
    const boxes = new Map();
    for (const el of inner.querySelectorAll('[data-card]')) {
      const r = el.getBoundingClientRect();
      const x = r.left - base.left;
      const y = r.top - base.top;
      boxes.set(el.dataset.card, { x, y, w: r.width, h: r.height, cx: x + r.width / 2, cy: y + r.height / 2 });
    }
    setGeo({ boxes, w: inner.scrollWidth, h: inner.scrollHeight });
  }, []);
  useLayoutEffect(() => {
    measure();
  }, [measure, board, view, compact]);
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => measure());
    ro.observe(inner);
    return () => ro.disconnect();
  }, [measure]);

  // Esc closes the docked panel (the modal one handles Esc itself)
  useEffect(() => {
    if (!view || compact) return undefined;
    const onKey = (ev) => ev.key === 'Escape' && !pending && setView(null);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, compact, pending]);

  if (!me) return null;
  const point = (ev) => {
    const r = innerRef.current.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };

  const onPointerDown = (ev, key) => {
    if (ev.button !== 0 || ev.target.closest('button, a, input, select')) return;
    pressRef.current = { key, sx: ev.clientX, sy: ev.clientY, id: ev.pointerId, el: ev.currentTarget, moved: false };
  };
  const onPointerMove = (ev) => {
    const p = pressRef.current;
    if (!p) return;
    if (!p.moved && Math.hypot(ev.clientX - p.sx, ev.clientY - p.sy) < DRAG_START_PX) return;
    if (!p.moved) {
      p.moved = true;
      try {
        p.el.setPointerCapture(p.id);
      } catch {
        /* capture not available */
      }
    }
    setDrag({ fromKey: p.key, ...point(ev) });
  };
  const onPointerUp = (ev) => {
    const p = pressRef.current;
    pressRef.current = null;
    if (!p) return;
    if (!p.moved) {
      setView({ kind: 'card', key: p.key });
      return;
    }
    setDrag(null);
    // look through every layer under the pointer: a line may be drawn over the target card
    const target = document.elementsFromPoint(ev.clientX, ev.clientY).map((el) => el.closest?.('[data-card]')).find(Boolean)?.dataset.card;
    if (!target || target === p.key) return;
    const [fromKey, toKey] = orient(model, p.key, target);
    // the popup is fixed to the viewport so the board's scroll box never clips it
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    setPending({ fromKey, toKey, x: Math.max(8, Math.min(ev.clientX + 8, vw - 308)), y: Math.max(8, Math.min(ev.clientY + 8, vh - 380)) });
  };

  const addLink = async (link) => {
    const reason = await onAddLink(link);
    if (!reason) {
      setPending(null);
      setPinned((prev) => prev.filter((k) => k !== link.fromKey && k !== link.toKey));
    }
  };
  const boxOf = (k) => geo.boxes.get(k);
  const colOf = new Map(board.columns.flatMap((c, i) => c.cards.map((x) => [x.key, i])));
  const { routes, lanes } = routeLines(board.lines, geo.boxes, colOf, (l) => RELATION_TYPES[l.type].label.length * 6.2 + 14);
  const ownOpen = me.openKeys.length;
  const ownDone = board.columns.flatMap((c) => c.cards).filter((c) => c.kind === 'own' && c.issue.done).length;
  const allKeys = model.issues.filter((i) => !i.isEpic && !i.isSubtask && !boardKeys.includes(i.key));
  const title =
    view?.kind === 'card' ? `${view.key} ${model.issueByKey.get(view.key).summary}`
      : view?.kind === 'link' ? 'Link'
        : '';

  const lineKey = (
    <div className="jtm-wl-legend jtm-wl-legend--stack" data-testid="line-key">
      <span><svg width="30" height="8" aria-hidden="true"><path d="M1,4 H29" className="jtm-wl jtm-wl--context" /></svg> builds on, follows up on, replaces, fixes: context</span>
      <span><svg width="30" height="8" aria-hidden="true"><path d="M1,4 H29" className="jtm-wl jtm-wl--related" /></svg> related to: search only</span>
      <span className="jtm-muted">Drag from one card to another to link them.</span>
    </div>
  );
  const actions = (
    <div className="jtm-board-actions" role="toolbar" aria-label="My work">
      <Combobox
        id="jtm-add-card"
        icon="plus"
        label="Add a card (ticket key)"
        placeholder="Add a card…"
        title="Put any ticket on this board by its key, e.g. to link it"
        testid="add-card"
        value={addValue}
        onChange={setAddValue}
        clearOnSubmit
        options={allKeys.map((i) => ({ value: i.key, title: i.summary, meta: owner(model, i) }))}
        onSubmit={(v) => {
          const key = v.trim().toUpperCase().split(/\s/)[0];
          if (model.issueByKey.get(key) && !model.issueByKey.get(key).isEpic) setPinned((prev) => [...new Set([...prev, model.issueByKey.get(key).workKey])]);
        }}
      />
      <PersonPicker people={model.people.filter((p) => !p.reporterOnly)} value={personId} onChange={onPerson} testid="viewing-as" />
      <ToolButton icon="map" text="Map" label="Show on team map" collapse onClick={() => onShowOnMap(personId)} data-testid="show-on-map" />
      <span className="jtm-tbar-end">
        <InfoButton label="Line key" testid="open-line-key">{lineKey}</InfoButton>
      </span>
    </div>
  );

  return (
    <div className="jtm-mywork" data-testid="my-work">
      {toolbarSlot && createPortal(actions, toolbarSlot)}
      <header className="jtm-board-header">
        <div className="jtm-person-head">
          <Avatar name={me.name} url={me.avatarUrl} />
          <h2>{me.name}</h2>
          <p>{me.team ?? 'No team'} · {ownOpen} open · {ownDone} done in the last 12 months · {board.lines.length} {board.lines.length === 1 ? 'link' : 'links'}</p>
        </div>
        {!toolbarSlot && actions}
      </header>

      <p className="jtm-status-line" role="status" aria-live="polite" data-testid="mywork-status">{status}</p>

      <div className={`jtm-stage${view && !compact ? ' jtm-stage--drawer' : ''}`}>
        <div className="jtm-board-scroll">
          <div
            className={`jtm-board-inner${drag ? ' jtm-board-inner--drawing' : ''}`}
            ref={innerRef}
            style={{ paddingBottom: lanes ? 26 + lanes * LANE_GAP + 16 : undefined }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              pressRef.current = null;
              setDrag(null);
            }}
            onClick={(ev) => {
              if (!compact && view && !ev.target.closest('[data-card], [data-line], .jtm-popup')) setView(null);
            }}
          >
            <div className="jtm-cols">
              {board.columns.map((col) => (
                <section key={col.id} className="jtm-col-k" aria-label={`${col.label}, ${col.cards.length} cards`} data-col={col.id}>
                  <h3>{col.label} <span className="jtm-count">{col.cards.length}</span></h3>
                  {col.cards.length === 0 && <p className="jtm-muted jtm-empty-col">Nothing open</p>}
                  {col.cards.map((c) => (
                    <div
                      key={c.key}
                      className={`jtm-card jtm-card--${c.kind}${view?.kind === 'card' && view.key === c.key ? ' jtm-card--selected' : ''}${drag?.fromKey === c.key ? ' jtm-card--source' : ''}`}
                      data-card={c.key}
                      data-kind={c.kind}
                      role="button"
                      tabIndex={0}
                      aria-label={`${c.key} ${c.issue.summary}, ${c.issue.status}, ${owner(model, c.issue)}. Open details and links.`}
                      onPointerDown={(ev) => onPointerDown(ev, c.key)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault();
                          setView({ kind: 'card', key: c.key });
                        }
                      }}
                    >
                      <div className="jtm-card-top">
                        <code>{c.key}</code>
                        {c.kind !== 'own' && (
                          <Avatar className="jtm-mini-avatar" title={owner(model, c.issue)} name={c.issue.ownerId ? model.nameOf(c.issue.ownerId) : '?'} url={c.issue.ownerId ? model.avatarOf(c.issue.ownerId) : null} />
                        )}
                      </div>
                      <div className="jtm-card-title">{c.issue.summary}</div>
                      <div className="jtm-card-meta">
                        <span className={`jtm-lozenge jtm-lozenge--${statusClass(c.issue)}`}>{c.issue.status}</span>
                        <span>{c.kind === 'own' ? (c.issue.done ? `done ${c.ago}` : '') : owner(model, c.issue)}</span>
                      </div>
                      <span className="jtm-handle" aria-hidden="true" />
                    </div>
                  ))}
                </section>
              ))}
            </div>

            <svg className="jtm-board-lines" width={geo.w} height={geo.h} aria-hidden={false} data-testid="board-lines">
              <defs>
                {['context', 'related'].map((k) => (
                  <marker key={k} id={`jtm-wl-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0,0 L10,5 L0,10 z" className={`jtm-wl-head jtm-wl-head--${k}`} />
                  </marker>
                ))}
              </defs>
              {/* 1. all lines first… */}
              {board.lines.map((l) => {
                const route = routes.get(l.id);
                if (!route) return null;
                const kind = givesContext(l.type) ? 'context' : 'related';
                return (
                  <g key={l.id} data-line={l.id} className={`jtm-wl-g${view?.kind === 'link' && view.link.id === l.id ? ' jtm-wl-g--on' : ''}`}>
                    <path d={route.d} className="jtm-wl-hit" />
                    <path d={route.d} className={`jtm-wl jtm-wl--${kind}`} markerEnd={`url(#jtm-wl-arrow-${kind})`} />
                  </g>
                );
              })}
              {/* 2. …then every relation label, so no line is ever drawn over a label */}
              {board.lines.map((l) => {
                const route = routes.get(l.id);
                if (!route) return null;
                const kind = givesContext(l.type) ? 'context' : 'related';
                const { mid } = route;
                const label = RELATION_TYPES[l.type].label;
                const w = label.length * 6.2 + 14;
                return (
                  <g
                    key={l.id}
                    data-line-label={l.id}
                    className={`jtm-wl-g${view?.kind === 'link' && view.link.id === l.id ? ' jtm-wl-g--on' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={`${l.fromKey} ${label} ${l.toKey}${l.source === 'jira' ? ', Jira link' : ''}. Open link.`}
                    onClick={() => setView({ kind: 'link', link: l })}
                    onKeyDown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && (ev.preventDefault(), setView({ kind: 'link', link: l }))}
                  >
                    <rect x={mid.x - w / 2} y={mid.y - 9} width={w} height={18} rx={9} className={`jtm-wl-pill jtm-wl-pill--${kind}`} />
                    <text x={mid.x} y={mid.y + 4} textAnchor="middle" className="jtm-wl-text">{label}</text>
                  </g>
                );
              })}
              {drag && boxOf(drag.fromKey) && (
                <path d={`M${boxOf(drag.fromKey).x + boxOf(drag.fromKey).w},${boxOf(drag.fromKey).cy} L${drag.x},${drag.y}`} className="jtm-wl jtm-wl--drawing" data-testid="drawing-line" />
              )}
            </svg>

            {pending && <LinkPopup key={`${pending.fromKey}-${pending.toKey}`} model={model} pending={pending} onAdd={addLink} onCancel={() => setPending(null)} />}
          </div>
        </div>

        <Drawer open={!!view} compact={compact} title={title} onClose={() => setView(null)}>
          {view?.kind === 'card' && (
            <CardPanel
              key={view.key}
              model={model}
              cardKey={view.key}
              boardKeys={boardKeys}
              pinned={pinned.includes(view.key)}
              onAdd={addLink}
              onChange={onChangeLink}
              onRemove={onRemoveLink}
              jiraEditable={jiraEditable}
              onUnpin={(k) => {
                setPinned((prev) => prev.filter((x) => x !== k));
                setView(null);
              }}
            />
          )}
          {view?.kind === 'link' && (() => {
            const live = model.workLinks.find((x) => x.fromKey === view.link.fromKey && x.toKey === view.link.toKey) ?? model.workLinks.find((x) => x.fromKey === view.link.toKey && x.toKey === view.link.fromKey);
            if (!live) return <p className="jtm-muted">This link was removed.</p>;
            return (
              <div data-testid="link-panel">
                <ul className="jtm-link-list"><LinkEditor model={model} link={live} onChange={onChangeLink} onRemove={(l) => { onRemoveLink(l); setView(null); }} jiraEditable={jiraEditable} /></ul>
                <p className="jtm-muted" data-testid="link-effect">{linkEffect(model, live)}</p>
              </div>
            );
          })()}
        </Drawer>
      </div>
    </div>
  );
}
