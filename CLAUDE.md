# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`planetar-ui-orca` is a mission app on the planetar platform: it infers where whales are around Victoria from whale-watch boat behaviour in AIS and shows every estimate with the evidence behind it. It is a trimmed copy of `../planetar-ui`'s shell (bridge, broker client, resizable panes, MapLibre), not a mode of it. Workspace rules (pm2 tier on bb, broker contract, licensing) are in `../CLAUDE.md`. Design: `docs/superpowers/specs/2026-10-31-planetar-ui-orca-design.md`; contract: `docs/CONTRACT.md`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | `concurrently`: Vite **:5290** (`strictPort`) + `bridge/server.mjs` on **ws://127.0.0.1:9400** + `service/index.mjs` (HTTP **:9410**) |
| `npm run test:service` | `node:test` over `service/test/` and `bridge/test/` (the inference, and the bridge's Origin check) |
| `npm test` | Playwright, bundled Chromium only, auto-starts `npm run dev` |
| `npx tsc -b` · `npm run lint` | Typecheck · lint |
| `node --test service/test/tracker.test.mjs` · `npx playwright test tests/inspector.spec.ts` | One service test file · one Playwright spec |
| `node service/simulate.mjs service/scenarios/race-rocks.json --speed 10` | Replay a scenario onto the bus (`sim.vessel.ais.position`) to watch an estimate form |

Playwright sets `reuseExistingServer: false` and Vite uses `strictPort`, so stop any running `npm run dev` before `npm test`. Its tests publish through the bridge onto bb's **live shared bus**; every fixture is `simulated: true`, and `tests/fixtures.ts` ends whatever estimates a test published (`endPublished`). Keep both properties when writing new specs.

## Architecture

Three processes, all talking through the planetar broker (pm2's `planetar:broker` on bb):

1. **`service/`** — the inference (plain Node ESM). `index.mjs` wires I/O around `core.mjs` (`createInferenceService`), which is pure: positions and hydrophone detections in, `publish(topic, schema, payload)` out, plus a snapshot. Pipeline: `tracker.mjs` (per-boat behaviour: fast run-out then loiter = watching; harbours, staleness, moored detection) → `estimator.mjs` (single-linkage clusters of watching boats → estimate areas, stable ids, merges, hydrophone-only estimates) → `orca.evidence` / `orca.estimate` on the bus. `orcahello.mjs` polls OrcaHello and classifies detections. `core.mjs` keeps one **world** (own tracker, estimator, clock) for real boats and one per `simRunId`; simulated worlds run on replay time. `http.mjs` serves `/snapshot`, `/health`, `/track`. `bus.mjs` is the service's own TCP broker link (reuses `bridge/zmesg.mjs`). Inputs are hand-edited JSON loaded by `load.mjs`: `config/inference.json`, `data/harbours.json`, `data/whale-watch-vessels.json` (only listed MMSIs are tracked).
2. **`bridge/server.mjs`** — WebSocket ↔ broker proxy copied from planetar-ui (+ Origin check). Falls back to mock mode if the broker is unreachable.
3. **`src/`** — React UI. `hooks/useOrcaStreams.ts` is the single ref-counted subscriber: it loads `/snapshot`, polls `/health` (a changed `startedNs` means the service restarted → reload the snapshot), and feeds bus envelopes into the zustand stores (`estimatesStore`, `evidenceStore`, `boatsStore`). `src/data/sources.ts` is the source list (unconnected ones greyed). `VITE_WS_URL` / `VITE_ORCA_SERVICE_URL` override the bridge and service URLs at build time.

The wire contract (`docs/CONTRACT.md`) is mirrored by `src/types/orca.ts`; change both together. Adding an optional field is compatible; anything else bumps the schema version.

## Rules

- Estimates are labelled **"whales"**; `species` stays `null` unless a source states it. Never show "orca" for a boat-only estimate.
- Anything simulated carries `simulated: true` and shows a **SIMULATED** tag. A source that isn't connected shows "not connected", never placeholder data.
- Every inference threshold lives in `service/config/inference.json`; no magic numbers in the inference code.
- Ports 5290 / 9400 / 9410 only. Never bind 12001–12003 or start a broker.
- **Production is `https://orca.planetar.ca`** (since 2026-11-02) on EC2 www0, not bb: nginx serves `dist/` (built with `VITE_WS_URL=wss://orca.planetar.ca/ws VITE_ORCA_SERVICE_URL=https://orca.planetar.ca/svc`) and proxies `/ws`→9400, `/svc/`→9410; pm2 apps `planetar:orca-bridge` (`BRIDGE_READ_ONLY=1`, origin `https://orca.planetar.ca`) and `planetar:orca-service`. AIS comes off the bus from the box's single `planetar:ais` (`OP=victoria,orca`, one aisstream connection); never add a second AIS feed for this app. Deploy = on www0, clean `git status` → `git fetch && git reset --hard origin/main` → `npm ci` + build → `pm2 restart planetar:orca-bridge planetar:orca-service`. Runbook: `~/data/vaults/docs/DEPLOY-planetar.md`.
- Tests never attach to the founder's Chrome (no CDP); they use Playwright's bundled Chromium.
- Vessels and whales only; never profile the people behind sighting reports or posts.
- `tsconfig.app.json` keeps planetar-ui's `erasableSyntaxOnly` + `verbatimModuleSyntax` (no enums, `import type`); `@/` → `src/`.
- The bridge accepts browser connections only from `BRIDGE_ALLOWED_ORIGINS` (default the app's own :5290 origins); planetar-ui's bridge has no such check. Keep it: the bridge publishes onto the live bus.
- Simulated positions go on `sim.vessel.ais.position` (never `vessel.ais.position`), so the shared planetar-ontology doesn't store fake vessels. The service infers real boats and each replay (`simRunId`) in separate worlds; keep it that way.
- Evidence and links arrive off the bus: open only http(s) URLs (`safeHttpUrl`).
- react-resizable-panels v4 reads a bare number as **pixels**; give panel sizes as `"%"` strings.
