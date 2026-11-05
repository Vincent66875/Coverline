// Findings that need no dependency links, and the setup checklist. Pure, no React.
import { workedOn, graph } from './scoring.js';
import { DEPENDENCY_TYPE, linkDirection } from './adapter.js';
import { RELATION_ORDER } from './relationTypes.js';
import { toMs } from './dates.js';

const pct = (n, d) => (d === 0 ? 0 : Math.round((100 * n) / d));

/**
 * Open work only one person has worked on (assignee, sub-task, past assignee, or earlier work it builds on,
 * in the last 12 months). Works on any Jira site: it needs only assignees and their history.
 * Grouped by person; tasks others wait on come first, then Blocked/flagged/overdue, then by due date.
 */
export function singlePersonWork(model, { absent = new Set() } = {}) {
  const { dependents } = graph(model);
  const rows = [];
  for (const p of model.people) {
    if (absent.has(p.accountId)) continue;
    const tasks = [];
    for (const key of p.openKeys) {
      const others = workedOn(model, key, { absent }).filter((w) => w.personId !== p.accountId);
      if (others.length) continue;
      const i = model.issueByKey.get(key);
      const waiting = (dependents.get(key) ?? []).filter((w) => model.issueByKey.get(w).ownerId && model.issueByKey.get(w).ownerId !== p.accountId);
      tasks.push({ key, summary: i.summary, status: i.status, blocked: i.blocked, statusBlocked: i.statusBlocked, flagged: i.flagged, overdue: i.overdue, stale: i.stale, due: i.due, waitingKeys: waiting });
    }
    if (!tasks.length) continue;
    const urgency = (t) => (t.waitingKeys.length ? 0 : t.blocked || t.overdue ? 1 : 2);
    tasks.sort((a, b) => urgency(a) - urgency(b) || (toMs(a.due) ?? Infinity) - (toMs(b.due) ?? Infinity) || a.key.localeCompare(b.key));
    rows.push({ personId: p.accountId, name: p.name, team: p.team, tasks, waitedOn: tasks.filter((t) => t.waitingKeys.length).length });
  }
  rows.sort((a, b) => b.waitedOn - a.waitedOn || b.tasks.length - a.tasks.length || a.name.localeCompare(b.name));
  const openWork = model.dataQuality.issues.openWork.length;
  const count = rows.reduce((n, r) => n + r.tasks.length, 0);
  return { rows, count, openWork, pct: pct(count, openWork), keys: rows.flatMap((r) => r.tasks.map((t) => t.key)) };
}

/** True when Jira records something this issue waits on, even if that issue was not loaded (another project). */
function hasRecordedBlocker(model, issue) {
  const keys = [issue.key, ...issue.subtaskKeys];
  return keys.some((k) =>
    (model.issueByKey.get(k)?.raw.fields.issuelinks ?? []).some((l) => {
      if (!DEPENDENCY_TYPE.test(l.type?.name ?? '')) return false;
      const outwardWaits = linkDirection(l.type) === 'outward-waits';
      // this issue waits when it is the source of a "waits" link, or the target of a "blocks" link
      return l.outwardIssue ? outwardWaits : !outwardWaits;
    }),
  );
}

/** Open flagged / Blocked work with no recorded blocker: probably waiting on something no one linked. */
export function blockedWithoutBlocker(model) {
  return model.issues
    .filter((i) => !i.done && !i.isEpic && !i.isSubtask && i.blocked && !hasRecordedBlocker(model, i))
    .map((i) => ({ key: i.key, summary: i.summary, owner: i.ownerId ? model.nameOf(i.ownerId) : 'unassigned', flagged: i.flagged }));
}

/**
 * Setup checklist: what this site's data supports, what is missing, and the one action that fixes each gap.
 * status: 'ok' | 'todo' | 'info'. Only 'todo' items count toward the "Set up" badge.
 * meta: loader meta (teamField, flaggedField) when known; linkCoverage: { relation: jiraTypeName | null }.
 */
export function setupStatus(model, { meta = null, linkCoverage = null } = {}) {
  const items = [];
  const all = model.people.filter((p) => !p.reporterOnly); // people who only report work don't need a team
  const sure = all.filter((p) => p.teamSource === 'team field' || p.teamSource === 'set in app');
  const guessed = all.filter((p) => p.teamSource === 'project key' || p.teamSource === 'jira group');
  const none = all.filter((p) => p.teamSource === 'none');
  const parts = [`${sure.length} of ${all.length} people have a team from the Team field or set here`];
  if (guessed.length) parts.push(`${guessed.length} ${guessed.length === 1 ? 'is' : 'are'} guessed from their main project`);
  if (none.length) parts.push(`${none.length} ${none.length === 1 ? 'has' : 'have'} no team`);
  items.push({
    id: 'teams',
    title: 'Put people in teams',
    status: guessed.length + none.length === 0 ? 'ok' : 'todo',
    detail: guessed.length + none.length === 0 ? `All ${all.length} people have a team from the Team field or set here.` : `${parts.join('; ')}.`,
    action: 'teams',
    actionLabel: 'Edit teams',
  });

  const openWork = model.dataQuality.issues.openWork;
  const linked = new Set(model.dataQuality.dependencies.keys);
  const openLinked = openWork.filter((k) => linked.has(k));
  const depPct = pct(openLinked.length, openWork.length);
  items.push({
    id: 'dependencies',
    title: 'Record what work waits on',
    status: model.personEdges.length === 0 || depPct < 15 ? 'todo' : 'ok',
    detail: `${openLinked.length} of ${openWork.length} open tasks are in a recorded blocks / depends link (${depPct}%). The map's arrows come only from these links. In Jira: open a task → Link issue → "is blocked by".`,
    keys: openLinked,
  });

  const waitingOnNothing = blockedWithoutBlocker(model);
  items.push({
    id: 'flagged',
    title: 'Blocked or flagged work with no blocker linked',
    status: waitingOnNothing.length ? 'todo' : 'ok',
    detail: waitingOnNothing.length
      ? waitingOnNothing.length === 1
        ? '1 open task is Blocked or flagged, but nothing is linked as what it waits on.'
        : `${waitingOnNothing.length} open tasks are Blocked or flagged, but nothing is linked as what they wait on.`
      : 'Every Blocked or flagged task has a linked blocker.',
    keys: waitingOnNothing.map((x) => x.key),
    actionLabel: 'Show tasks',
    action: 'tickets',
  });

  const single = singlePersonWork(model);
  items.push({
    id: 'single',
    title: 'Open work only one person has worked on',
    status: 'info',
    detail: `${single.count} of ${single.openWork} open tasks (${single.pct}%). Works without any links.`,
    keys: single.keys,
    action: 'single',
    actionLabel: 'Show list',
  });

  if (linkCoverage) {
    const jira = RELATION_ORDER.filter((t) => linkCoverage[t]);
    items.push({
      id: 'linktypes',
      title: 'Save My work links as Jira links',
      status: jira.length === RELATION_ORDER.length ? 'ok' : 'info',
      detail: `${jira.length} of ${RELATION_ORDER.length} relations are saved as Jira links on this site; the others are saved in the app. A Jira admin can add the missing link types.`,
      action: 'linktypes',
      missing: RELATION_ORDER.filter((t) => !linkCoverage[t]),
    });
  }

  if (meta && !meta.flaggedField)
    items.push({ id: 'flaggedField', title: 'Flagged marker', status: 'info', detail: 'This site has no Flagged field, so only a status named "Blocked" counts as blocked.' });

  const due = model.dataQuality.withDueDate;
  items.push({ id: 'due', title: 'Due dates', status: 'info', detail: `${due.pct}% of open work has a due date. Without one, work can't show as overdue.`, keys: due.keys });

  return { items, todo: items.filter((i) => i.status === 'todo').length };
}

/** The team editor's list: everyone, with current and suggested team. */
export function teamRoster(model) {
  return [...model.people]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ accountId: p.accountId, name: p.name, avatarUrl: p.avatarUrl ?? null, team: p.team, source: p.teamSource, suggested: p.derivedTeam, suggestedSource: p.derivedSource, reporterOnly: p.reporterOnly }));
}

/** Teams that have at least one person in them now (a renamed or emptied team disappears). */
export function teamNames(model) {
  return [...new Set(model.people.map((p) => p.team).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
