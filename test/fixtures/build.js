// Fixture builder: compact specs in, Jira Cloud REST-shaped JSON out
// (as returned by /rest/api/3/search?expand=changelog and /rest/api/3/users).
// Every link is written on BOTH issues with the same link id.

export const LINK_TYPES = {
  blocks: { id: '10000', name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
  depends: { id: '10100', name: 'Dependency', inward: 'is depended on by', outward: 'depends on' },
  relates: { id: '10003', name: 'Relates', inward: 'relates to', outward: 'relates to' },
  buildsOn: { id: '10200', name: 'Builds on', inward: 'is built on by', outward: 'builds on' },
  sequence: { id: '10201', name: 'Sequence', inward: 'is followed by', outward: 'follows' }, // a team's own wording
};

const STATUS = {
  'To Do': { id: '10000', cat: { id: 2, key: 'new', name: 'To Do' } },
  'In Progress': { id: '3', cat: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  'In Review': { id: '10002', cat: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  Blocked: { id: '10003', cat: { id: 4, key: 'indeterminate', name: 'In Progress' } },
  Done: { id: '10001', cat: { id: 3, key: 'done', name: 'Done' } },
};

const TYPES = {
  Epic: { id: '10000', name: 'Epic', subtask: false, hierarchyLevel: 1 },
  Story: { id: '10001', name: 'Story', subtask: false, hierarchyLevel: 0 },
  Task: { id: '10002', name: 'Task', subtask: false, hierarchyLevel: 0 },
  Bug: { id: '10004', name: 'Bug', subtask: false, hierarchyLevel: 0 },
  'Sub-task': { id: '10003', name: 'Sub-task', subtask: true, hierarchyLevel: -1 },
};

const ts = (d) => (d && d.length === 10 ? `${d}T12:00:00.000+0000` : d ?? null);

function statusObj(name) {
  const s = STATUS[name];
  if (!s) throw new Error(`unknown status ${name}`);
  return { id: s.id, name, statusCategory: { ...s.cat } };
}

/**
 * spec: { asOf, projects: {KEY: name}, users: [...], issues: [...], links: [{id, type, from, to}] }
 * link {type:'blocks', from:A, to:B}  => A blocks B
 * link {type:'depends', from:A, to:B} => A depends on B
 * link {type:'buildsOn', from:A, to:B} => A builds on B (B is earlier work)
 * link {type:'sequence', from:A, to:B} => A follows B
 */
export function buildFixture(spec) {
  const userById = new Map(spec.users.map((u) => [u.accountId, u]));
  const ref = (id) => {
    if (!id) return null;
    const u = userById.get(id);
    if (!u) throw new Error(`unknown user ${id}`);
    return { accountId: u.accountId, displayName: u.displayName, active: u.active, accountType: u.accountType };
  };

  let nextId = 10001;
  const byKey = new Map();
  const issues = spec.issues.map((s) => {
    const [projectKey] = s.key.split('-');
    const created = ts(s.created);
    const resolved = s.status === 'Done' ? ts(s.resolved) : null;
    const updated = ts(s.updated ?? s.resolved ?? s.created);
    const histories = (s.history ?? []).map((h, i) => ({
      id: String(nextId * 10 + i),
      author: ref(h.author ?? s.reporter),
      created: ts(h.at),
      items: h.items.map((it) =>
        it.field === 'assignee'
          ? {
              field: 'assignee', fieldtype: 'jira', fieldId: 'assignee',
              from: it.from ?? null, fromString: it.from ? userById.get(it.from).displayName : null,
              to: it.to ?? null, toString: it.to ? userById.get(it.to).displayName : null,
            }
          : {
              field: 'status', fieldtype: 'jira', fieldId: 'status',
              from: STATUS[it.from].id, fromString: it.from, to: STATUS[it.to].id, toString: it.to,
            },
      ),
    }));
    const issue = {
      id: String(nextId++),
      key: s.key,
      fields: {
        summary: s.summary,
        status: statusObj(s.status),
        issuetype: { ...TYPES[s.type] },
        assignee: ref(s.assignee),
        reporter: ref(s.reporter),
        project: { id: String(projectKey.length * 1000), key: projectKey, name: spec.projects[projectKey] },
        components: (s.components ?? []).map((name, i) => ({ id: `${projectKey}-c${i}`, name })),
        labels: s.labels ?? [],
        duedate: s.due ?? null,
        created,
        updated,
        resolutiondate: resolved,
        customfield_10016: s.points ?? null,
        parent: null,
        issuelinks: [],
      },
      changelog: { startAt: 0, maxResults: histories.length, total: histories.length, histories },
    };
    byKey.set(s.key, { issue, spec: s });
    return issue;
  });

  const brief = (issue) => ({
    id: issue.id,
    key: issue.key,
    fields: { summary: issue.fields.summary, status: issue.fields.status, issuetype: issue.fields.issuetype },
  });

  for (const { issue, spec: s } of byKey.values()) {
    if (!s.parent) continue;
    const p = byKey.get(s.parent);
    if (!p) throw new Error(`unknown parent ${s.parent}`);
    issue.fields.parent = brief(p.issue);
  }

  for (const l of spec.links) {
    const a = byKey.get(l.from)?.issue;
    const b = byKey.get(l.to)?.issue;
    if (!a || !b) throw new Error(`bad link ${l.id}`);
    const type = { ...LINK_TYPES[l.type] };
    a.fields.issuelinks.push({ id: String(l.id), type, outwardIssue: brief(b) });
    b.fields.issuelinks.push({ id: String(l.id), type: { ...type }, inwardIssue: brief(a) });
  }

  const users = spec.users.map((u) => ({
    accountId: u.accountId,
    displayName: u.displayName,
    active: u.active,
    accountType: u.accountType,
    ...(u.team ? { team: u.team } : {}),
    groups: (u.groups ?? []).map((name) => ({ name, groupId: `g-${name}` })),
  }));

  return { name: spec.name, asOf: spec.asOf, users, issues };
}
