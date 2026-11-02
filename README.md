# Team map for Jira Cloud (Forge)

A project page in Jira that shows where work depends on a single person:

- **Team map**: people as nodes, "waits on" arrows from Jira blocks/depends links, coverage risk, absence simulation, "who has worked on this?" search.
- **My work**: one person's tasks as cards in time columns (Now → weeks → months). Drag a line between two cards and pick how they relate: builds on, follows up on, replaces, fixes, or is related to.

It reads Jira as the signed-in user and needs no setup to show the map.

## Run it on your Jira site

You need Node.js 22 or newer, a Jira Cloud site where you can install apps (a free developer site works), and the Forge CLI.

```bash
npm install -g @forge/cli          # once
forge login                        # once; uses an Atlassian API token

cd jira-team-map-forge
npm install                        # resolver dependencies
npm --prefix static/team-map install   # page dependencies
forge register                     # creates your app and writes its id into manifest.yml
npm run build:ui                   # builds the page into static/team-map/build
forge deploy
forge install                      # pick Jira and your site
```

Open any project, then **Team map** in the project's sidebar (under Apps, depending on the project type).

After changing the page: `npm run build:ui && forge deploy`. After changing scopes in `manifest.yml`: `forge deploy && forge install --upgrade`.

### Optional: let My work save real Jira links

Links drawn in My work become real Jira issue links when the site has a link type for that relation. "Relates" exists by default. For the others, a Jira admin can add link types (Jira settings → Issues → Issue linking):

| Name | Outward description | Inward description |
|---|---|---|
| Builds on | builds on | is built on by |
| Follows up | follows up on | is followed up by |
| Replaces | replaces | is replaced by |
| Fixes | fixes | is fixed by |

Without them, those links are saved inside the app (Forge storage) and marked "saved in the app". **Data & coverage** shows which relations go where on your site.

## What it reads

- The project's issues: open, or resolved in the last 12 months.
- One hop of linked issues in other projects, so cross-team waits show up, plus missing parent epics.
- Full assignee history where search returned only part (the search API embeds at most 20 history entries per issue).
- The Atlassian **Team** field for team columns when the site has it; otherwise each person's most common project.
- Issue link types, to know which links it can write.

Limits: up to 2,000 project issues, up to 300 issues with long histories. **Data & coverage** reports anything it could not read: linked issues in projects you can't browse, history it could not complete, missing storage.

## Permissions (manifest.yml)

| Scope | Why |
|---|---|
| `read:jira-work` | search issues, read history and link types |
| `write:jira-work` | create and delete the issue links you draw in My work |
| `read:jira-user` | names of assignees, reporters and history authors |
| `storage:app` | links with no Jira link type, dismissed suggestions |

`content.styles: unsafe-inline` is there because React sets a few inline styles (map size, popup position).

## Project layout

```
manifest.yml                  Forge app: project page + resolver
src/index.js                  resolver: Forge storage only
src/storage.js                storage logic (links, dismissed suggestions)
static/team-map/              the page (React + Vite, Custom UI)
  src/ForgeRoot.jsx           loads the project, then renders App
  src/jira/request.js         requestJira wrapper with retry on 429
  src/jira/loadData.js        reads issues, links, history, Team field, link types
  src/jira/linkStore.js       saves links: Jira link, or app storage
  src/analysis/, graph/, components/, App.jsx   same code as the local MVP
test/                         node tests with a mock Jira (npm test)
scripts/                      sandbox-only browser checks (not needed to run the app)
```

## Tests

```bash
npm test
```

This runs 14 Forge tests against an in-memory Jira built from the MVP's demo data (paging, linked issues, history, teams, link direction, storage), plus the MVP's 82 analysis tests on the same code.
