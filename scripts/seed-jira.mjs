#!/usr/bin/env node
// Load the Team map demo data (test/fixtures/large.js) into a real Jira Cloud site, so the app has something to show.
//
//   JIRA_SITE=https://you.atlassian.net JIRA_EMAIL=you@gmail.com JIRA_TOKEN=... node scripts/seed-jira.mjs [--dry-run]
//   ... node scripts/seed-jira.mjs --clean        deletes every issue it created (label jtm-seed)
//
// People: scripts/seed-people.json maps demo people (mia, ken, ...) to your accounts by email or accountId.
// Demo people with no account are folded onto a teammate who has one. Re-running skips what already exists.
// Jira cannot backdate: created dates and history are stamped "now". Due dates keep their distance from the demo's "today".
import { readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spec } from '../test/fixtures/large.js';
import { makeRequest } from '../static/team-map/src/jira/request.js';
import { jiraTypeFor, createJiraLink } from '../static/team-map/src/jira/linkStore.js';
import { linkDirection } from '../static/team-map/src/analysis/adapter.js';

export const SEED_LABEL = 'jtm-seed';
const DAY = 86400000;

// who stands in for whom when a demo person has no account (first match with an account wins)
const TEAMS = {
  Design: ['mia', 'ivy', 'noah'],
  Frontend: ['ken', 'lea', 'omar'],
  Backend: ['sam', 'vic', 'tara', 'uri', 'dan'],
  Mobile: ['wen', 'xan', 'yui'],
  Product: ['paula'],
};
const FOLD = { noah: ['mia', 'ivy'], omar: ['lea', 'ken'], tara: ['sam', 'vic'], uri: ['vic', 'sam'], dan: ['sam', 'vic'], yui: ['xan', 'wen'] };
const teamOf = (p) => Object.keys(TEAMS).find((t) => TEAMS[t].includes(p));
const short = (demoId) => demoId?.replace(/^u-/, '') ?? null;

/** Demo person -> { accountId, as } for every demo user. as = the demo person whose account is used. */
export function foldPeople(accounts, meId) {
  const out = {};
  for (const u of spec.users) {
    const p = short(u.accountId);
    if (accounts[p]) { out[p] = { accountId: accounts[p], as: p }; continue; }
    const team = teamOf(p);
    const pick = [...(FOLD[p] ?? []), ...(TEAMS[team] ?? [])].find((c) => accounts[c]);
    out[p] = pick ? { accountId: accounts[pick], as: pick } : { accountId: meId, as: 'you' };
  }
  return out;
}

/** Status the demo wants -> names to try in this site's workflow. */
const STATUS_TRY = { 'To Do': ['To Do', 'Backlog', 'Open'], 'In Progress': ['In Progress'], 'In Review': ['In Review', 'Review', 'In Progress'], Blocked: ['Blocked', 'In Progress'], Done: ['Done', 'Closed', 'Resolved'] };
const CATEGORY = { 'To Do': 'new', 'In Progress': 'indeterminate', 'In Review': 'indeterminate', Blocked: 'indeterminate', Done: 'done' };

const typeOrder = (s) => (s.type === 'Epic' ? 0 : s.type === 'Sub-task' ? 2 : 1);
const adf = (text) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const addDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/**
 * seed({ request, people, projects, state, save, log, dryRun, today, flag })
 *   people:   { mia: 'email or accountId', ... }
 *   projects: { DES: 'DES', ... } demo key -> your project key (missing projects are created)
 *   state:    { keys: { 'DES-2': 'DES-14' }, links: [...], done: {...} } — saved after each step so re-runs resume
 */
export async function seed({ request, people = {}, projects = {}, state = { keys: {}, links: [], steps: {} }, save = async () => {}, log = console.log, dryRun = false, today = new Date(), flag = ['MOB-2'], createProjects = true }) {
  state.keys ??= {};
  state.links ??= [];
  state.steps ??= {};
  const warn = (m) => log(`  ! ${m}`);
  const me = await request('/rest/api/3/myself');

  // ---------- people
  log('People');
  const accounts = {};
  for (const [p, v] of Object.entries(people)) {
    if (!v) continue;
    if (!String(v).includes('@')) { accounts[p] = v; continue; }
    const found = (await request(`/rest/api/3/user/search?query=${encodeURIComponent(v)}`)) ?? [];
    const users = found.filter((u) => u.accountType === 'atlassian' && u.active !== false);
    const exact = users.filter((u) => u.emailAddress?.toLowerCase() === v.toLowerCase());
    const hit = exact.length === 1 ? exact[0] : users.length === 1 ? users[0] : null;
    if (!hit) throw new Error(`No single active Jira user found for ${p} (${v}). Has the invite been accepted? You can put the accountId instead of the email.`);
    accounts[p] = hit.accountId;
    log(`  ${p.padEnd(6)} → ${hit.displayName}`);
  }
  if (!Object.keys(accounts).length) throw new Error('scripts/seed-people.json maps no one. Copy seed-people.example.json and fill in your accounts.');
  const folded = foldPeople(accounts, me.accountId);
  const folds = Object.entries(folded).filter(([p, f]) => f.as !== p && p !== 'bot');
  if (folds.length) log(`  folded: ${folds.map(([p, f]) => `${p}→${f.as}`).join(', ')}`);
  const acct = (demoId) => (demoId ? folded[short(demoId)].accountId : null);

  // ---------- projects
  log('Projects');
  const keyOf = (demoKey) => projects[demoKey] ?? demoKey;
  const meta = {};
  for (const [demoKey, name] of Object.entries(spec.projects)) {
    const key = keyOf(demoKey);
    let proj = await request(`/rest/api/3/project/${key}`).catch((e) => (e.status === 404 ? null : Promise.reject(e)));
    if (!proj) {
      if (!createProjects || dryRun) { log(`  ${key}: missing — ${dryRun ? 'would create' : 'create it in Jira first'}`); if (!dryRun) throw new Error(`Project ${key} not found.`); continue; }
      proj = await request('/rest/api/3/project', {
        method: 'POST',
        body: { key, name: `${name} (demo)`, projectTypeKey: 'software', projectTemplateKey: 'com.pyxis.greenhopper.jira:gh-simplified-kanban-classic', leadAccountId: me.accountId, assigneeType: 'UNASSIGNED' },
      }).catch((e) => { throw new Error(`Could not create project ${key} (${e.message}). Create a Kanban project with key ${key} in Jira, then run again.`); });
      log(`  ${key}: created`);
    } else log(`  ${key}: found`);
    const types = await request(`/rest/api/3/issue/createmeta/${key}/issuetypes?maxResults=100`);
    const list = types?.issueTypes ?? types?.values ?? [];
    const byName = (n) => list.find((t) => t.name.toLowerCase() === n.toLowerCase());
    meta[demoKey] = {
      key,
      type: {
        Epic: byName('Epic'),
        Story: byName('Story') ?? byName('Task'),
        Task: byName('Task') ?? byName('Story'),
        'Sub-task': list.find((t) => t.subtask) ?? byName('Subtask') ?? byName('Sub-task'),
      },
      components: null,
    };
    if (!meta[demoKey].type.Task) throw new Error(`Project ${key} has no Task or Story issue type.`);
  }
  if (dryRun) {
    log(`Dry run: would create ${spec.issues.length} issues and ${spec.links.length} links. Nothing written.`);
    return { dryRun: true, folded };
  }

  const fields = (await request('/rest/api/3/field')) ?? [];
  const flaggedField = fields.find((f) => /^flagged$/i.test(f.name ?? '') && f.custom !== false)?.id ?? null;
  const linkTypes = (await request('/rest/api/3/issueLinkType'))?.issueLinkTypes ?? [];
  const offset = Math.round((today.getTime() - Date.parse(spec.asOf)) / DAY);

  // ---------- issues
  log(`Issues (due dates moved ${offset >= 0 ? '+' : ''}${offset} days to match today)`);
  const OPTIONAL = { reporter: 'reporter', components: 'components', duedate: 'due dates', description: 'description', labels: 'labels' };
  const dropped = new Set(state.dropped ?? []);
  let componentsOk = !dropped.has('components');
  const ordered = [...spec.issues].sort((a, b) => typeOrder(a) - typeOrder(b));
  for (const s of ordered) {
    if (state.keys[s.key]) continue;
    const [demoProj] = s.key.split('-');
    const m = meta[demoProj];
    const type = m.type[s.type] ?? m.type.Task;
    if (s.type === 'Sub-task' && !type?.subtask) { warn(`${s.key}: project ${m.key} has no sub-task type, created as a ${m.type.Task.name}`); }
    const history = (s.history ?? []).flatMap((h) => h.items.filter((i) => i.field === 'assignee'));
    const firstAssignee = history.length ? history[0].from : s.assignee;
    if (componentsOk && s.components?.length && !m.components) {
      try {
        const have = new Set(((await request(`/rest/api/3/project/${m.key}/components`)) ?? []).map((c) => c.name));
        for (const c of new Set(spec.issues.filter((i) => i.key.startsWith(`${demoProj}-`)).flatMap((i) => i.components ?? [])))
          if (!have.has(c)) await request('/rest/api/3/component', { method: 'POST', body: { name: c, project: m.key } });
        m.components = true;
      } catch (e) { componentsOk = false; warn(`components skipped (${e.message})`); }
    }
    const body = {
      project: { key: m.key },
      summary: s.summary,
      issuetype: { id: type.id },
      labels: [...(s.labels ?? []), SEED_LABEL],
      description: adf(`Team map demo data (${s.key}). Delete with: node scripts/seed-jira.mjs --clean`),
      ...(s.due ? { duedate: addDays(s.due, offset) } : {}),
      ...(firstAssignee ? { assignee: { accountId: acct(firstAssignee) } } : {}),
      ...(s.reporter ? { reporter: { accountId: acct(s.reporter) } } : {}),
      ...(componentsOk && s.components?.length ? { components: s.components.map((name) => ({ name })) } : {}),
      ...(s.parent ? { parent: { key: state.keys[s.parent] } } : {}),
    };
    for (const f of dropped) delete body[f];
    let created;
    for (let tries = 0; ; tries++) {
      try {
        created = await request('/rest/api/3/issue', { method: 'POST', body: { fields: body } });
        break;
      } catch (e) {
        if (tries > 5 || e.status !== 400) throw new Error(`${s.key}: ${e.message}`);
        const f = Object.keys(OPTIONAL).find((k) => body[k] !== undefined && new RegExp(k === 'duedate' ? 'due ?date' : k.replace(/s$/, ''), 'i').test(e.message));
        if (f) {
          dropped.add(f);
          state.dropped = [...dropped];
          if (f === 'components') componentsOk = false;
          delete body[f];
          warn(`Jira refused ${OPTIONAL[f]} on create, so they are left out${f === 'reporter' ? ' (you are the reporter of everything)' : f === 'labels' ? ' (--clean will use the saved list instead)' : ''}`);
          continue;
        }
        if (/assignee/i.test(e.message) && body.assignee) throw new Error(`${s.key}: ${e.message}. Is that person allowed to be assigned in ${m.key}?`);
        throw new Error(`${s.key}: ${e.message}`);
      }
    }
    state.keys[s.key] = created.key;
    await save(state);
    log(`  ${s.key.padEnd(7)} → ${created.key}  ${s.summary}`);
  }
  const real = (k) => state.keys[k];

  // ---------- assignee history: replay reassignments (each one becomes a changelog entry)
  log('Assignee history');
  for (const s of spec.issues) {
    const step = `history:${s.key}`;
    if (state.steps[step]) continue;
    const moves = (s.history ?? []).flatMap((h) => h.items.filter((i) => i.field === 'assignee'));
    let current = moves.length ? acct(moves[0].from) : acct(s.assignee);
    for (const mv of [...moves, { to: s.assignee }]) {
      const next = acct(mv.to);
      if (next === current) continue;
      await request(`/rest/api/3/issue/${real(s.key)}/assignee`, { method: 'PUT', body: { accountId: next } });
      current = next;
    }
    if (moves.length) log(`  ${real(s.key)}: ${moves.length} reassignment${moves.length > 1 ? 's' : ''}`);
    state.steps[step] = true;
    await save(state);
  }

  // ---------- status
  log('Statuses');
  const wantFlag = (k) => { state.steps[`flagwanted:${k}`] = true; };
  flag.filter((k) => real(k)).forEach(wantFlag);
  for (const s of spec.issues) {
    const step = `status:${s.key}`;
    if (state.steps[step] || s.status === 'To Do') { state.steps[step] = true; continue; }
    const key = real(s.key);
    const reached = await moveTo(request, key, s.status);
    if (!reached) warn(`${key}: could not reach "${s.status}"`);
    else if (reached.toLowerCase() !== s.status.toLowerCase()) {
      if (s.status === 'Blocked') { wantFlag(s.key); log(`  ${key}: no "Blocked" status here → In Progress + Flagged`); }
      else log(`  ${key}: "${s.status}" → "${reached}"`);
    }
    state.steps[step] = true;
    await save(state);
  }

  // ---------- flags
  const needFlag = Object.keys(state.steps).filter((k) => k.startsWith('flagwanted:')).map((k) => k.slice(11));
  if (needFlag.length) {
    log('Flagged');
    if (!flaggedField) warn('this site has no Flagged field; skipped');
    else
      for (const k of needFlag) {
        if (state.steps[`flag:${k}`]) continue;
        try {
          await request(`/rest/api/3/issue/${real(k)}`, { method: 'PUT', body: { fields: { [flaggedField]: [{ value: 'Impediment' }] } } });
          log(`  ${real(k)} flagged`);
        } catch (e) {
          warn(`${real(k)}: could not flag (${e.message}). Flag it by hand: ••• → Add flag.`);
        }
        state.steps[`flag:${k}`] = true;
        await save(state);
      }
  }

  // ---------- links
  log('Links');
  const blocksType = linkTypes.find((t) => /^blocks$/i.test(t.name)) ?? linkTypes.find((t) => /\bblocks\b/i.test(t.outward ?? ''));
  const dependsType = linkTypes.find((t) => /depend/i.test(`${t.name} ${t.outward} ${t.inward}`));
  const relatesType = linkTypes.find((t) => /^relates$/i.test(t.name));
  for (const l of spec.links) {
    const id = `${l.type}:${l.from}:${l.to}`;
    if (state.links.includes(id)) continue;
    let made = null;
    if (l.type === 'blocks' || l.type === 'depends') {
      // demo: "blocks" from = blocker; "depends" from = waiter
      const [blocker, waiter] = l.type === 'blocks' ? [l.from, l.to] : [l.to, l.from];
      const type = l.type === 'depends' && dependsType ? dependsType : blocksType;
      if (!type) { warn('no Blocks link type on this site; dependency links skipped'); break; }
      const subject = linkDirection(type) === 'outward-blocks' ? blocker : waiter;
      await linkWithOutward(request, type, real(subject), real(subject === blocker ? waiter : blocker));
      made = `${real(blocker)} blocks ${real(waiter)}${type === dependsType ? ` (${type.name})` : ''}`;
    } else if (l.type === 'relates') {
      if (relatesType) { await linkWithOutward(request, relatesType, real(l.from), real(l.to)); made = `${real(l.from)} relates to ${real(l.to)}`; }
    } else {
      const rel = l.type === 'buildsOn' ? 'builds_on' : 'follows_up';
      const jt = jiraTypeFor(linkTypes, rel);
      if (jt) { await createJiraLink(request, jt, real(l.from), real(l.to)); made = `${real(l.from)} ${jt.outward} ${real(l.to)}`; }
      else log(`  skipped ${real(l.from)} ${rel.replace('_', ' ')} ${real(l.to)}: no such link type (draw it in My work instead)`);
    }
    if (made) log(`  ${made}`);
    state.links.push(id);
    await save(state);
  }
  log(`Done: ${Object.keys(state.keys).length} issues. Open any of the projects → Team map.`);
  return { keys: state.keys, folded };
}

/** "subject <outward wording> object", read back and fixed if Jira stored it the other way round. */
async function linkWithOutward(request, type, subject, object) {
  const post = (inward, outward) => request('/rest/api/3/issueLink', { method: 'POST', body: { type: { id: type.id }, inwardIssue: { key: inward }, outwardIssue: { key: outward } } });
  const find = async () => ((await request(`/rest/api/3/issue/${subject}?fields=issuelinks`))?.fields?.issuelinks ?? []).find((x) => x.type?.id === type.id && (x.outwardIssue ?? x.inwardIssue)?.key === object);
  const existing = await find();
  if (existing?.outwardIssue || (existing && type.inward === type.outward)) return;
  if (existing) await request(`/rest/api/3/issueLink/${existing.id}`, { method: 'DELETE' });
  await post(subject, object);
  const l = await find();
  if (l && !l.outwardIssue && type.inward !== type.outward) {
    await request(`/rest/api/3/issueLink/${l.id}`, { method: 'DELETE' });
    await post(object, subject);
  }
}

/** Walk the workflow toward a status (up to 3 transitions). Returns the status name reached, or null. */
async function moveTo(request, key, want) {
  const names = (STATUS_TRY[want] ?? [want]).map((n) => n.toLowerCase());
  const cat = CATEGORY[want];
  for (let hop = 0; hop < 3; hop++) {
    const now = (await request(`/rest/api/3/issue/${key}?fields=status`)).fields.status;
    if (names.includes(now.name.toLowerCase())) return now.name;
    const ts = (await request(`/rest/api/3/issue/${key}/transitions`))?.transitions ?? [];
    const go = (t) => request(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: { transition: { id: t.id } } });
    const named = names.map((n) => ts.find((x) => x.to?.name?.toLowerCase() === n)).find(Boolean);
    if (named) { await go(named); continue; }
    const sameCategory = ts.find((x) => x.to?.statusCategory?.key === cat && x.to.name !== now.name);
    if (sameCategory) { await go(sameCategory); return sameCategory.to.name; }
    const step = ts.find((x) => x.to?.statusCategory?.key === 'indeterminate' && x.to.name !== now.name);
    if (!step) return null;
    await go(step);
  }
  return null;
}

/** Delete every issue carrying the seed label (sub-tasks with their parents). Projects are kept. */
export async function clean({ request, log = console.log, keys = [] }) {
  let n = 0;
  for (const k of keys) {
    const gone = await request(`/rest/api/3/issue/${k}?deleteSubtasks=true`, { method: 'DELETE' }).then(() => false, (e) => { if (e.status !== 404) throw e; return true; });
    if (!gone) n++;
  }
  for (;;) {
    const page = await request('/rest/api/3/search/jql', { method: 'POST', body: { jql: `labels = ${SEED_LABEL} ORDER BY key DESC`, fields: ['issuetype'], maxResults: 100 } });
    const issues = page?.issues ?? [];
    if (!issues.length) break;
    for (const i of issues) {
      await request(`/rest/api/3/issue/${i.key}?deleteSubtasks=true`, { method: 'DELETE' }).catch((e) => { if (e.status !== 404) throw e; });
      n++;
    }
  }
  log(`Deleted ${n} demo issues. The projects themselves were kept.`);
  return n;
}

// ---------------------------------------------------------------- CLI
async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const args = new Set(process.argv.slice(2));
  const { JIRA_SITE, JIRA_EMAIL, JIRA_TOKEN } = process.env;
  if (!JIRA_SITE || !JIRA_EMAIL || !JIRA_TOKEN) {
    console.error('Set JIRA_SITE (https://you.atlassian.net), JIRA_EMAIL and JIRA_TOKEN (https://id.atlassian.com/manage-profile/security/api-tokens).');
    process.exit(1);
  }
  const site = JIRA_SITE.replace(/\/+$/, '');
  const auth = `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`;
  const request = makeRequest((p, init) => fetch(site + p, { ...init, headers: { ...init.headers, Authorization: auth } }));
  const statePath = path.join(here, '.seed-state.json');

  if (args.has('--clean')) {
    const saved = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
    await clean({ request, keys: Object.values(saved.keys ?? {}).reverse() });
    await rm(statePath, { force: true });
    return;
  }
  const cfgPath = path.join(here, 'seed-people.json');
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8').catch(() => { throw new Error('Missing scripts/seed-people.json: copy scripts/seed-people.example.json and fill in your accounts.'); }));
  const state = JSON.parse(await readFile(statePath, 'utf8').catch(() => '{}'));
  await seed({
    request,
    people: cfg.people ?? cfg,
    projects: cfg.projects ?? {},
    flag: cfg.flag ?? ['MOB-2'],
    state,
    save: (s) => writeFile(statePath, JSON.stringify(s, null, 2)),
    dryRun: args.has('--dry-run'),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(`\nStopped: ${e.message}\nFix that and run again: finished steps are skipped.`);
    process.exit(1);
  });
