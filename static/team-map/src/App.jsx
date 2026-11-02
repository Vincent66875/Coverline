import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Drawer from './components/Drawer.jsx';
import { buildModel, provenance } from './analysis/adapter.js';
import { ranking } from './analysis/scoring.js';
import { whoHasWorkedOn, workedNear } from './analysis/search.js';
import { teamSentences } from './analysis/labels.js';
import { graphData } from './graph/graphData.js';
import PeopleGraph from './components/PeopleGraph.jsx';
import MyWork from './components/MyWork.jsx';
import { addRelation, canAdd, changeRelation, loadList, removeRelation, saveList } from './analysis/relations.js';
import { RELATION_TYPES } from './analysis/relationTypes.js';
import { AbsencePanel, DataQuality, Keys, PersonDetail, Ranking, SearchBox, TicketList, WorkedOnPanel, ZoomControl } from './components/Panels.jsx';
import { EmptyMapNotice, SetupBanner, SetupPanel, SinglePersonPanel, TeamEditor } from './components/SetupPanels.jsx';
import { setupStatus, singlePersonWork } from './analysis/coverage.js';

const COMPACT_BELOW = 1000; // px of app width; below this the panel overlays the map

/** True when the app frame (not the window) is narrower than `px`. */
function useCompact(ref, px) {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setCompact(entry.contentRect.width < px));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, px]);
  return compact;
}

/**
 * fixture: Jira-shaped data ({ name, asOf, users, issues }).
 * In Forge, links are saved by `linkOps` (Jira links or app storage) and app-stored links arrive as
 * `extraRelations`; without `linkOps` (local MVP) links and dismissals live in this browser.
 */
export default function App({
  fixture,
  initialZoom = 'ticket',
  initialTab = 'map',
  initialViewer = null,
  linkOps = null,
  extraRelations = [],
  dismissed: dismissedProp = [],
  onDismiss = null,
  dataNotes = [],
  linkCoverage = null,
  meta = null,
  teamOps = null, // Forge: { teams: { accountId: team }, save(map) }; local: browser storage
  prefs: prefsProp = null, // Forge: { setupBannerDismissed }; local: browser storage
  onPrefs = null,
}) {
  const rootRef = useRef(null);
  const compact = useCompact(rootRef, COMPACT_BELOW);
  const store = fixture.name ?? 'default';
  const local = !linkOps;
  const [localRels, setLocalRels] = useState(() => (local ? loadList(store, 'relations') : []));
  const [localDismissed, setLocalDismissed] = useState(() => (local ? loadList(store, 'dismissed') : []));
  useEffect(() => {
    if (local) saveList(store, 'relations', localRels);
  }, [local, store, localRels]);
  useEffect(() => {
    if (local) saveList(store, 'dismissed', localDismissed);
  }, [local, store, localDismissed]);
  const relations = local ? localRels : extraRelations;
  const dismissed = local ? localDismissed : dismissedProp;
  // teams set in the app (team editor) and per-user prefs; Forge passes them in, the local MVP keeps them in the browser
  const [localTeams, setLocalTeams] = useState(() => (teamOps ? {} : Object.fromEntries(loadList(store, 'teams'))));
  const [localPrefs, setLocalPrefs] = useState(() => (onPrefs ? {} : Object.fromEntries(loadList(store, 'prefs'))));
  useEffect(() => {
    if (!teamOps) saveList(store, 'teams', Object.entries(localTeams));
  }, [teamOps, store, localTeams]);
  useEffect(() => {
    if (!onPrefs) saveList(store, 'prefs', Object.entries(localPrefs));
  }, [onPrefs, store, localPrefs]);
  const teamOverrides = teamOps ? teamOps.teams : localTeams;
  const prefs = onPrefs ? prefsProp ?? {} : localPrefs;
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamStatus, setTeamStatus] = useState('');
  const model = useMemo(() => buildModel(fixture, { extraRelations: relations, teamOverrides }), [fixture, relations, teamOverrides]);
  const single = useMemo(() => singlePersonWork(model), [model]);
  const setup = useMemo(() => setupStatus(model, { meta, linkCoverage }), [model, meta, linkCoverage]);
  const [tab, setTab] = useState(initialTab);
  const [viewer, setViewer] = useState(() =>
    initialViewer && model.personById.has(initialViewer) ? initialViewer : model.people.find((p) => p.openKeys.length)?.accountId ?? model.people[0]?.accountId ?? null,
  );
  const [status, setStatus] = useState('');
  const prov = provenance(model);
  const [zoom, setZoom] = useState(initialZoom);
  const [selectedId, setSelectedId] = useState(null);
  const [absent, setAbsent] = useState(() => new Set());
  const [simulating, setSimulating] = useState(false);
  const [stack, setStack] = useState([]);
  const opener = useRef(null);
  const view = stack[stack.length - 1] ?? null;

  const remember = () => {
    if (!stack.length) opener.current = document.activeElement;
  };
  const open = (next) => {
    remember();
    setStack([next]);
  };
  const push = (next) => {
    remember();
    setStack((prev) => [...prev, next]);
  };
  const closeAll = useCallback(() => {
    setStack([]);
    setSelectedId(null);
    const el = opener.current;
    opener.current = null;
    if (el && el.isConnected && typeof el.focus === 'function') requestAnimationFrame(() => el.focus());
  }, []);
  const back = () => setStack((prev) => prev.slice(0, -1));

  // A person stays selected only while their details are in the panel stack.
  useEffect(() => {
    if (selectedId && !stack.some((v) => v.kind === 'person')) setSelectedId(null);
  }, [stack, selectedId]);

  // Esc closes the docked panel too (the modal one handles Esc itself).
  useEffect(() => {
    if (!view || compact) return undefined;
    const onKey = (ev) => {
      if (ev.key === 'Escape') closeAll();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [view, compact, closeAll]);

  const data = useMemo(() => graphData(model, { zoom, absent, selectedId }), [model, zoom, absent, selectedId]);
  const rank = useMemo(() => ranking(model, absent), [model, absent]);
  const teams = useMemo(() => (zoom === 'team' ? teamSentences(model, absent) : []), [model, zoom, absent]);
  const openTickets = (title, keys) => push({ kind: 'tickets', title, keys });
  const search = (input) => push({ kind: 'worked', result: whoHasWorkedOn(model, input, { absent }) });
  const toggleOut = (id) =>
    setAbsent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const selectPerson = (id) => {
    if (!id) {
      setSelectedId(null);
      setStack((prev) => prev.filter((v) => v.kind !== 'person'));
      return;
    }
    remember();
    setSelectedId(id);
    setStack((prev) => (prev[prev.length - 1]?.kind === 'person' ? prev : [...prev, { kind: 'person' }]));
  };
  const sel = selectedId ? data.risk.get(selectedId) : null;

  const sentence = (l) => `${l.fromKey} ${RELATION_TYPES[l.type].label} ${l.toKey}`;
  const where = (saved) => (saved === 'jira' ? ' (Jira link)' : ' (saved in the app: this site has no Jira link type for it)');
  // Work links drawn in My work. Resolves to a reason when refused (shown in the popup), null when saved.
  const addLink = async (link) => {
    if (local) {
      const r = addRelation(model, relations, link, viewer);
      if (r.reason) {
        setStatus(`Not added: ${r.reason}.`);
        return r.reason;
      }
      setLocalRels(r.relations);
      setStatus(`Linked: ${sentence(r.added)}.`);
      return null;
    }
    const check = canAdd(model, link.fromKey, link.toKey, link.type);
    if (!check.ok) {
      setStatus(`Not added: ${check.reason}.`);
      return check.reason;
    }
    setStatus(`Saving: ${sentence(link)}…`);
    try {
      const r = await linkOps.add({ fromKey: check.fromKey, toKey: check.toKey, type: link.type });
      setStatus(`Linked: ${sentence(link)}${where(r.saved)}.`);
      return null;
    } catch (e) {
      setStatus(`Not saved: ${e.message}`);
      return e.message;
    }
  };
  const changeLink = async (link, change) => {
    const next = { ...link, type: change.type ?? link.type, ...(change.swap ? { fromKey: link.toKey, toKey: link.fromKey } : {}) };
    if (local) {
      setLocalRels((prev) => changeRelation(prev, link, change));
      setStatus(`Changed: ${sentence(next)}.`);
      return;
    }
    setStatus(`Saving: ${sentence(next)}…`);
    try {
      const r = await linkOps.change(link, change);
      setStatus(`Changed: ${sentence(next)}${where(r.saved)}.`);
    } catch (e) {
      setStatus(`Not changed: ${e.message}`);
    }
  };
  const removeLink = async (link) => {
    if (local) {
      setLocalRels((prev) => removeRelation(prev, link));
      setStatus(`Removed: ${sentence(link)}.`);
      return;
    }
    setStatus(`Removing: ${sentence(link)}…`);
    try {
      await linkOps.remove(link);
      setStatus(`Removed: ${sentence(link)}.`);
    } catch (e) {
      setStatus(`Not removed: ${e.message}`);
    }
  };
  const saveTeams = async (changes) => {
    const n = Object.keys(changes).length;
    if (!teamOps) {
      setLocalTeams((prev) => {
        const next = { ...prev };
        for (const [k, v] of Object.entries(changes)) {
          if (v) next[k] = v;
          else delete next[k];
        }
        return next;
      });
      setTeamStatus(`Saved ${n === 1 ? '1 change' : `${n} changes`}.`);
      return;
    }
    setTeamBusy(true);
    setTeamStatus('Saving…');
    try {
      await teamOps.save(changes);
      setTeamStatus(`Saved ${n === 1 ? '1 change' : `${n} changes`}.`);
    } catch (e) {
      setTeamStatus(`Not saved: ${e.message}`);
    } finally {
      setTeamBusy(false);
    }
  };
  const dismissBanner = () => {
    const next = { ...prefs, setupBannerDismissed: true };
    if (onPrefs) onPrefs(next);
    else setLocalPrefs(next);
  };
  const setupAction = (action) => {
    if (action === 'teams') push({ kind: 'teams' });
    else if (action === 'single') push({ kind: 'single' });
  };
  const dismiss = (pair) => {
    if (local) setLocalDismissed((prev) => [...new Set([...prev, pair])]);
    else onDismiss?.(pair);
  };
  const switchTab = (next) => {
    setTab(next);
    setStack([]);
    setSelectedId(null);
    setStatus('');
  };

  const titles = { search: 'Find who worked on a task', tickets: view?.title, ranking: 'People & coverage', data: 'Data & coverage', key: 'Map key', impact: 'Absence impact', single: 'Work only one person has worked on', setup: 'Set up', teams: 'Edit teams' };
  const title =
    view?.kind === 'person' && sel ? `${sel.name}${sel.team ? ` · ${sel.team}` : ''}`
      : view?.kind === 'worked' ? (view.result.query ? `Who has worked on ${view.result.label}?` : 'Who has worked on this?')
        : titles[view?.kind] ?? 'Details';

  return (
    <div className="jtm" ref={rootRef}>
      <main className={`jtm-main jtm-board${simulating ? ' jtm-simulation' : ''}`}>
        <nav className="jtm-tabs" aria-label="Views">
          {[['map', 'Team map'], ['mywork', 'My work']].map(([v, l]) => (
            <button key={v} type="button" className={`jtm-tab${tab === v ? ' jtm-tab--on' : ''}`} aria-current={tab === v ? 'page' : undefined} onClick={() => switchTab(v)} data-tab={v}>{l}</button>
          ))}
        </nav>
        {tab === 'mywork' && (
          <MyWork
            model={model}
            personId={viewer}
            onPerson={(id) => { setViewer(id); setStatus(''); }}
            dismissed={dismissed}
            onAddLink={addLink}
            onChangeLink={changeLink}
            onRemoveLink={removeLink}
            compact={compact}
            onDismiss={dismiss}
            jiraEditable={!local}
            onShowOnMap={(id) => { switchTab('map'); selectPerson(id); }}
            status={status}
          />
        )}
        {tab === 'map' && <>
        <header className="jtm-board-header">
          <div><h1>Team map</h1><p>Recorded dependencies between people</p></div>
          <div className="jtm-board-actions">
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'search' })}>Find work</button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'single' })} data-testid="open-single">One-person work <span className="jtm-count-pill">{single.count}</span></button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'ranking' })}>People &amp; coverage</button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'data' })}>Data &amp; coverage</button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'key' })}>Map key</button>
            <button type="button" className="jtm-btn" onClick={() => open({ kind: 'setup' })} data-testid="open-setup">Set up{setup.todo > 0 && <span className="jtm-count-pill jtm-count-pill--todo" aria-label={`${setup.todo} to do`}>{setup.todo}</span>}</button>
            <button type="button" className="jtm-btn" aria-pressed={simulating} onClick={() => {
              if (simulating) { setAbsent(new Set()); setSimulating(false); }
              else { setSimulating(true); open({ kind: 'ranking' }); }
            }}>{simulating ? 'Exit simulation' : 'Simulate absence'}</button>
          </div>
        </header>
        {simulating && (
          <div className="jtm-simulation-bar" role="status">
            <span>Absence simulation · {absent.size} marked out</span>
            <button type="button" className="jtm-btn jtm-btn--small" onClick={() => open({ kind: 'ranking' })}>Choose people</button>
            {data.impact && <button type="button" className="jtm-btn jtm-btn--small" onClick={() => open({ kind: 'impact' })}>View impact</button>}
          </div>
        )}
        {setup.todo > 0 && !prefs.setupBannerDismissed && <SetupBanner todo={setup.todo} onOpen={() => open({ kind: 'setup' })} onDismiss={dismissBanner} />}
        {model.personEdges.length === 0 && (
          <EmptyMapNotice single={single} onSingle={() => open({ kind: 'single' })} onSearch={() => open({ kind: 'search' })} onSetup={() => open({ kind: 'setup' })} />
        )}
        <div className="jtm-map-toolbar"><ZoomControl zoom={zoom} onZoom={setZoom} /><span className="jtm-muted">Select a person or a badge for details</span></div>

        <div className={`jtm-stage${view && !compact ? ' jtm-stage--drawer' : ''}`}>
          <PeopleGraph
            model={model}
            data={data}
            selectedId={selectedId}
            absent={absent}
            onSelect={selectPerson}
            onBadge={(_id, key) => open({ kind: 'worked', result: whoHasWorkedOn(model, key, { absent }) })}
            onBackground={view && !compact ? closeAll : undefined}
          />
          <Drawer open={!!view} compact={compact} title={title} onClose={closeAll} onBack={stack.length > 1 ? back : null}>
            {view?.kind === 'search' && <><p>Search for a ticket or area to find people who have worked on it.</p><SearchBox model={model} onSearch={search} /></>}
            {view?.kind === 'worked' && <WorkedOnPanel bare result={view.result} onOpen={openTickets} />}
            {view?.kind === 'tickets' && <TicketList bare model={model} title={view.title} keys={view.keys} />}
            {view?.kind === 'person' && sel && <PersonDetail bare model={model} onEditTeam={() => push({ kind: 'teams', focusId: selectedId })} r={sel} out={absent.has(selectedId)} knowledge={data.knowledge} near={workedNear(model, selectedId, { absent })} onToggleOut={() => toggleOut(selectedId)} onOpen={openTickets} onSearch={search} />}
            {view?.kind === 'ranking' && <><p className="jtm-muted">{simulating ? 'Mark people out; the map updates beside this panel.' : 'Select a person to see their work and connections.'}</p><Ranking rows={rank.rows} absent={absent} selectedId={selectedId} onSelect={selectPerson} onToggleOut={toggleOut} onOpen={openTickets} /></>}
            {view?.kind === 'impact' && data.impact && <AbsencePanel bare model={model} impact={data.impact} onToggleOut={toggleOut} onClear={() => { setAbsent(new Set()); closeAll(); }} onOpen={openTickets} />}
            {view?.kind === 'impact' && !data.impact && <p className="jtm-muted">No one is marked out.</p>}
            {view?.kind === 'data' && <><p data-testid="provenance">Built from <Keys keys={prov.issues.keys} title={`${prov.issues.n} Jira issues`} onOpen={openTickets}>{prov.issues.n} Jira issues</Keys> · <Keys keys={prov.assignedPct.keys} title="Assigned open work" onOpen={openTickets}>{prov.assignedPct.n}% assigned</Keys> · <Keys keys={prov.dependencyLinks.keys} title="Tickets in open dependency links" onOpen={openTickets}>{prov.dependencyLinks.n} recorded dependency links</Keys>{prov.addedInApp.n > 0 && <> · <Keys keys={prov.addedInApp.keys} title="Builds-on relations added in My work" onOpen={openTickets}>{prov.addedInApp.n} added in My work</Keys></>}.</p><DataQuality model={model} onOpen={openTickets} /><p><button type="button" className="jtm-btn jtm-btn--small" onClick={() => push({ kind: 'teams' })}>Edit teams</button></p>{(dataNotes.length > 0 || linkCoverage) && <div className="jtm-sec" data-testid="data-notes"><h4>From this Jira site</h4><ul>{dataNotes.map((n) => <li key={n}>{n}</li>)}{linkCoverage && <li>Links drawn in My work: {Object.entries(linkCoverage).map(([t, name], i) => <span key={t}>{i > 0 && ' · '}{RELATION_TYPES[t].label} → {name ? `Jira link “${name}”` : 'saved in the app'}</span>)}</li>}</ul></div>}</>}
            {view?.kind === 'single' && <SinglePersonPanel model={model} single={single} onPerson={selectPerson} onSearch={search} onOpen={openTickets} />}
            {view?.kind === 'setup' && <SetupPanel setup={setup} onAction={setupAction} onOpen={openTickets} />}
            {view?.kind === 'teams' && (
              <>
                <p className="jtm-status-line" role="status" aria-live="polite" data-testid="team-status">{teamStatus}</p>
                <TeamEditor model={model} onSave={saveTeams} focusId={view.focusId ?? null} busy={teamBusy} />
              </>
            )}
            {view?.kind === 'key' && <><ul className="jtm-key-list"><li>Arrow points from the person waiting to the person they wait on.</li><li>Red arrow: the blocking task is blocked or overdue.</li><li>Green check: another person has worked on the blocking task.</li><li>Amber 1: only one person has worked on the blocking task.</li><li>Larger person nodes indicate higher coverage risk.</li><li>Dotted green line: someone has worked on the selected person's work, or on earlier work it builds on.</li><li>Links recorded in My work or in Jira (builds on, follows up on, replaces, fixes) count as context. “Related to” is used by search only. None of them adds an arrow.</li><li>In absence simulation, rings indicate people left waiting or people with context.</li></ul>{teams.length > 0 && <><h3>Team connections</h3><ul>{teams.map((t) => <li key={t.id}><Keys keys={t.keys} title={t.sentence} onOpen={openTickets}>{t.sentence}</Keys></li>)}</ul></>}</>}
          </Drawer>
        </div>
        </>}
      </main>
    </div>
  );
}
