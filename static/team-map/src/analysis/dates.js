// Pure date helpers. All day math is UTC, date-only.
export const DAY_MS = 86400000;

/** Parse Jira timestamps ("2026-10-27T12:00:00.000+0000"), ISO strings and YYYY-MM-DD. */
export function toMs(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  let s = String(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s += 'T00:00:00Z';
  s = s.replace(/([+-]\d\d)(\d\d)$/, '$1:$2');
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

export function dayIndex(value) {
  const ms = toMs(value);
  return ms == null ? null : Math.floor(ms / DAY_MS);
}

/** Whole days from `now` until `date` (negative = past). */
export function daysUntil(date, now) {
  const d = dayIndex(date);
  const n = dayIndex(now);
  return d == null || n == null ? null : d - n;
}

export function daysAgo(date, now) {
  const d = daysUntil(date, now);
  return d == null ? null : -d;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function dueText(due, now) {
  const d = daysUntil(due, now);
  if (d == null) return null;
  if (d === 0) return 'due today';
  if (d === 1) return 'due tomorrow';
  if (d > 1) return `due in ${d} days`;
  return `overdue by ${plural(-d, 'day')}`;
}

export function isOverdue(due, now) {
  const d = daysUntil(due, now);
  return d != null && d < 0;
}

export function agoText(when, now) {
  const d = daysAgo(when, now);
  if (d == null) return 'unknown time';
  if (d <= 0) return 'today';
  if (d < 60) return `${plural(d, 'day')} ago`;
  return `${plural(Math.round(d / 30.4), 'month')} ago`;
}
