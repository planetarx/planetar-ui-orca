# planetar-ui-orca Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sibling of planetar-ui that shows where whales probably are around Victoria and exactly why, inferred from whale-watch boat behaviour in AIS, with drill-down on every source.

**Architecture:** Three parts on bb's planetar bus:
1. **planetar-ais** gains an `orca` operating area (Victoria, Race Rocks, Haro Strait, San Juans). It runs as a second pm2 process that records to its own directory.
2. **An inference service** (`service/`, Node ESM, zero dependencies) subscribes to `vessel.ais.position`. It tracks each listed whale-watch boat's behaviour, clusters watching boats into whale estimates, publishes `orca.evidence` and `orca.estimate` envelopes, and serves a snapshot over HTTP.
3. **The UI** is a trimmed copy of planetar-ui's shell (bridge, broker client, resizable panes, MapLibre) re-laid out as Sources | source stream | map + inspector.

**Tech Stack:** React 19, Vite 8, TypeScript 6, zustand 5, maplibre-gl 5, react-resizable-panels 4, Playwright (UI). Node ≥ 22 with `node:test` (service). Everything is pinned to the versions in planetar-ui's `package.json`.

**Spec:** `docs/superpowers/specs/2026-10-31-planetar-ui-orca-design.md` (copied into the repo in Task 1 from `/tmp/claude-1026/-home-sness-github-planetarx/1ac522af-6072-4b1d-a675-192c487bdf3a/scratchpad/orca/`).

## Global Constraints

- Repo `~/github/planetarx/planetar-ui-orca`, remote `git@github.com:planetarx/planetar-ui-orca.git`, license GPL-3.0-or-later. Commit inside it, never at the workspace top level.
- **Ports:** Vite dev **:5290** (`strictPort`), bridge **ws://127.0.0.1:9400**, inference service HTTP **:9410**. Never bind 12001–12003 or start a second broker.
- planetar-ui is not modified. planetar-acoustic is not modified. Nothing deploys to planetar.ca.
- **Labels:** an estimate's label is `"whales"`. `species` is `null` unless a source states it. The UI never says "orca" for a boat-only estimate.
- Anything simulated carries `simulated: true` and shows a visible **SIMULATED** tag in the UI. A source that isn't connected shows "not connected", never placeholder data.
- All inference thresholds live in one file, `service/config/inference.json`. No magic numbers in the inference code.
- No secrets in the repo. The aisstream key comes from the shell's `AISTREAM_KEY`.
- Playwright tests use bundled Chromium only (no CDP attach to the founder's Chrome).
- TypeScript settings carry over from planetar-ui: `erasableSyntaxOnly` and `verbatimModuleSyntax` (no enums, `import type` for types), and `@/` → `src/`.
- Vessels and whales only; never profile people.

## Review Focus

1. **A whale-watch boat tied up in harbour all day** must never count as watching. The test is in Task 2.
2. **A single boat idling at Race Rocks** (photographing the lighthouse or sea lions) must not create an estimate alone (`minBoats` = 2), but its evidence still appears in the boat stream marked "1 boat, below minimum". The tests are in Tasks 2 and 3.
3. **An AIS gap mid-encounter** (a boat silent for 10 minutes, then reporting from the same spot) must not end the estimate or reset the boat's loiter clock while the gap is under `staleMin`. The test is in Task 2.
4. **Reloading the page mid-encounter** must show the current estimates immediately, from the service snapshot, not empty until the next update. The test is in Task 9.
5. **With the inference service down**, the UI must say so ("inference offline") and not keep showing old estimates as if they were live. The test is in Task 9.

---

## File structure

```
planetar-ui-orca/
  package.json, vite.config.ts, tsconfig*.json, eslint.config.js, index.html,
  playwright.config.ts, LICENSE, .gitignore, README.md, CLAUDE.md
  docs/superpowers/specs/…design.md, docs/superpowers/plans/…md, docs/mockups/*.html
  docs/CONTRACT.md                 orca.estimate / orca.evidence payloads (SSOT)
  bridge/server.mjs, bridge/zmesg.mjs   copied from planetar-ui (port 9400, no synth)
  service/
    config/inference.json          every threshold + confidence weights
    data/whale-watch-vessels.json  curated MMSIs {mmsi,name,operator,verified}
    data/harbours.json             named polygons [[lat,lon],…]
    geo.mjs                        distanceM, pointInPolygon, centroid
    tracker.mjs                    per-boat behaviour state machine
    estimator.mjs                  clusters watching boats → estimates
    sim.mjs                        scenario → timed AIS positions (+ truth)
    scenarios/race-rocks.json      the reference simulated encounter
    bus.mjs                        broker TCP sub/pub (uses bridge/zmesg.mjs)
    index.mjs                      wires bus → tracker → estimator → bus + HTTP
    simulate.mjs                   CLI: replay a scenario onto the bus
    test/*.test.mjs
  src/
    main.tsx, App.tsx, App.css, index.css
    lib/broker.ts, lib/topic.ts, lib/uuidv7.ts   copied from planetar-ui
    lib/service.ts                 HTTP snapshot client
    types/orca.ts                  TS mirror of docs/CONTRACT.md
    data/sources.ts                the five sources (id, label, colour, connected)
    data/hydrophones.ts            Orcasound + ONC site list with listen URLs
    store/layoutStore.ts, store/estimatesStore.ts, store/evidenceStore.ts, store/boatsStore.ts
    hooks/useOrcaStreams.ts        ref-counted bus subscription (planetar-ui pattern)
    components/SourceList.tsx, SourceStream.tsx, MapPane.tsx, Inspector.tsx, KeystrokeHelp.tsx
  tests/fixtures.ts, tests/layout.spec.ts, tests/estimates.spec.ts
```

## Wire contract (Task 1 writes it into `docs/CONTRACT.md` and `src/types/orca.ts`; the service emits the same shapes)

```ts
type SourceId = 'boats' | 'hydrophones' | 'reports' | 'vhf' | 'social';

interface OrcaEvidence {           // topic orca.evidence, schema orca.Evidence.v1
  id: string;                      // uuidv7
  source: SourceId;
  atNs: string;                    // ns since epoch, as a string
  text: string;                    // one human sentence
  counted: boolean;                // did it feed an estimate?
  reason: string | null;           // why not counted, e.g. "in harbour: Inner Harbour"
  estimateId: string | null;
  mmsi: number | null; lat: number | null; lon: number | null;
  raw: { kind: 'ais-track'; mmsi: number; fromNs: string; toNs: string }
     | { kind: 'url'; url: string } | null;
  simulated: boolean;
}

interface OrcaEstimate {
  id: string; label: 'whales'; species: string | null;
  lat: number; lon: number; radiusM: number;
  confidence: number;              // 0..1
  status: 'active' | 'ended';
  firstNs: string; updatedNs: string;
  boats: number[]; operators: string[];
  evidenceIds: string[];
  simulated: boolean;
}
// topic orca.estimate, schema orca.Estimate.v1, payload { event: 'upsert' | 'ended', estimate: OrcaEstimate }
// HTTP GET :9410/snapshot → { estimates: OrcaEstimate[], evidence: OrcaEvidence[] (last 500), startedNs: string }
// HTTP GET :9410/health → { ok: true }
```

---

### Task 1: Repo scaffold from the planetar-ui shell

**Files:**
- Create: everything at the repo root listed above. Also `bridge/` (copied), `src/lib/{broker,topic,uuidv7}.ts` (copied), `src/types/orca.ts`, `docs/CONTRACT.md`, `src/main.tsx`, and a placeholder `src/App.tsx` that renders `<h1>planetar-ui-orca</h1>`.
- Copy in: the spec, this plan, and `layout.html` / `layout-v2.html` (from the scratchpad `orca/.superpowers/brainstorm/2667024-1793456742/content/`) to `docs/mockups/`.
- Test: `tests/fixtures.ts`, `tests/layout.spec.ts`

**Interfaces:**
- Produces: `src/types/orca.ts` exporting `SourceId`, `OrcaEvidence`, `OrcaEstimate`, `EstimateEvent` (`{event:'upsert'|'ended', estimate}`), `Snapshot` (`{estimates, evidence, startedNs}`). `src/lib/broker.ts`, unchanged from planetar-ui except that the default `VITE_WS_URL` is `ws://127.0.0.1:9400`. Bridge env `BRIDGE_PORT` defaults to `9400`, with `BRIDGE_SYNTHETIC` defaulting to `0`.

- [ ] **Step 1:** `mkdir ~/github/planetarx/planetar-ui-orca && git init`. Copy from planetar-ui:
  - `package.json`: rename it to `planetar-ui-orca`. `dev` becomes `concurrently -n vite,bridge,service "vite" "node bridge/server.mjs" "node service/index.mjs"`. Add `"test:service": "node --test service/test/"`. Drop the `synth` scripts.
  - Configs: `vite.config.ts` with port 5290, `tsconfig*.json`, `eslint.config.js`, `index.html` with title `planetar-ui-orca`, `.gitignore` plus `service/state/`, `LICENSE`.
  - `bridge/server.mjs` and `bridge/zmesg.mjs` (change only the default port and synthetic default).
  - `src/lib/broker.ts`, `src/lib/topic.ts`, `src/lib/uuidv7.ts`, `src/index.css`.

  Then `npm install`.
- [ ] **Step 2:** Write `tests/fixtures.ts`, which exports `test` and `expect`, launches bundled Chromium, and clears localStorage key `planetar-ui-orca-layout` before each test. Write `tests/layout.spec.ts::loads the shell`: go to `/`, then `expect(page).toHaveTitle('planetar-ui-orca')`, with no console errors other than WebSocket ones. Set `playwright.config.ts` `baseURL` to `http://127.0.0.1:5290`.
- [ ] **Step 3:** Run `npx playwright test tests/layout.spec.ts`. Expected: FAIL until `index.html` and `App.tsx` exist, then PASS.
- [ ] **Step 4:** Write `docs/CONTRACT.md` and `src/types/orca.ts` from the contract above. Write `README.md` (what it is, ports, `npm run dev`, `npm run test:service`, `npm test`) and `CLAUDE.md` (commands, ports, constraints from this plan's Global Constraints, the "SIMULATED" and "not connected" rules). Run `npx tsc -b`. Expected: clean.
- [ ] **Step 5:** Commit `feat: scaffold planetar-ui-orca from the planetar-ui shell`. Create the GitHub repo with `gh repo create planetarx/planetar-ui-orca --public --source . --push`.

### Task 2: Geometry, config and the per-boat behaviour tracker

**Files:**
- Create: `service/geo.mjs`, `service/config/inference.json`, `service/data/harbours.json`, `service/data/whale-watch-vessels.json`, `service/tracker.mjs`
- Test: `service/test/geo.test.mjs`, `service/test/tracker.test.mjs`

**Interfaces:**
- Produces:
  - `distanceM(a:{lat,lon}, b:{lat,lon}) → number` (haversine).
  - `pointInPolygon(p:{lat,lon}, poly:[lat,lon][]) → boolean`.
  - `centroid(points:{lat,lon}[]) → {lat,lon}`.
  - `loadConfig(path?) → Config`.
  - `class BoatTracker { constructor(config, harbours, vessels); update(pos: AisPosition) → TrackerEvent[]; watching(nowNs: bigint) → WatchingBoat[] }`.
  - `TrackerEvent = { kind: 'transit'|'arrived-slow'|'watching'|'left'|'ignored', mmsi, atNs, lat, lon, text, reason|null, simulated }`.
  - `WatchingBoat = { mmsi, name, operator, lat, lon, sinceNs, lastNs, simulated }`.

`inference.json` (exact starting values; the founder tunes these later):
```json
{ "slowKn": 4, "transitKn": 12, "loiterMin": 5, "loiterRadiusM": 800,
  "staleMin": 15, "minBoats": 2, "clusterRadiusM": 2500,
  "whaleStandoffM": 400, "endAfterMin": 15,
  "confidence": { "perBoat": 0.35, "perExtraOperator": 0.25, "perLoiterMin": 0.03, "loiterCapMin": 30 } }
```
`harbours.json` holds named polygons for Victoria Inner Harbour (incl. Fisherman's Wharf), Oak Bay Marina, Sidney / Port Sidney, Friday Harbor, Roche Harbor, and Port Angeles harbour. Rough polygons drawn from a chart are fine; the comment in `CLAUDE.md` says so.

`whale-watch-vessels.json` starts with the simulated scenario's vessels, `"verified": false` and `"simulated": true`. Real operators' vessels are added by hand later (`verified: true`). Vessels not in this file produce no tracker events.

- [ ] **Step 1: Write failing tests** in `geo.test.mjs`:
  - `distanceM` between Race Rocks (48.2980,-123.5310) and Victoria Inner Harbour (48.4220,-123.3700) is 17,800 m ± 300.
  - `pointInPolygon` returns true for a point inside the Inner Harbour polygon and false for Race Rocks.
- [ ] **Step 2: Write failing tests** in `tracker.test.mjs`, using a helper `feed(tracker, mmsi, points[{lat,lon,sog,tMin}])`:
  - `in harbour all day is never watching`: a listed boat at 0.5 kn inside the Inner Harbour for 8 h. `watching()` is empty, and its events are `ignored` with a reason starting `in harbour:`.
  - `transit then slow loiter becomes watching after loiterMin`: 20 kn for 20 min, then 2 kn within 300 m for 6 min. It becomes `watching` at minute 5 of the loiter, not before.
  - `unlisted vessel produces no events`.
  - `gap under staleMin keeps watching`: the boat is watching, silent for 10 min, then reports again from the same spot. It is still watching and `sinceNs` is unchanged.
  - `gap over staleMin drops the boat`: silent for 16 min, then `watching(now)` excludes it.
  - `speeding away after watching emits left`: watching, then 18 kn. One `left` event, and it is no longer in `watching()`.
- [ ] **Step 3:** Run `node --test service/test/`. Expected: FAIL (modules missing).
- [ ] **Step 4:** Implement `geo.mjs`, `loadConfig`, and `BoatTracker`. The tracker keeps per-MMSI state `{phase:'transit'|'slow'|'watching'|'harbour', slowSinceNs, anchor:{lat,lon}, lastNs}`. "Slow" means `sog < slowKn`, outside every harbour polygon, staying within `loiterRadiusM` of the anchor (the first slow fix). `watching` fires once slow has lasted `loiterMin`. Moving outside the radius while slow re-anchors and restarts the clock.
- [ ] **Step 5:** Run `node --test service/test/`. Expected: all PASS.
- [ ] **Step 6:** Commit `feat(service): per-boat whale-watch behaviour tracker`.

### Task 3: Estimator — watching boats → whale estimates

**Files:**
- Create: `service/estimator.mjs`
- Test: `service/test/estimator.test.mjs`

**Interfaces:**
- Consumes: `WatchingBoat[]`, `TrackerEvent`, `Config` (Task 2).
- Produces: `class Estimator { constructor(config); step(watching: WatchingBoat[], nowNs: bigint) → { upserts: OrcaEstimate[], ended: OrcaEstimate[] }; attach(evidence: OrcaEvidence) → OrcaEvidence; current() → OrcaEstimate[] }`. `attach` sets `estimateId`, `counted` and `reason` on a boat evidence item from the boat's current cluster, and records the id in that estimate's `evidenceIds`.

Clustering is single-linkage on `clusterRadiusM`. Clusters smaller than `minBoats` produce no estimate, and their boats' evidence gets `reason: "1 boat, below minimum of 2"` (built from the config).

The estimate location is the cluster centroid. `radiusM = max distance from the centroid to any boat + whaleStandoffM`.

Confidence is computed as:
```
s = perBoat*nBoats + perExtraOperator*(nOperators-1) + perLoiterMin*min(loiterCapMin, minutes since the earliest sinceNs)
confidence = 1 - exp(-s)
```

**Stable ids:** a new cluster reuses the id of the previous active estimate that shares the most boats with it. Otherwise it gets a new uuidv7.

**Ending:** an estimate with no cluster for `endAfterMin` is emitted once in `ended` with `status: 'ended'`.

`simulated` is true if any of its boats is simulated.

- [ ] **Step 1: Write failing tests:**
  - `two boats 600 m apart make one estimate`: label `'whales'`, `species === null`, `radiusM` between 700 and 1100, `0 < confidence < 1`.
  - `one boat makes no estimate and attach marks it below minimum`.
  - `more boats and operators raise confidence`: 4 boats and 3 operators score above 2 boats and 1 operator.
  - `id is stable as boats join and leave`: steps with boat sets {A,B} → {A,B,C} → {B,C} keep the same id.
  - `estimate ends endAfterMin after the last cluster`: one `ended` event at minute 15, none at minute 14, and none repeated at minute 16.
  - `two clusters 10 km apart make two estimates`.
- [ ] **Step 2:** Run `node --test service/test/estimator.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `Estimator`.
- [ ] **Step 4:** Run `node --test service/test/`. Expected: all PASS.
- [ ] **Step 5:** Commit `feat(service): cluster watching boats into whale estimates`.

### Task 4: Simulated scenario and an end-to-end inference test

**Files:**
- Create: `service/sim.mjs`, `service/scenarios/race-rocks.json`
- Test: `service/test/scenario.test.mjs`

**Interfaces:**
- Produces: `scenarioPositions(scenario, startNs: bigint) → Array<{atNs: bigint, pos: AisPosition}>`, sorted by time. Each position is shaped like planetar-ais's `vessel.ais.position` payload (`mmsi, name, lat, lon, sog, cog, lastSeenNs`), plus `simulated: true` and `serverId: 'orca'`. Also `scenarioTruth(scenario, startNs) → {whale: Array<{atNs, lat, lon}>}`.

`race-rocks.json` describes a 90-minute scene:
- **Whales:** start at 48.2900,-123.5600 and travel east at 3 kn.
- **Four listed boats** from 3 operators. Mmsis are 999000001–999000004 (a reserved-looking range, never a real vessel), all `simulated` and listed in `whale-watch-vessels.json`. Each leaves the Inner Harbour at minutes 0–10 at 20 kn, reaches the whales, holds 400–700 m off at ≤ 3 kn for 40 min, then returns at 20 kn.
- **One listed boat** (999000005) idles in the Inner Harbour the whole time.
- **One unlisted ferry** (999000006) transits Haro Strait at 15 kn.

Positions are emitted every 30 s per vessel, with ±50 m deterministic jitter (seeded).

- [ ] **Step 1: Write the failing test** `race rocks scenario yields one whale estimate near the truth`. Run all positions through `BoatTracker`, then `Estimator`, calling `step` every simulated minute. Assert:
  - exactly one estimate id is ever created
  - at minute 45 its centre is within 1,000 m of the true whale position, and the truth lies inside `radiusM`
  - confidence at minute 45 is > 0.8
  - it ends between minute 70 and 90
  - 999000005 and 999000006 never appear in `boats`
  - the estimate is `simulated: true`
- [ ] **Step 2:** Run `node --test service/test/scenario.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement `sim.mjs` and write the scenario file.
- [ ] **Step 4:** Run `node --test service/test/`. Expected: all PASS. If the 1,000 m assertion fails because the boats sit on one side of the whales, fix the scenario's geometry, not the assertion.
- [ ] **Step 5:** Commit `feat(service): simulated Race Rocks encounter + end-to-end inference test`.

### Task 5: The inference service process (bus + HTTP)

**Files:**
- Create: `service/bus.mjs`, `service/index.mjs`, `service/simulate.mjs`
- Test: `service/test/service.test.mjs`

**Interfaces:**
- Consumes: `encodeEnvelope`, `decodeEnvelope`, `TCPFrameParser`, `frameTCP` from `bridge/zmesg.mjs`, plus Tasks 2–4.
- Produces:
  - `createInferenceService({config, harbours, vessels, publish: (topic, schemaName, payload) => void, now: () => bigint}) → { onPosition(pos), tick(), snapshot() }`. This is a pure core; `index.mjs` wires it to `bus.mjs` and a 60 s `tick`.
  - `BrokerLink` in `bus.mjs`: TCP `SUB vessel.ais.position\n` on 12002 and publish on 12001, reconnecting every 2 s, with env `BROKER_HOST` / `BROKER_PUB_PORT` / `BROKER_SUB_PORT`.
  - HTTP on `ORCA_SERVICE_PORT` (default 9410): `GET /snapshot`, `GET /health`, with `Access-Control-Allow-Origin: *`.

The core turns every non-ignored tracker event into an `OrcaEvidence` (`source: 'boats'`, `raw: {kind:'ais-track', mmsi, fromNs, toNs}`), passes it through `estimator.attach`, and publishes it on `orca.evidence`. Ignored events are published too, with `counted: false` and their reason, so the stream shows what was ignored and why. For harbour idling, repeated `ignored` events are rate-limited to one per boat per 30 min. `tick()` publishes `orca.estimate` upserts and ends. The snapshot holds active estimates, the last 500 evidence items, and estimates ended in the last 2 h.

`simulate.mjs` (`node service/simulate.mjs service/scenarios/race-rocks.json [--speed 10]`) publishes the scenario's positions to the broker on `vessel.ais.position`, in real time divided by `--speed`.

- [ ] **Step 1: Write failing tests** using the pure core with a fake `publish` and a controllable `now`:
  - `publishes evidence for a harbour idler with counted false`.
  - `replaying race-rocks publishes upserts then one ended on orca.estimate`.
  - `snapshot after minute 45 contains the active estimate and its evidence ids resolve to evidence in the snapshot`.
  - `HTTP /snapshot and /health respond`: start the server on port 0 and fetch both.
- [ ] **Step 2:** Run `node --test service/test/`. Expected: FAIL.
- [ ] **Step 3:** Implement `bus.mjs`, the core, `index.mjs` and `simulate.mjs`.
- [ ] **Step 4:** Run `node --test service/test/`. Expected: all PASS.
- [ ] **Step 5: Live check on bb.** Run `node service/index.mjs` and `node service/simulate.mjs service/scenarios/race-rocks.json --speed 30`, then `curl -s localhost:9410/snapshot | head -c 400`. Expected: one simulated estimate. Stop both.
- [ ] **Step 6:** Commit `feat(service): inference service on the bus with an HTTP snapshot`.

### Task 6: planetar-ais `orca` area, recorded by its own pm2 process

**Files (in `~/github/planetarx/planetar-ais`):**
- Modify: `src/areas.mjs` (add `orca`)
- Test: `test/areas.test.mjs` (create)
- Modify (not a repo): `~/data/dev/pm2/ecosystem.planetar.config.cjs` (add `planetar:ais-orca`)

**Interfaces:**
- Produces: `getArea('orca')` returns `{ name:'orca', serverId:'orca', label:'Orca watch', bbox:{sw:[48.10,-123.80], ne:[48.85,-122.75]}, center:{lat:48.40,lon:-123.30}, fleet:[] }`. Its positions carry `serverId: 'orca'`.

- [ ] **Step 1: Write failing tests** in `test/areas.test.mjs`:
  - `orca area covers Race Rocks, Haro Strait and Friday Harbor`: `insideBBox` is true for (48.298,-123.531), (48.55,-123.20) and (48.535,-123.013).
  - `orca area mock fleet is empty`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL.
- [ ] **Step 3:** Add the area, and make the mock source tolerate an empty fleet if it doesn't already.
- [ ] **Step 4:** Run `npm test`. Expected: all PASS. Commit `feat: orca operating area (Victoria, Haro Strait, San Juans)` and push.
- [ ] **Step 5:** Add the pm2 app `planetar:ais-orca`, a copy of `planetar:ais` with `OP: 'orca'` and `AIS_RECORD_DIR: \`${REPOS}/planetar-ais/data/ais-orca\``. Then `pm2 start ecosystem.planetar.config.cjs --only planetar:ais-orca` and `pm2 save`.
- [ ] **Step 6:** Verify. After 2 minutes, `pm2 logs planetar:ais-orca --nostream` shows `source=aisstream`, and `data/ais-orca/` has a growing file. Also check that `planetar:ais`'s own file is still growing: aisstream may refuse two connections on one key. If it does, stop `planetar:ais-orca` (`pm2 delete planetar:ais-orca`, `pm2 save`) and report back instead of working around it.
- [ ] **Step 7:** Update the workspace `CLAUDE.md` process-ownership line to mention `planetar:ais-orca`.

### Task 7: UI shell — three collapsible panes

**Files:**
- Create: `src/store/layoutStore.ts`, `src/App.tsx` (replace the placeholder), `src/App.css`, `src/components/KeystrokeHelp.tsx`, `src/data/sources.ts`, stub `SourceList`, `SourceStream`, `MapPane` and `Inspector` components (each renders its title only)
- Test: `tests/layout.spec.ts`

**Interfaces:**
- Produces:
  - `useLayoutStore`, persisted to `planetar-ui-orca-layout`, with `{ visible: {sources: boolean, stream: boolean}, widths: {sources: number, stream: number}, selection: {kind:'source', id: SourceId} | {kind:'estimate', id: string} | {kind:'boat', mmsi: number}, showHelp }` and the actions `toggle(pane)`, `setWidth(pane, pct)`, `select(sel)`, `resetLayout()`, `toggleHelp()`.
  - The default selection is `{kind:'source', id:'boats'}`.
  - `SOURCES: {id: SourceId, label, colour, connected: boolean}[]`: boats `#4ade80` connected, hydrophones `#60a5fa` connected (sites only), reports `#facc15` not connected, vhf `#a78bfa` not connected, social `#f472b6` not connected.

The layout is `Group[sources | stream | right]` with `react-resizable-panels`, following planetar-ui's `App.tsx` rule: key the Group only on the set of visible panes, so the map canvas isn't remounted. The right panel is a vertical Group of `MapPane` over `Inspector`.

Each left pane has a « button in its header (`aria-label="Collapse sources"` / `"Collapse stream"`). When collapsed, it shows a 14-px strip with the vertical text "SOURCES »" / "STREAM »" that expands it on click.

Keys: `Ctrl+Shift+S` toggles sources, `Ctrl+Shift+C` toggles the stream, `Ctrl+Shift+0` resets, `Ctrl+Shift+/` opens help, and `Esc` closes help.

- [ ] **Step 1: Write failing Playwright tests:**
  - `three panes visible by default`.
  - `collapse handles hide and restore each left pane`: click « Sources, and `.pane-sources` is hidden while the strip is visible. Click the strip, and it's restored. Same for the stream.
  - `keyboard shortcuts toggle panes`.
  - `collapsed state survives reload`.
  - `map stays mounted when a pane collapses`: tag the `.maplibregl-canvas` element via `evaluate`, collapse the sources pane, and the same element is still attached. (This runs once Task 9's map exists; in this task the stub `MapPane` renders a `<canvas class="maplibregl-canvas">` so the test is real now.)
- [ ] **Step 2:** Run `npx playwright test tests/layout.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement the shell. Copy planetar-ui's `.resize-handle`, pane header and colour tokens from its `App.css` and `index.css`.
- [ ] **Step 4:** Run `npx playwright test tests/layout.spec.ts` and `npx tsc -b`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(ui): sources | stream | map shell with collapsible panes`.

### Task 8: Sources list and the source stream

**Files:**
- Create: `src/store/evidenceStore.ts`, `src/store/estimatesStore.ts`, `src/lib/service.ts`, `src/hooks/useOrcaStreams.ts`, `src/data/hydrophones.ts`
- Modify: `src/components/SourceList.tsx`, `src/components/SourceStream.tsx`
- Test: `tests/estimates.spec.ts`

**Interfaces:**
- Consumes: `OrcaEvidence`, `OrcaEstimate` (Task 1), `useLayoutStore.select` (Task 7).
- Produces:
  - `useEvidenceStore`: `{ bySource: Record<SourceId, OrcaEvidence[]> (newest first, cap 500), byId: Map<string, OrcaEvidence>, ingest(e), ingestMany(es) }`.
  - `useEstimatesStore`: `{ byId: Record<string, OrcaEstimate>, serviceStatus: 'connecting'|'online'|'offline', applyEvent(ev: EstimateEvent), loadSnapshot(s), setStatus(s) }`.
  - `fetchSnapshot(): Promise<Snapshot>` from `VITE_ORCA_SERVICE_URL` (default `http://127.0.0.1:9410`).
  - `useOrcaStreams()`: a ref-counted subscription to `orca.evidence` and `orca.estimate`, which also polls `/health` every 10 s. On first mount it loads the snapshot. If health fails twice it sets `offline`; when health recovers, it reloads the snapshot.
  - `HYDROPHONES: {id, name, network:'orcasound'|'onc', lat, lon, listenUrl}[]` (copy the site coordinates from planetar-acoustic's catalog in `src/planetar_acoustic/bus/topics.py`; Orcasound listen URLs are `https://live.orcasound.net/listen/<slug>`).

**SourceList** shows one row per source (dot, label, count, and "—" with a "not connected" tooltip when disconnected), then an **Estimates** heading listing active estimates by confidence ("Whales · 78%", plus a SIMULATED tag when simulated). Clicking a row calls `select`.

**SourceStream** shows the selected source's evidence, newest first:
- Each item shows its text, the time, and a tag "→ estimate" when `counted`. When not counted, the item is dimmed and shows its `reason`.
- `simulated` items carry a SIMULATED tag.
- If an estimate is selected, the stream shows that estimate's evidence (`evidenceIds` resolved through `byId`). If a boat is selected, it shows that boat's evidence.
- Hydrophones list the sites with "Listen live ▸" links (these open in a new tab).
- A source that isn't connected shows "Not connected yet" and nothing else.

- [ ] **Step 1: Write failing tests** in `tests/estimates.spec.ts`. They seed state by publishing envelopes to the dev bridge over `ws://127.0.0.1:9400` (copy planetar-ui's pattern):
  - `boat evidence appears in the boats stream`.
  - `uncounted evidence shows its reason`: publish one with `reason: 'in harbour: Inner Harbour'` and assert that text is visible.
  - `selecting an estimate shows only its evidence`.
  - `disconnected source shows not connected`: click VHF radio, and "Not connected yet" is visible.
  - `simulated evidence is tagged`.
- [ ] **Step 2:** Run `npx playwright test tests/estimates.spec.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx playwright test` and `npx tsc -b`. Expected: PASS and clean.
- [ ] **Step 5:** Commit `feat(ui): sources list and per-source evidence stream`.

### Task 9: Map and inspector

**Files:**
- Create: `src/store/boatsStore.ts`
- Modify: `src/components/MapPane.tsx`, `src/components/Inspector.tsx`, `src/hooks/useOrcaStreams.ts` (also subscribe `vessel.ais.position`)
- Test: `tests/estimates.spec.ts`

**Interfaces:**
- Consumes: the stores from Task 8.
- Produces: `useBoatsStore`: `{ byMmsi: Record<number, {pos: AisPosition, track: {lat,lon,atNs}[] (last 2 h)}>, ingest(pos) }`. It keeps only positions with `serverId === 'orca'`.

**MapPane** is MapLibre with planetar-ui's basemap (Esri World Dark Gray raster + label layer; copy the style object from planetar-ui's `MapTab.tsx`), centred on 48.40,-123.30 at zoom 9. Layers:
- **Estimates:** a circle polygon of `radiusM`, filled `#ff7850`, with opacity = confidence × 0.6. Ended estimates are hidden.
- **Boats:** dots, green if the boat is in the selected estimate's `boats`, grey otherwise.
- **Hydrophones:** blue diamonds.
- **Selected boat's track:** a line.

Clicking an estimate selects it; clicking a boat selects the boat. When a selection changes, fit the map to it, but only on change (copy planetar-ui's follow-mode rule: the user's pan wins).

**Inspector** content by selection:
- **Estimate:** "Whales" (or the species, if set), confidence %, "N boats · M operators · watched for X min", "first seen / updated", SIMULATED if simulated, then its evidence list. Below that, a **Hydrophones nearby** line lists the sites within 10 km with "call detection not connected". This is the spec's "show disagreement, don't hide it" in its v1 form: there's no detector yet, so the inspector says so. Each item is clickable: an `ais-track` item selects that boat and shows its track; a `url` item opens the link.
- **Boat:** name, MMSI, operator, speed and course, and its evidence.
- **Source:** a one-line description of the source.

When `serviceStatus === 'offline'`, show a banner across the map ("Inference service offline — estimates may be stale") and draw estimates at 25% opacity.

- [ ] **Step 1: Write failing tests:**
  - `selecting an estimate fills the inspector with its evidence`.
  - `estimate label is Whales, never Orca, when species is null`.
  - `reload restores estimates from the snapshot`. This needs the service from Task 5: `playwright.config.ts`'s webServer runs `npm run dev`, which starts it. Run `simulate.mjs --speed 60` until `/snapshot` has an estimate, reload the page, and assert that the estimate is listed within 2 s.
  - `service offline shows the banner`: start the dev stack with `ORCA_SERVICE_URL` pointed at an unused port via `VITE_ORCA_SERVICE_URL=http://127.0.0.1:9499`. Use a second Playwright project for this one test.
- [ ] **Step 2:** Run `npx playwright test`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx playwright test`, `npm run test:service` and `npx tsc -b`. Expected: PASS and clean. `npm run lint` must show no new errors (any errors inherited from planetar-ui's `fixtures.ts` pattern are noted in `CLAUDE.md` if present).
- [ ] **Step 5:** Commit `feat(ui): map of whale estimates and the evidence inspector`.

### Task 10: End-to-end on bb, docs, and push

**Files:**
- Modify: `README.md`, `CLAUDE.md`

- [ ] **Step 1:** Run `npm run dev`. In another shell, run `node service/simulate.mjs service/scenarios/race-rocks.json --speed 10`. Open `http://127.0.0.1:5290` in Playwright's Chromium and screenshot the estimate selected, with its evidence in the inspector, to `docs/screenshots/race-rocks-sim.png`. Check by eye that the SIMULATED tags are visible.
- [ ] **Step 2:** Leave `planetar:ais-orca` recording (Task 6). Note in `README.md` that real tuning waits for the 2027 whale-watch season. Also note how to add real operator vessels to `service/data/whale-watch-vessels.json` (`verified: true`), and that the hydrophone call-detection feed (Orcasound OrcaHello) and sighting reports are the next sources.
- [ ] **Step 3:** Commit `docs: end-to-end run and next steps` and push.
