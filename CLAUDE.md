# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`planetar-ui-orca` is a mission app on the planetar platform: it infers where whales are around Victoria from whale-watch boat behaviour in AIS and shows every estimate with the evidence behind it. It is a trimmed copy of `../planetar-ui`'s shell (bridge, broker client, resizable panes, MapLibre), not a mode of it. Workspace rules (pm2 tier on bb, broker contract, licensing) are in `../CLAUDE.md`. Design: `docs/superpowers/specs/2026-10-31-planetar-ui-orca-design.md`; contract: `docs/CONTRACT.md`.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | `concurrently`: Vite **:5290** (`strictPort`) + `bridge/server.mjs` on **ws://127.0.0.1:9400** + `service/index.mjs` (HTTP **:9410**) |
| `npm run test:service` | `node --test service/test/` (the inference; no network) |
| `npm test` | Playwright, bundled Chromium only, auto-starts `npm run dev` |
| `npx tsc -b` · `npm run lint` | Typecheck · lint |

## Rules

- Estimates are labelled **"whales"**; `species` stays `null` unless a source states it. Never show "orca" for a boat-only estimate.
- Anything simulated carries `simulated: true` and shows a **SIMULATED** tag. A source that isn't connected shows "not connected", never placeholder data.
- Every inference threshold lives in `service/config/inference.json`; no magic numbers in the inference code.
- Ports 5290 / 9400 / 9410 only. Never bind 12001–12003 or start a broker. Nothing here deploys to planetar.ca.
- Tests never attach to the founder's Chrome (no CDP); they use Playwright's bundled Chromium.
- Vessels and whales only; never profile the people behind sighting reports or posts.
- `tsconfig.app.json` keeps planetar-ui's `erasableSyntaxOnly` + `verbatimModuleSyntax` (no enums, `import type`); `@/` → `src/`.
