// Jira REST data -> people, dependencies, person edges, knowledge records, data quality.
// Pure module: no React, no I/O. Runs in node and in the browser.
import { toMs, DAY_MS, dueText, isOverdue } from './dates.js';
import { RELATION_TYPES, givesContext, relationDirection, relationTypeOfJira } from './relationTypes.js';

export { relationDirection, relationTypeOfJira };

export const STALE_DAYS = 14;
export const DEPENDENCY_TYPE = /block|depend/i;

const WAIT_PHRASE = /blocked by|depends on|depend on|waits? (?:on|for)/i;
const BLOCK_PHRASE = /\bblocks\b/i;
const DEFAULT_GROUP =
  /^(jira-|confluence-|bitbucket-|statuspage-|opsgenie-|atlassian-|site-admins$|administrators$|org-admins$|users$|trusted-users$)/i;

const pct = (n, d) => (d === 0 ? 0 : Math.round((100 * n) / d));
const uniq = (xs) => [...new Set(xs)];
const byKeyOrder = (a, b) => {
  const [pa, na] = a.split('-');
  const [pb, nb] = b.split('-');
  return pa === pb ? Number(na) - Number(nb) : pa < pb ? -1 : 1;
};
const sortKeys = (keys) => uniq(keys).sort(byKeyOrder);

export function isDefaultGroup(name) {
  return DEFAULT_GROUP.test(name);
}

/** "platform-team" / "team-platform" / "platform_team" -> "Platform" */
export function teamFromGroup(name) {
  const core = name.replace(/^team[-_ ]+/i, '').replace(/[-_ ]+team$/i, '').replace(/[-_]+/g, ' ').trim();
  return core.replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Which way a link type points. Returns 'outward-blocks' (source blocks target) or
 * 'outward-waits' (source waits on target), read from the type's wording, so a
 * "depends on" type is not mistaken for "blocks".
 */
export function linkDirection(type) {
  const out = type.outward ?? '';
  const inw = type.inward ?? '';
  if (WAIT_PHRASE.test(out)) return 'outward-waits';
  if (WAIT_PHRASE.test(inw)) return 'outward-blocks';
  if (BLOCK_PHRASE.test(out)) return 'outward-blocks';
  if (BLOCK_PHRASE.test(inw)) return 'outward-waits';
  return 'outward-blocks'; // Jira's own convention for "Blocks"
}

/** The team a person would get without a team set in the app (shown in the team editor). */
function derivedTeam(a, grp, assignedProjects, projectNames) {
  if (a.teamField) return { derivedTeam: a.teamField, derivedSource: 'team field' };
  if (grp) return { derivedTeam: teamFromGroup(grp), derivedSource: 'jira group' };
  if (assignedProjects.has(a.accountId)) {
    const [[key]] = [...assignedProjects.get(a.accountId).entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    return { derivedTeam: projectNames.get(key) ?? key, derivedSource: 'project key' };
  }
  return { derivedTeam: null, derivedSource: 'none' };
}

const groupName = (g) => (typeof g === 'string' ? g : g?.name ?? '');

export function buildModel(data, options = {}) {
  // teams set in the app (team editor): { [accountId]: teamName }; they win over every other source
  const teamOverrides = options.teamOverrides ?? {};
  const now = options.now ?? data.asOf ?? new Date().toISOString();
  const nowMs = toMs(now);

  // ---------- accounts ----------
  const accounts = new Map();
  const addAccount = (u, listed) => {
    if (!u?.accountId) return null;
    const prev = accounts.get(u.accountId);
    if (prev) return prev;
    const a = {
      accountId: u.accountId,
      displayName: u.displayName ?? u.accountId,
      active: u.active !== false,
      accountType: u.accountType ?? 'atlassian',
      teamField: u.team ?? null,
      groups: (u.groups ?? []).map(groupName).filter(Boolean),
      listed,
    };
    accounts.set(a.accountId, a);
    return a;
  };
  for (const u of data.users ?? []) addAccount(u, true);
  for (const raw of data.issues) {
    const f = raw.fields;
    addAccount(f.assignee, false);
    addAccount(f.reporter, false);
    for (const hist of raw.changelog?.histories ?? []) {
      addAccount(hist.author, false);
      for (const it of hist.items ?? []) {
        if (it.field !== 'assignee') continue;
        if (it.from) addAccount({ accountId: it.from, displayName: it.fromString }, false);
        if (it.to) addAccount({ accountId: it.to, displayName: it.toString }, false);
      }
    }
  }
  const exclusionReason = (a) => {
    if (!a) return 'unknown account';
    if (a.accountType === 'app') return 'bot or app';
    if (a.accountType !== 'atlassian') return `${a.accountType} account`;
    if (!a.active) return 'deactivated';
    return null;
  };
  const isPerson = (id) => !!id && exclusionReason(accounts.get(id)) == null;
  const nameOf = (id) => accounts.get(id)?.displayName ?? 'Unassigned';

  // ---------- issues ----------
  const issues = data.issues.map((raw) => {
    const f = raw.fields;
    const t = f.issuetype ?? {};
    const isSubtask = !!t.subtask;
    const isEpic = /^epic$/i.test(t.name ?? '') || t.hierarchyLevel === 1;
    const cat = f.status?.statusCategory?.key ?? 'new';
    const done = cat === 'done';
    const updatedMs = toMs(f.updated);
    const assigneeId = f.assignee?.accountId ?? null;
    const reporterId = f.reporter?.accountId ?? null;
    return {
      key: raw.key,
      summary: f.summary,
      status: f.status?.name ?? 'Unknown',
      statusCategory: cat,
      done,
      // "blocked" = a Blocked status or Jira's Flagged marker (fields.flagged is set by the loader)
      statusBlocked: /blocked/i.test(f.status?.name ?? ''),
      flagged: !!f.flagged,
      blocked: /blocked/i.test(f.status?.name ?? '') || !!f.flagged,
      type: t.name ?? 'Task',
      isEpic,
      isSubtask,
      parentKey: f.parent?.key ?? null,
      epicKey: null,
      workKey: raw.key,
      subtaskKeys: [],
      project: f.project?.key ?? raw.key.split('-')[0],
      projectName: f.project?.name ?? f.project?.key ?? raw.key.split('-')[0],
      components: (f.components ?? []).map((c) => c.name),
      labels: f.labels ?? [],
      due: f.duedate ?? null,
      overdue: !done && isOverdue(f.duedate, now),
      created: f.created ?? null,
      updated: f.updated ?? null,
      resolved: f.resolutiondate ?? null,
      points: f.customfield_10016 ?? null,
      assigneeId,
      assigneeExcluded: !!assigneeId && !isPerson(assigneeId),
      ownerId: isPerson(assigneeId) ? assigneeId : null,
      reporterId,
      leadId: null,
      leadSource: null,
      stale: !done && !isEpic && updatedMs != null && nowMs - updatedMs > STALE_DAYS * DAY_MS,
      raw,
    };
  });
  const issueByKey = new Map(issues.map((i) => [i.key, i]));

  for (const i of issues) {
    const parent = i.parentKey ? issueByKey.get(i.parentKey) : null;
    if (i.isSubtask && parent) {
      i.workKey = parent.key;
      parent.subtaskKeys.push(i.key);
    } else if (parent?.isEpic) {
      i.epicKey = parent.key;
    }
    if (i.ownerId) {
      i.leadId = i.ownerId;
      i.leadSource = 'assignee';
    } else if (isPerson(i.reporterId)) {
      i.leadId = i.reporterId;
      i.leadSource = 'reporter';
    }
  }
  for (const i of issues) {
    if (i.isSubtask && i.parentKey) i.epicKey = issueByKey.get(i.parentKey)?.epicKey ?? null;
  }
  const isWorkItem = (i) => !i.isEpic && !i.isSubtask;

  // ---------- people & teams ----------
  const assignedProjects = new Map();
  for (const i of issues) {
    if (!i.ownerId || i.isEpic) continue;
    const m = assignedProjects.get(i.ownerId) ?? new Map();
    m.set(i.project, (m.get(i.project) ?? 0) + 1);
    assignedProjects.set(i.ownerId, m);
  }
  const projectNames = new Map(issues.map((i) => [i.project, i.projectName]));

  const people = [];
  const excluded = [];
  for (const a of accounts.values()) {
    const reason = exclusionReason(a);
    if (reason) {
      const appearsOn = sortKeys(
        issues
          .filter(
            (i) =>
              i.assigneeId === a.accountId ||
              i.reporterId === a.accountId ||
              (i.raw.changelog?.histories ?? []).some((h) =>
                (h.items ?? []).some((it) => it.field === 'assignee' && (it.from === a.accountId || it.to === a.accountId)),
              ),
          )
          .map((i) => i.key),
      );
      excluded.push({ accountId: a.accountId, displayName: a.displayName, reason, keys: appearsOn });
      continue;
    }
    let team = null;
    let teamSource = 'none';
    const grp = a.groups.find((g) => !isDefaultGroup(g));
    const set = teamOverrides[a.accountId];
    if (set) {
      team = set;
      teamSource = 'set in app';
    } else if (a.teamField) {
      team = a.teamField;
      teamSource = 'team field';
    } else if (grp) {
      team = teamFromGroup(grp);
      teamSource = 'jira group';
    } else if (assignedProjects.has(a.accountId)) {
      const [[key]] = [...assignedProjects.get(a.accountId).entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
      team = projectNames.get(key) ?? key;
      teamSource = 'project key';
    }
    const owned = issues.filter((i) => i.ownerId === a.accountId && !i.isEpic);
    people.push({
      accountId: a.accountId,
      name: a.displayName,
      team,
      teamSource,
      ...derivedTeam(a, grp, assignedProjects, projectNames),
      openKeys: sortKeys(owned.filter((i) => !i.done && isWorkItem(i)).map((i) => i.key)),
      openSubtaskKeys: sortKeys(owned.filter((i) => !i.done && i.isSubtask).map((i) => i.key)),
      reporterOnly: owned.length === 0 && issues.some((i) => i.reporterId === a.accountId),
    });
  }
  people.sort((x, y) => (x.team ?? '~').localeCompare(y.team ?? '~') || x.name.localeCompare(y.name));
  const personById = new Map(people.map((p) => [p.accountId, p]));

  // ---------- links -> dependencies ----------
  const links = new Map();
  let mismatchedLinks = 0;
  for (const raw of data.issues) {
    for (const l of raw.fields.issuelinks ?? []) {
      const other = l.outwardIssue ?? l.inwardIssue;
      if (!other) continue;
      const [source, target] = l.outwardIssue ? [raw.key, other.key] : [other.key, raw.key];
      let entry = links.get(l.id);
      if (!entry) {
        entry = { id: l.id, type: l.type, source, target, sides: new Set() };
        links.set(l.id, entry);
      } else if (entry.source !== source || entry.target !== target) {
        mismatchedLinks++;
      }
      entry.sides.add(raw.key);
    }
  }

  const dq = {
    linksTotal: links.size,
    oneSided: [],
    ignored: [],
    external: [],
    epicLinks: [],
    selfAfterRollup: [],
    duplicatesMerged: [],
  };
  const workLinksRaw = [];
  const depMap = new Map();
  for (const l of links.values()) {
    const pairKeys = [l.source, l.target];
    if (l.sides.size < 2) dq.oneSided.push({ linkId: l.id, keys: pairKeys });
    if (!DEPENDENCY_TYPE.test(l.type?.name ?? '')) {
      const rel = relationTypeOfJira(l.type);
      if (rel) {
        const [fromKey, toKey] = relationDirection(l.type) === 'outward-newer' ? [l.source, l.target] : [l.target, l.source];
        workLinksRaw.push({ fromKey, toKey, type: rel, source: 'jira', linkId: l.id, jiraType: l.type.name });
      } else {
        dq.ignored.push({ linkId: l.id, type: l.type?.name, keys: pairKeys });
      }
      continue;
    }
    const dir = linkDirection(l.type);
    const [waiterRaw, blockerRaw] = dir === 'outward-waits' ? [l.source, l.target] : [l.target, l.source];
    const w0 = issueByKey.get(waiterRaw);
    const b0 = issueByKey.get(blockerRaw);
    if (!w0 || !b0) {
      dq.external.push({ linkId: l.id, keys: pairKeys });
      continue;
    }
    if (w0.isEpic || b0.isEpic) {
      dq.epicLinks.push({ linkId: l.id, keys: pairKeys });
      continue;
    }
    const waiterKey = w0.workKey;
    const blockerKey = b0.workKey;
    if (waiterKey === blockerKey) {
      dq.selfAfterRollup.push({ linkId: l.id, keys: pairKeys, rolledTo: waiterKey });
      continue;
    }
    const id = `${waiterKey}<${blockerKey}`;
    let dep = depMap.get(id);
    if (!dep) {
      const w = issueByKey.get(waiterKey);
      const b = issueByKey.get(blockerKey);
      dep = {
        id,
        waiterKey,
        blockerKey,
        linkIds: [],
        linkTypes: [],
        sourcePairs: [],
        open: !w.done && !b.done,
        resolved: b.done,
      };
      depMap.set(id, dep);
    } else {
      dq.duplicatesMerged.push({ linkId: l.id, keys: pairKeys, mergedInto: id });
    }
    dep.linkIds.push(l.id);
    dep.linkTypes = uniq([...dep.linkTypes, l.type.name]);
    dep.sourcePairs.push({ waiterKey: waiterRaw, blockerKey: blockerRaw });
  }
  const dependencies = [...depMap.values()].sort(
    (a, b) => byKeyOrder(a.blockerKey, b.blockerKey) || byKeyOrder(a.waiterKey, b.waiterKey),
  );

  // ---------- person edges ----------
  const edgeMap = new Map();
  const openDeps = dependencies.filter((d) => d.open);
  const unownedBlockers = [];
  const unownedWaiters = [];
  const samePerson = [];
  for (const d of openDeps) {
    const w = issueByKey.get(d.waiterKey);
    const b = issueByKey.get(d.blockerKey);
    if (!b.ownerId) {
      unownedBlockers.push({ dependencyId: d.id, blockerKey: b.key, waiterKey: w.key, reason: b.assigneeExcluded ? 'assignee excluded' : 'unassigned' });
      continue;
    }
    if (!w.ownerId) {
      unownedWaiters.push({ dependencyId: d.id, blockerKey: b.key, waiterKey: w.key });
      continue;
    }
    if (w.ownerId === b.ownerId) {
      samePerson.push({ dependencyId: d.id, personId: w.ownerId, keys: [b.key, w.key] });
      continue;
    }
    const id = `${w.ownerId}>${b.ownerId}`;
    let e = edgeMap.get(id);
    if (!e) {
      e = { id, waiterId: w.ownerId, blockerId: b.ownerId, pairs: [], weight: 0, red: false };
      edgeMap.set(id, e);
    }
    const red = b.blocked || b.overdue;
    e.pairs.push({
      dependencyId: d.id,
      waiterKey: w.key,
      blockerKey: b.key,
      blockerBlocked: b.blocked,
      blockerOverdue: b.overdue,
      sentence: pairSentence(nameOf(w.ownerId), nameOf(b.ownerId), b, w, now),
    });
    e.weight = e.pairs.length;
    e.red = e.red || red;
  }
  const personEdges = [...edgeMap.values()].sort(
    (a, b) => nameOf(a.blockerId).localeCompare(nameOf(b.blockerId)) || nameOf(a.waiterId).localeCompare(nameOf(b.waiterId)),
  );

  // ---------- knowledge records ----------
  const knowledge = [];
  const cl = {
    issuesWithChangelog: 0,
    histories: 0,
    items: 0,
    assigneeChanges: 0,
    otherFieldItems: 0,
    statusOnlyHistories: 0,
    fromUnassigned: 0,
    fromExcluded: 0,
    supersededByCurrent: 0,
    duplicatePast: 0,
    used: 0,
    epicSkipped: 0,
  };
  const currentSkipped = { excluded: [], epic: [] };
  for (const i of issues) {
    const hist = i.raw.changelog?.histories ?? [];
    if (hist.length) cl.issuesWithChangelog++;
    if (i.isEpic) {
      if (i.assigneeId) currentSkipped.epic.push(i.key);
      for (const h of hist) {
        cl.histories++;
        cl.items += (h.items ?? []).length;
        cl.epicSkipped += (h.items ?? []).filter((it) => it.field === 'assignee').length;
      }
      continue;
    }
    const target = i.isSubtask ? issueByKey.get(i.parentKey) : i;
    if (!target || target.isEpic) continue;
    const viaSubtask = i.isSubtask;
    if (i.assigneeId) {
      if (i.ownerId) {
        knowledge.push({
          person: i.ownerId,
          issueKey: target.key,
          how: viaSubtask ? 'sub-task' : 'assignee',
          when: i.done ? i.resolved ?? i.updated : i.updated,
          current: !i.done && !target.done,
          via: i.key,
        });
      } else {
        currentSkipped.excluded.push(i.key);
      }
    }
    const past = new Map();
    for (const h of [...hist].sort((a, b) => toMs(a.created) - toMs(b.created))) {
      cl.histories++;
      const items = h.items ?? [];
      cl.items += items.length;
      if (items.length && items.every((it) => it.field === 'status')) cl.statusOnlyHistories++;
      for (const it of items) {
        if (it.field !== 'assignee') {
          cl.otherFieldItems++;
          continue;
        }
        cl.assigneeChanges++;
        if (!it.from) {
          cl.fromUnassigned++;
          continue;
        }
        if (!isPerson(it.from)) {
          cl.fromExcluded++;
          continue;
        }
        if (it.from === i.assigneeId) {
          cl.supersededByCurrent++;
          continue;
        }
        if (past.has(it.from)) cl.duplicatePast++;
        past.set(it.from, h.created);
      }
    }
    for (const [person, when] of past) {
      cl.used++;
      knowledge.push({ person, issueKey: target.key, how: 'past assignee', when, current: false, via: i.key });
    }
  }
  knowledge.sort((a, b) => byKeyOrder(a.issueKey, b.issueKey) || toMs(b.when) - toMs(a.when));

  const knowledgeByIssue = new Map();
  for (const k of knowledge) {
    const list = knowledgeByIssue.get(k.issueKey) ?? [];
    list.push(k);
    knowledgeByIssue.set(k.issueKey, list);
  }

  // ---------- work links: builds on / follows up on / replaces / fixes / related to ----------
  // From Jira links of those kinds, plus relations added in My work (options.extraRelations).
  // Rolled up to top-level work; never a dependency; never drawn as an arrow on the team map.
  const workLinks = [];
  const workLinksSkipped = [];
  const seenPair = new Set();
  for (const r of [...workLinksRaw, ...(options.extraRelations ?? []).map((x) => ({ type: 'builds_on', ...x, source: 'app' }))]) {
    const a = issueByKey.get(r.fromKey);
    const b = issueByKey.get(r.toKey);
    if (!a || !b || a.isEpic || b.isEpic || !RELATION_TYPES[r.type]) {
      workLinksSkipped.push({ ...r, reason: !a || !b ? 'unknown issue' : !RELATION_TYPES[r.type] ? 'unknown type' : 'epic' });
      continue;
    }
    const fromKey = a.workKey;
    const toKey = b.workKey;
    const pair = [fromKey, toKey].sort().join('|');
    if (fromKey === toKey || seenPair.has(`${pair}|${r.type}`)) {
      workLinksSkipped.push({ ...r, reason: fromKey === toKey ? 'same task' : 'duplicate' });
      continue;
    }
    seenPair.add(`${pair}|${r.type}`);
    workLinks.push({
      id: `${fromKey}~${r.type}~${toKey}`,
      fromKey,
      toKey,
      type: r.type,
      source: r.source,
      linkId: r.linkId ?? null,
      jiraType: r.jiraType ?? null,
      createdBy: r.createdBy ?? null,
      createdAt: r.createdAt ?? null,
    });
  }
  const linksByKey = new Map(); // key -> work links touching it (either end)
  for (const r of workLinks) {
    linksByKey.set(r.fromKey, [...(linksByKey.get(r.fromKey) ?? []), r]);
    linksByKey.set(r.toKey, [...(linksByKey.get(r.toKey) ?? []), r]);
  }
  // Context records: people who worked on B have context for A when "A builds on / follows up on / replaces / fixes B".
  // Kept apart from knowledgeByIssue: they never count as "worked on this ticket" or "still on it".
  const contextByIssue = new Map();
  for (const r of workLinks) {
    if (!givesContext(r.type)) continue;
    for (const k of knowledgeByIssue.get(r.toKey) ?? []) {
      const list = contextByIssue.get(r.fromKey) ?? [];
      list.push({ person: k.person, issueKey: r.fromKey, how: 'earlier work', relType: r.type, when: k.when, current: false, via: r.toKey, viaHow: k.how, relation: r.source });
      contextByIssue.set(r.fromKey, list);
    }
  }
  const withContextLink = new Set(workLinks.filter((r) => givesContext(r.type)).map((r) => r.fromKey));

  // ---------- data quality ----------
  const workItems = issues.filter(isWorkItem);
  const openWork = workItems.filter((i) => !i.done);
  const openAssigned = openWork.filter((i) => i.ownerId);
  const secondPerson = openWork.filter((i) => {
    const others = uniq((knowledgeByIssue.get(i.key) ?? []).map((k) => k.person)).filter((p) => p !== i.ownerId);
    return i.ownerId ? others.length >= 1 : others.length >= 2;
  });
  const teamSources = {};
  for (const p of people) {
    teamSources[p.teamSource] ??= [];
    teamSources[p.teamSource].push(p.accountId);
  }

  const dataQuality = {
    asOf: now,
    issues: {
      total: issues.length,
      keys: sortKeys(issues.map((i) => i.key)),
      epics: sortKeys(issues.filter((i) => i.isEpic).map((i) => i.key)),
      subtasks: sortKeys(issues.filter((i) => i.isSubtask).map((i) => i.key)),
      workItems: sortKeys(workItems.map((i) => i.key)),
      openWork: sortKeys(openWork.map((i) => i.key)),
      doneWork: sortKeys(workItems.filter((i) => i.done).map((i) => i.key)),
    },
    openWorkAssigned: {
      pct: pct(openAssigned.length, openWork.length),
      keys: sortKeys(openAssigned.map((i) => i.key)),
      unassigned: sortKeys(openWork.filter((i) => !i.assigneeId).map((i) => i.key)),
      assignedToExcluded: sortKeys(openWork.filter((i) => i.assigneeExcluded).map((i) => i.key)),
    },
    links: {
      total: dq.linksTotal,
      mismatched: mismatchedLinks,
      oneSided: dq.oneSided,
      ignored: dq.ignored,
      external: dq.external,
      epicLinks: dq.epicLinks,
      selfAfterRollup: dq.selfAfterRollup,
      duplicatesMerged: dq.duplicatesMerged,
    },
    dependencies: {
      total: dependencies.length,
      open: openDeps.map((d) => d.id),
      resolved: dependencies.filter((d) => d.resolved).map((d) => d.id),
      keys: sortKeys(openDeps.flatMap((d) => [d.waiterKey, d.blockerKey])),
    },
    blockersWithoutAssignee: unownedBlockers,
    waitersWithoutAssignee: unownedWaiters,
    samePersonDependencies: samePerson,
    excludedAccounts: excluded,
    teamSources,
    secondPerson: { pct: pct(secondPerson.length, openWork.length), keys: sortKeys(secondPerson.map((i) => i.key)) },
    stale: sortKeys(issues.filter((i) => i.stale).map((i) => i.key)),
    flagged: sortKeys(issues.filter((i) => i.flagged && !i.done && !i.isEpic).map((i) => i.key)),
    withDueDate: { pct: pct(openWork.filter((i) => i.due).length, openWork.length), keys: sortKeys(openWork.filter((i) => i.due).map((i) => i.key)) },
    workLinks: {
      fromJira: workLinks.filter((r) => r.source === 'jira').length,
      addedInApp: workLinks.filter((r) => r.source === 'app').length,
      byType: Object.fromEntries(Object.keys(RELATION_TYPES).map((t) => [t, workLinks.filter((r) => r.type === t).length])),
      keys: sortKeys(workLinks.flatMap((r) => [r.fromKey, r.toKey])),
      openWithEarlier: {
        pct: pct(openWork.filter((i) => withContextLink.has(i.key)).length, openWork.length),
        keys: sortKeys(openWork.filter((i) => withContextLink.has(i.key)).map((i) => i.key)),
      },
      skipped: workLinksSkipped,
    },
    changelog: cl,
    currentAssigneeSkipped: currentSkipped,
  };

  return {
    asOf: now,
    issues,
    issueByKey,
    people,
    personById,
    excluded,
    dependencies,
    personEdges,
    knowledge,
    knowledgeByIssue,
    workLinks,
    linksByKey,
    contextByIssue,
    dataQuality,
    nameOf,
  };
}

export function pairSentence(waiterName, blockerName, blocker, waiter, now) {
  const state = [blocker.status, blocker.flagged && 'flagged', dueText(blocker.due, now)].filter(Boolean).join(', ');
  return `${waiterName} waits on ${blockerName}: ${blockerName}'s '${blocker.summary}' [${blocker.key}] (${state}) blocks ${waiterName}'s '${waiter.summary}' [${waiter.key}].`;
}

/** Provenance line numbers, each with the ticket keys behind it. */
export function provenance(model) {
  const dq = model.dataQuality;
  return {
    issues: { n: dq.issues.total, keys: dq.issues.keys },
    assignedPct: { n: dq.openWorkAssigned.pct, keys: dq.openWorkAssigned.keys },
    dependencyLinks: { n: dq.dependencies.open.length, keys: dq.dependencies.keys },
    addedInApp: { n: dq.workLinks.addedInApp, keys: model.workLinks.filter((r) => r.source === 'app').flatMap((r) => [r.fromKey, r.toKey]) },
    text: `Built from ${dq.issues.total} Jira issues with no manual input · ${dq.openWorkAssigned.pct}% assigned · ${dq.dependencies.open.length} dependency links`,
  };
}
