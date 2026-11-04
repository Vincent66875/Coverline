import { useEffect, useMemo, useRef, useState } from 'react';
import { neighbour } from '../graph/layout.js';
import { coverText } from '../analysis/scoring.js';

// The map scales down with the frame, but never below this, so text stays readable; then it scrolls.
const MIN_SCALE = 0.85;
const KEY_DIR = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

/**
 * Hand-rolled SVG people graph. People are nodes; tickets are edge labels.
 * Arrow = "waits on", from waiter to blocker.
 */
export default function PeopleGraph({ model, data, selectedId = null, absent = new Set(), onSelect, onBadge, onBackground, head = null }) {
  const { layout, risk, baseline, labels, badges, edgeById, sentences, rings, knowledge } = data;
  const nodeById = useMemo(() => new Map(layout.nodes.map((n) => [n.id, n])), [layout]);
  const [activeId, setActiveId] = useState(() => layout.nodes[0]?.id ?? null);
  const nodeRefs = useRef(new Map());
  const pendingFocus = useRef(null);

  useEffect(() => {
    if (pendingFocus.current) {
      nodeRefs.current.get(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
  }, [activeId]);
  useEffect(() => {
    if (selectedId) setActiveId(selectedId);
  }, [selectedId]);

  const related = useMemo(() => {
    if (!selectedId) return null;
    const s = new Set([selectedId]);
    for (const e of model.personEdges) {
      if (e.waiterId === selectedId) s.add(e.blockerId);
      if (e.blockerId === selectedId) s.add(e.waiterId);
    }
    for (const k of knowledge) s.add(k.personId);
    return s;
  }, [selectedId, model, knowledge]);

  const waitsOn = (id) => model.personEdges.filter((e) => e.waiterId === id).map((e) => model.nameOf(e.blockerId));
  const waitedBy = (id) => model.personEdges.filter((e) => e.blockerId === id).map((e) => model.nameOf(e.waiterId));
  const list = (xs) => (xs.length ? xs.join(', ') : 'no one');

  const onNodeKey = (ev, id) => {
    const dir = KEY_DIR[ev.key];
    if (dir) {
      ev.preventDefault();
      const next = neighbour(layout, id, dir);
      pendingFocus.current = next;
      setActiveId(next);
      if (next === id) nodeRefs.current.get(id)?.focus();
    } else if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onSelect?.(selectedId === id ? null : id);
    } else if (ev.key === 'Escape') {
      onSelect?.(null);
    }
  };
  const onBadgeKey = (ev, edgeId, blockerKey) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault();
      onBadge?.(edgeId, blockerKey);
    }
  };

  const edgeFaded = (e) => related && !(e.from === selectedId || e.to === selectedId);

  return (
    <div className="jtm-graph">
      {head && <div className="jtm-frame-head">{head}</div>}
      <svg
        viewBox={`0 0 ${layout.width} ${layout.height}`}
        style={{ width: '100%', height: 'auto', maxWidth: layout.width, minWidth: Math.round(layout.width * MIN_SCALE) }}
        onClick={(ev) => {
          // click on empty map space (not a person or badge) closes the docked panel
          if (onBackground && !ev.target.closest('[data-node], [data-badge]')) onBackground();
        }}
        role="group"
        aria-label="People dependency map. Arrows point from the person who waits to the person they wait on. Use arrow keys to move between people, Enter to select."
        aria-describedby="jtm-sr-edges"
        data-testid="people-graph"
      >
        <defs>
          {['plain', 'red', 'faded'].map((k) => (
            <marker key={k} id={`jtm-arrow-${k}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className={`jtm-arrowhead jtm-arrowhead--${k}`} />
            </marker>
          ))}
        </defs>

        {layout.columns.map((c) => (
          <g key={c.team} className="jtm-col" aria-hidden="true">
            <rect x={c.x0 + 8} y={18} width={c.w - 16} height={layout.height - 26} rx={10} />
            <text x={c.x} y={44} textAnchor="middle" className="jtm-col-title">{c.team}</text>
          </g>
        ))}

        <g aria-hidden="true">
          {layout.edges.map((e) => {
            const pe = edgeById.get(e.id);
            const broken = absent.has(e.to);
            const red = pe.red || broken;
            const faded = edgeFaded(e);
            const kind = faded ? 'faded' : red ? 'red' : 'plain';
            return (
              <path
                key={e.id}
                d={e.d}
                data-edge={e.id}
                className={`jtm-edge${red ? ' jtm-edge--red' : ''}${broken ? ' jtm-edge--broken' : ''}${faded ? ' jtm-faded' : ''}`}
                strokeWidth={1.5 + Math.min(pe.weight - 1, 3)}
                markerEnd={`url(#jtm-arrow-${kind})`}
              />
            );
          })}
        </g>

        {selectedId && (
          <g aria-hidden="true" data-testid="knowledge-lines">
            {knowledge.map((k) => {
              const a = nodeById.get(k.personId);
              const b = nodeById.get(selectedId);
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              const dx = b.x - a.x;
              const dy = b.y - a.y;
              const len = Math.hypot(dx, dy) || 1;
              const cx = mx - (dy / len) * len * 0.18;
              const cy = my + (dx / len) * len * 0.18;
              const edge = (n) => {
                const vx = cx - n.x;
                const vy = cy - n.y;
                const vl = Math.hypot(vx, vy) || 1;
                return [n.x + (vx / vl) * (n.r + 3), n.y + (vy / vl) * (n.r + 3)];
              };
              const [ax, ay] = edge(a);
              const [bx, by] = edge(b);
              return (
                <path key={k.personId} data-knowledge={k.personId} className="jtm-knowledge" d={`M${ax},${ay} Q${cx},${cy} ${bx},${by}`}>
                  <title>{k.line}</title>
                </path>
              );
            })}
          </g>
        )}

        <g aria-hidden="true">
          {layout.edges.filter((e) => e.label.lines.length).map((e) => (
            <g key={e.id} className={`jtm-label${edgeFaded(e) ? ' jtm-faded' : ''}`} data-label={e.id}>
              <rect x={e.label.x} y={e.label.y} width={e.label.w} height={e.label.h} rx={4} />
              <text x={e.label.x + e.label.w / 2} y={e.label.y + 4} textAnchor="middle">
                {e.label.lines.map((l, i) => (
                  <tspan key={i} x={e.label.x + e.label.w / 2} dy={14}>{l}</tspan>
                ))}
              </text>
              <title>{labels.get(e.id).text}</title>
            </g>
          ))}
        </g>

        {layout.nodes.map((n) => {
          const score = risk.get(n.id).score;
          const isOut = absent.has(n.id);
          const faded = related && !related.has(n.id);
          const delta = score - baseline.get(n.id);
          const ring = rings.get(n.id) ?? [];
          const ringText = `${ring.includes('waiting') ? ' Left waiting on work that stalls.' : ''}${ring.includes('context') ? ' Has worked on stalled work.' : ''}`;
          const scoreText = absent.size && !isOut && delta !== 0 ? `coverage risk ${score} (${delta > 0 ? '+' : ''}${delta})` : score > 0 ? `coverage risk ${score}` : '';
          const knows = knowledge.find((k) => k.personId === n.id);
          return (
            <g
              key={n.id}
              ref={(el) => (el ? nodeRefs.current.set(n.id, el) : nodeRefs.current.delete(n.id))}
              role="button"
              tabIndex={n.id === activeId ? 0 : -1}
              aria-pressed={selectedId === n.id}
              aria-label={`${n.name}, ${n.team}, coverage risk ${score}${delta && absent.size ? ` (${delta > 0 ? '+' : ''}${delta})` : ''}. Waits on ${list(waitsOn(n.id))}. Waited on by ${list(waitedBy(n.id))}.${isOut ? ' Marked out.' : ''}${ringText}${knows ? ` Has worked on ${model.nameOf(selectedId)}'s work: ${knows.items.map((i) => i.issueKey).join(', ')}.` : ''}`}
              className={`jtm-node${selectedId === n.id ? ' jtm-node--selected' : ''}${faded ? ' jtm-faded' : ''}${isOut ? ' jtm-node--out' : ''}${ring.map((r) => ` jtm-node--${r}`).join('')}${knows ? ' jtm-node--knows' : ''}`}
              data-node={n.id}
              onClick={() => {
                setActiveId(n.id);
                onSelect?.(selectedId === n.id ? null : n.id);
              }}
              onFocus={() => setActiveId(n.id)}
              onKeyDown={(ev) => onNodeKey(ev, n.id)}
            >
              {ring.map((r, i) => <circle key={r} cx={n.x} cy={n.y} r={n.r + 5 + i * 5} className={`jtm-ring jtm-ring--${r}`} />)}
              <circle cx={n.x} cy={n.y} r={n.r} />
              <text x={n.x} y={n.y + 4} textAnchor="middle" className="jtm-node-initial" aria-hidden="true">{n.name.slice(0, 2)}</text>
              <text x={n.x} y={n.y + n.r0 + 16} textAnchor="middle" className="jtm-node-name" aria-hidden="true">{n.name}{isOut ? ' · out' : ''}</text>
              <text x={n.x} y={n.y + n.r0 + 30} textAnchor="middle" className={`jtm-node-score${delta !== 0 && absent.size ? ' jtm-changed' : ''}`} aria-hidden="true">{scoreText}</text>
            </g>
          );
        })}

        {layout.edges.map((e) => {
          const b = badges.get(e.id);
          const blockerKey = b.pairs[0].blockerKey;
          const desc = b.pairs.map((p) => coverText(model, p, e.to)).join('; ');
          return (
            <g
              key={e.id}
              role="button"
              tabIndex={0}
              className={`jtm-badge jtm-badge--${b.color}${edgeFaded(e) ? ' jtm-faded' : ''}`}
              data-badge={e.id}
              aria-label={`Cover for ${model.nameOf(e.from)} waits on ${model.nameOf(e.to)}: ${b.color === 'green' ? 'green' : 'amber'}, ${desc}. Open who has worked on ${blockerKey}.`}
              onClick={() => onBadge?.(e.id, blockerKey)}
              onKeyDown={(ev) => onBadgeKey(ev, e.id, blockerKey)}
            >
              <circle cx={e.badge.x} cy={e.badge.y} r={e.badge.r + 1} />
              <text x={e.badge.x} y={e.badge.y + 3.5} textAnchor="middle" aria-hidden="true">{b.color === 'green' ? '✓' : '1'}</text>
              <title>{desc}</title>
            </g>
          );
        })}
      </svg>

      <ul id="jtm-sr-edges" className="jtm-sr-only" data-testid="sr-edges">
        {sentences.map((s, i) => (
          <li key={i}>{s.text}</li>
        ))}
      </ul>


    </div>
  );
}
