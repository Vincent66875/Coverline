# Sandbox-only: headless Chromium checks of the Forge page with a mocked @forge/bridge (.check-forge/).
import functools, http.server, os, re, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(__file__), '..', '.check-forge')
OUT = os.path.join(os.path.dirname(__file__), '..', 'screenshots')
os.makedirs(OUT, exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f'http://127.0.0.1:{srv.server_address[1]}/index.html'
results = []
def check(name, cond, detail=''):
    results.append((name, bool(cond), detail))

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/opt/pw-browsers/chromium-1243/chrome-linux64/chrome', args=['--no-sandbox', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--disable-features=OptimizationHints,AutofillServerCommunication,Translate'])
    page = browser.new_page(viewport={'width': 1400, 'height': 950})
    errors = []
    page.on('pageerror', lambda e: errors.append(f'pageerror: {e}'))
    page.on('console', lambda m: errors.append(f'console.{m.type}: {m.text}') if m.type in ('error', 'warning') else None)
    q = lambda s: page.locator(s).count()
    status = lambda: page.locator('[data-testid=mywork-status]').inner_text()
    lines = lambda: sorted(page.evaluate("() => [...document.querySelectorAll('[data-line]')].map(e => e.dataset.line)"))
    calls = lambda: page.evaluate("() => window.__mock.calls.map(c => c.method + ' ' + c.path)")
    invokes = lambda: page.evaluate("() => window.__mock.invokes.map(i => i.fn)")
    def draw(a_key, b_key):
        a = page.locator(f'[data-card="{a_key}"]').bounding_box(); t = page.locator(f'[data-card="{b_key}"]').bounding_box()
        page.mouse.move(a['x'] + a['width'] / 2, a['y'] + a['height'] / 2); page.mouse.down()
        page.mouse.move(a['x'] + a['width'] / 2 + 20, a['y'] + a['height'] / 2 + 5, steps=3)
        page.mouse.move(t['x'] + t['width'] / 2, t['y'] + t['height'] / 2, steps=8); page.mouse.up()

    # ---------------- load + map ----------------
    page.goto(BASE + '?project=DES&as=u-mia')
    seen_loading = page.locator('[data-testid=loading]').count() == 1 or True
    page.wait_for_selector('[data-testid=people-graph]', timeout=15000)
    names = sorted(page.evaluate("() => [...document.querySelectorAll('[data-node]')].map(n => n.querySelector('.jtm-node-name').textContent.replace(' · out',''))"))
    check('load: map built from Jira data (project + linked issues)', {'Mia', 'Noah', 'Ivy', 'Ken', 'Wen', 'Yui', 'Lea'} <= set(names), names)
    check('load: Ken→Mia, Wen→Mia, Yui→Mia arrows', all(q(f'[data-edge="{e}"]') == 1 for e in ['u-ken>u-mia', 'u-wen>u-mia', 'u-yui>u-mia']))
    cs = calls()
    check('load: uses POST /rest/api/3/search/jql, never the retired /search', any(c.startswith('POST /rest/api/3/search/jql') for c in cs) and not any(c.split('?')[0].endswith('/rest/api/3/search') for c in cs))
    check('load: read links saved in the app + dismissed', {'getAppLinks', 'getDismissed'} <= set(invokes()))
    page.get_by_role('button', name='Data & coverage').click()
    notes = page.locator('[data-testid=data-notes]').inner_text()
    check('data notes: scope, team source, link coverage', '9 issues from DES' in notes and 'Atlassian Team field' in notes and 'builds on → saved in the app' in notes and 'is related to → Jira link “Relates”' in notes, notes)
    page.keyboard.press('Escape')
    page.screenshot(path=f'{OUT}/forge-map.png', full_page=True)

    # ---------------- My work: app-storage link (no Jira type) ----------------
    page.locator('[data-tab=mywork]').click(); page.wait_for_selector('[data-card]')
    check('My work opens on the signed-in user', page.locator('.jtm-person-head h1').inner_text() == 'Mia')
    draw('DES-3', 'DES-7'); page.get_by_role('button', name='Add link').click()
    page.wait_for_function("() => document.querySelector('[data-testid=mywork-status]').textContent.startsWith('Linked')")
    check('no Jira type: link saved in the app', 'saved in the app' in status() and 'addAppLink' in invokes() and 'DES-3~builds_on~DES-7' in lines(), status())
    page.locator('[data-line="DES-3~builds_on~DES-7"] rect').click()
    page.locator('[data-testid=link-panel]').get_by_role('button', name=re.compile('Remove link')).click()
    page.wait_for_function("() => document.querySelector('[data-testid=mywork-status]').textContent.startsWith('Removed')")
    check('remove app link', 'removeAppLink' in invokes() and 'DES-3~builds_on~DES-7' not in lines())
    page.locator('[data-ghost="DES-2?DES-6"] circle').click()
    page.get_by_role('button', name='Dismiss suggestion').click()
    check('dismiss saved per user', 'setDismissed' in invokes() and q('[data-ghost]') == 0)

    # ---------------- My work: real Jira link ----------------
    page.goto(BASE + '?project=DES&as=u-mia&types=builds_on')
    page.wait_for_selector('[data-testid=people-graph]', timeout=15000)
    page.locator('[data-tab=mywork]').click(); page.wait_for_selector('[data-card]')
    draw('DES-2', 'DES-6'); page.get_by_role('button', name='Add link').click()
    page.wait_for_function("() => document.querySelector('[data-testid=mywork-status]').textContent.startsWith('Linked')")
    check('Jira type exists: real Jira issue link created', '(Jira link)' in status() and any(c == 'POST /rest/api/3/issueLink' for c in calls()) and 'DES-2~builds_on~DES-6' in lines(), status())
    jira_link = page.evaluate("() => window.__mock.jira.issues.get('DES-2').fields.issuelinks.find(l => l.type.name === 'Builds on')")
    check('Jira link has the right direction (DES-2 builds on DES-6)', jira_link and jira_link.get('outwardIssue', {}).get('key') == 'DES-6', jira_link)
    page.locator('[data-tab=map]').click()
    check('→ map: Jira link gives context (badge green)', 'jtm-badge--green' in page.get_attribute('[data-badge="u-ken>u-mia"]', 'class'))
    page.locator('[data-tab=mywork]').click(); page.wait_for_selector('[data-card]')
    page.locator('[data-line="DES-2~builds_on~DES-6"] rect').click()
    lp = page.locator('[data-testid=link-panel]')
    check('Jira links are editable in Forge (relation select shown)', lp.locator('select').count() == 1 and 'Jira link' in lp.inner_text())
    lp.locator('select').select_option('fixes')
    page.wait_for_function("() => document.querySelector('[data-testid=mywork-status]').textContent.startsWith('Changed')")
    check('change to a type the site lacks: Jira link deleted, saved in the app', any(c.startswith('DELETE /rest/api/3/issueLink/') for c in calls()) and 'DES-2~fixes~DES-6' in lines() and 'saved in the app' in status(), (status(), lines()))
    page.screenshot(path=f'{OUT}/forge-mywork.png', full_page=True)

    # ---------------- states ----------------
    page.goto(BASE + '?fail=search')
    page.wait_for_selector('[data-testid=load-error]', timeout=15000)
    check('error state: permission message + Try again', 'do not have permission' in page.inner_text('[data-testid=load-error]') and page.get_by_role('button', name='Try again').count() == 1)
    page.screenshot(path=f'{OUT}/forge-error.png')
    page.goto(BASE + '?empty=1')
    page.wait_for_selector('[data-testid=empty]', timeout=15000)
    check('empty state', 'No issues to map yet' in page.inner_text('[data-testid=empty]'))
    errors_before = len(errors)
    page.goto(BASE + '?fail=storage')
    page.wait_for_selector('[data-testid=people-graph]', timeout=15000)
    page.get_by_role('button', name='Data & coverage').click()
    check('storage down: page still loads and says so', 'Links saved in the app could not be read' in page.locator('[data-testid=data-notes]').inner_text())
    page.set_viewport_size({'width': 800, 'height': 900})
    page.goto(BASE + '?project=MOB&as=u-xan')
    page.wait_for_selector('[data-testid=people-graph]', timeout=15000)
    page.locator('[data-tab=mywork]').click(); page.wait_for_selector('[data-card]')
    check('narrow frame, other project: Xan board with Jira links', 'MOB-4~builds_on~MOB-9' in lines())
    page.screenshot(path=f'{OUT}/forge-narrow.png', full_page=True)


    # ======================= setup: empty map, banner, checklist =======================
    page.set_viewport_size({'width': 1400, 'height': 950})
    page.goto(BASE + '?project=MOB&as=u-xan&nolinks=1&flagged=MOB-2')
    page.wait_for_selector('[data-testid=people-graph]', timeout=15000)
    check('no links: empty-map notice explains and offers what works', q('[data-testid=empty-map]') == 1 and q('[data-edge]') == 0 and 'No recorded dependencies yet' in page.inner_text('[data-testid=empty-map]'))
    check('banner shows the number of setup items to do', 'would make this map more useful' in page.inner_text('[data-testid=setup-banner]'))
    page.get_by_role('button', name=re.compile(r'^Work only one person has worked on')).click()
    check('notice → one-person work list (no links needed)', q('[data-testid=single-person]') == 1 and q('[data-single]') >= 3)
    page.keyboard.press('Escape')
    page.get_by_test_id('open-setup').click()
    st = page.evaluate("() => Object.fromEntries([...document.querySelectorAll('[data-check]')].map(e => [e.dataset.check, e.className.match(/jtm-check--(\\w+)/)[1]]))")
    check('setup: teams/dependencies/flagged to do; one-person + link types info', st.get('teams') == 'todo' and st.get('dependencies') == 'todo' and st.get('flagged') == 'todo' and st.get('single') == 'info' and st.get('linktypes') == 'info', st)
    check('setup: link type table lists the missing types', 'Builds on' in page.inner_text('[data-testid=linktype-table]') and 'is fixed by' in page.inner_text('[data-testid=linktype-table]'))
    page.locator('[data-check=flagged]').get_by_role('button', name='Show tasks').click()
    check('setup: flagged with no blocker → the tasks', page.locator('[data-testid=ticket-list] li code').all_text_contents() == ['MOB-2'])
    page.locator('.jtm-back').click()
    page.locator('[data-check=teams] [data-action=teams]').click()
    check('setup: Edit teams opens the editor', q('[data-testid=team-editor]') == 1)
    page.keyboard.press('Escape')
    page.get_by_role('button', name='Dismiss').click()
    check('banner dismiss: hidden and saved per user', q('[data-testid=setup-banner]') == 0 and 'setPrefs' in invokes())

    # ======================= Flagged =======================
    page.goto(BASE + '?project=DES&as=u-mia&flagged=DES-3')
    page.wait_for_selector('[data-testid=people-graph]', timeout=15000)
    sr = page.locator('[data-testid=sr-edges]').text_content()
    check('flagged blocker: red arrow and "flagged" in the sentence', 'jtm-edge--red' in page.get_attribute('[data-edge="u-wen>u-mia"]', 'class') and "'Icon set' [DES-3] (In Progress, flagged" in sr)
    page.get_by_role('button', name='Data & coverage').click()
    check('data notes: flagged counts as blocked', 'Flagged work counts as blocked.' in page.inner_text('[data-testid=data-notes]'))

    # ======================= team editor =======================
    page.get_by_role('button', name='Edit teams').click()
    check('editor: roster lists everyone with source', q('[data-roster]') >= 9 and 'main project' in page.inner_text('[data-roster=u-ivy]'))
    page.get_by_label('Team for Ivy').select_option('__new')
    page.get_by_label('New team for Ivy').fill('Checkout squad'); page.keyboard.press('Enter')
    page.wait_for_function("() => document.querySelector('[data-testid=team-status]').textContent.startsWith('Saved')")
    cols = page.evaluate("() => [...document.querySelectorAll('.jtm-col-title')].map(t => t.textContent)")
    check('new team: saved, map gets a column for it', 'Checkout squad' in cols and 'set here' in page.inner_text('[data-roster=u-ivy]') and 'setTeams' in invokes(), cols)
    page.locator('[data-team=Mobile]').get_by_role('button', name='Rename Mobile').click()
    page.get_by_label('New name for Mobile').fill('Wallet'); page.keyboard.press('Enter')
    page.wait_for_function("() => [...document.querySelectorAll('.jtm-col-title')].some(t => t.textContent === 'Wallet')")
    check('rename: every member moves', all(page.get_by_label(f'Team for {n}').input_value() == 'Wallet' for n in ['Wen', 'Xan', 'Yui']))
    page.get_by_label('Team for Ivy').select_option('__suggested')
    page.wait_for_function("() => !document.querySelector('[data-roster=u-ivy]').textContent.includes('set here')")
    check('back to suggested: Ivy returns to Design', page.get_by_label('Team for Ivy').input_value() == 'Design')
    page.get_by_test_id('accept-suggested').click()
    page.wait_for_function("() => document.querySelector('[data-testid=team-status]').textContent.startsWith('Saved')")
    check('keep all suggested: nobody guessed any more', 'main project' not in page.inner_text('[data-testid=team-editor] tbody'))
    page.keyboard.press('Escape')
    page.locator('[data-node=u-noah]').click()
    page.locator('[data-testid=team-line]').get_by_role('button', name='Change').click()
    try: page.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Team for Noah'", timeout=3000)
    except Exception: pass
    check('person details: Change opens the editor on that person', 'jtm-roster--focus' in (page.get_attribute('[data-roster=u-noah]', 'class') or '') and page.evaluate("() => document.activeElement.getAttribute('aria-label')") == 'Team for Noah')
    page.screenshot(path=f'{OUT}/forge-teams.png', full_page=True)
    page.keyboard.press('Escape')

    # ======================= one-person work =======================
    page.get_by_test_id('open-single').click()
    mia = page.locator('[data-testid=single-person] [data-person=u-mia]').inner_text()
    check('one-person work: Mia\'s DES-2 with 3 tasks waiting', 'DES-2' in mia and '3 tasks waiting' in mia, mia)
    page.locator('[data-single=DES-2]').get_by_role('button', name='Who has worked near this?').click()
    check('one-person work → who has worked near this', 'Who has worked on DES-2' in page.inner_text('#jtm-drawer-title'))
    page.screenshot(path=f'{OUT}/forge-single.png', full_page=True)

    check('no console errors or warnings', not errors, errors)
    browser.close()
srv.shutdown()
w = max(len(n) for n, _, _ in results)
fails = 0
for n, ok, d in results:
    fails += not ok
    print(f"{'PASS' if ok else 'FAIL'}  {n.ljust(w)}  {'' if ok else d}")
print(f'\n{len(results) - fails}/{len(results)} passed')
sys.exit(1 if fails else 0)
