// My work board: one person's tasks in time columns, left (now) to right (past). Pure, no React.
import { toMs, DAY_MS, agoText } from './dates.js';
import { suggestBuildsOn } from './suggest.js';

export const BOARD_DAYS = 365; // the "has worked on" window
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const dateOf = (i) => (i.done ? i.resolved ?? i.updated : i.updated);

/** Column id and label for a task: Now, This week, Last week, 2–4 weeks ago, then by month, then Older. */
export function columnOf(model, issue) {
  if (!issue.done) return { id: 'now', label: 'Now', order: 0 };
  const days = (toMs(model.asOf) - toMs(dateOf(issue))) / DAY_MS;
  const w = Math.floor(days / 7);
  if (w <= 0) return { id: 'w0', label: 'This week', order: 1 };
  if (w === 1) return { id: 'w1', label: 'Last week', order: 2 };
  if (w <= 4) return { id: 'w2', label: '2–4 weeks ago', order: 3 };
  if (days > BOARD_DAYS) return { id: 'older', label: 'Older', order: 9999 };
  const d = new Date(toMs(dateOf(issue)));
  const months = (new Date(toMs(model.asOf)).getUTCFullYear() - d.getUTCFullYear()) * 12 + new Date(toMs(model.asOf)).getUTCMonth() - d.getUTCMonth();
  return { id: `m${d.getUTCFullYear()}-${d.getUTCMonth()}`, label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`, order: 10 + months };
}

/**
 * Cards on a person's board:
 * - own: their top-level tasks, open + Done in the last 12 months
 * - linked: other people's tasks linked to one of theirs (any relation type)
 * - pinned: tasks added through "Add a card" so a line can be drawn to them
 * - ghost: suggested earlier work (dashed line with "?"), not yet confirmed
 */
export function boardCards(model, personId, { pinned = [], dismissed = [], suggestions = true } = {}) {
  const nowMs = toMs(model.asOf);
  const cards = new Map();
  const add = (issue, kind) => {
    if (!issue || issue.isEpic || cards.has(issue.workKey)) return;
    const i = model.issueByKey.get(issue.workKey);
    if (i.ownerId === personId && kind !== 'ghost') kind = 'own'; // their own older task, shown because it is linked
    cards.set(i.key, { key: i.key, kind, issue: i, ownerId: i.ownerId, date: dateOf(i), ago: agoText(dateOf(i), model.asOf), column: columnOf(model, i) });
  };
  for (const i of model.issues) {
    if (i.isEpic || i.isSubtask || i.ownerId !== personId) continue;
    if (!i.done || nowMs - toMs(dateOf(i)) <= BOARD_DAYS * DAY_MS) add(i, 'own');
  }
  const own = [...cards.keys()];
  for (const k of own) for (const r of model.linksByKey.get(k) ?? []) add(model.issueByKey.get(r.fromKey === k ? r.toKey : r.fromKey), 'linked');
  for (const k of pinned) add(model.issueByKey.get(k), 'pinned');
  const ghostLines = [];
  if (suggestions) {
    for (const k of own) {
      if (model.issueByKey.get(k).done) continue;
      for (const s of suggestBuildsOn(model, k, personId, { dismissed, max: 2 })) {
        add(model.issueByKey.get(s.toKey), 'ghost');
        ghostLines.push({ id: `${k}?${s.toKey}`, fromKey: k, toKey: s.toKey, reason: s.reason, owner: s.owner });
      }
    }
  }
  const lines = model.workLinks.filter((r) => cards.has(r.fromKey) && cards.has(r.toKey));
  return { cards: [...cards.values()], lines, ghostLines };
}

/** Group cards into columns, Now first; own cards before others; newest first within a column. */
export function boardColumns(model, personId, opts) {
  const { cards, lines, ghostLines } = boardCards(model, personId, opts);
  const cols = new Map();
  for (const c of cards) {
    const col = cols.get(c.column.id) ?? { ...c.column, cards: [] };
    col.cards.push(c);
    cols.set(c.column.id, col);
  }
  if (!cols.has('now')) cols.set('now', { id: 'now', label: 'Now', order: 0, cards: [] });
  const rank = { own: 0, linked: 1, pinned: 2, ghost: 3 };
  const list = [...cols.values()].sort((a, b) => a.order - b.order);
  for (const col of list) col.cards.sort((a, b) => rank[a.kind] - rank[b.kind] || toMs(b.date) - toMs(a.date) || a.key.localeCompare(b.key));
  return { columns: list, lines, ghostLines, cardCount: cards.length };
}
