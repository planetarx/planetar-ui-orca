# planetar-ui-orca — design

Date: 2026-10-31. Status: draft for the founder's approval.

## Intent

An expert orca-tracking app for the waters around Victoria, BC. It answers two questions on one screen: **where are the whales (orcas above all) probably right now, and why do we think so?**

The first user is the founder, an orca enthusiast. Prior art is *Whale Locator* (iOS, Melonping Technologies, April 2026): live AIS of whale-watch boats with automatic detection of whale-watching activity, plus community sighting reports. It works, but the founder doesn't trust it, because it shows conclusions without the evidence behind them. This app's reason to exist is **trust through provenance**: every estimate shows exactly which sensor data it was built from, and you can drill from the estimate down to the raw data (the boat tracks, the audio clip, the original post).

That is planetar's core idea (every claim traces to its sources) applied to a second mission. planetar is growing from one maritime-domain-awareness app into a platform for many missions. For now each mission is a **separate app**; once several exist, the common patterns get extracted into an app builder (drag-and-drop, and later a language for describing apps). This app should be built so its reusable parts are easy to spot later, but it must not try to build that framework now.

## Goals

1. A map of current whale estimates around Victoria, labelled "whales" unless a source names the species. Each estimate is a location with a confidence and the list of evidence behind it.
2. The **core inference**: work out where whales are from whale-watching boat behaviour. Commercial whale-watch boats run fast to the whales, then slow and loiter near them, often several boats at once. Gather the evidence from those movements into an estimate.
3. **Drill-down on every source.** Click a source to see its detailed live stream. Click an estimate to see each piece of evidence, and from each piece get to the raw data.
4. Room for more sources, added one at a time: hydrophones, sighting reports, VHF radio, social media. Each is a separate source with its own stream, and each can contribute evidence to an estimate.
5. The planetar-ui look and feel, which the founder already likes.

## Non-goals (for this version)

- A public, mobile or paid product. No accounts, subscriptions or push notifications.
- The app builder and its language. Note patterns as they appear; don't build them.
- Species and pod identification beyond what a source states outright. (If a sighting report says "J pod", show it; don't infer it.)
- Replacing any of planetar-ui's maritime features. This is a sibling app, and planetar-ui is untouched.

## Anti-goals (a failure even if it technically works)

- **An estimate whose reasoning you can't see.** If the screen shows a whale estimate, it must show what it was built from. A confident dot with hidden reasoning is the exact thing being replaced.
- **Hiding disagreement.** If sources conflict (boats loitering but the hydrophone silent), show both rather than averaging them away.
- **Inventing evidence.** A source that isn't connected shows as not connected. It never shows placeholder or synthetic data unless it is clearly labelled as simulated.
- **Tracking people.** The tracked objects are vessels and whales. Social-media and sighting reports are evidence about whales; the app must not profile or follow the people who post them. (A standing planetar rule: vessels only, never people-tracking.)

## The screen (decided, with mockup)

The founder chose layout A in the planetar-ui form:

```
┌───────────┬────────────────────┬──────────────────────────────┐
│ SOURCES  «│ <source> · live   «│            MAP               │
│ ● Boats  7│ event              │   estimate blobs, boats,     │
│ ◆ Hydro  3│ event → est. X     │   hydrophones, reports       │
│ ■ Reports │ event              │                              │
│ ◇ VHF   — │ ...                ├──────────────────────────────┤
│ ✦ Social —│                    │ INSPECTOR · selected estimate │
│ ESTIMATES │                    │ confidence · evidence list,  │
│ Race Rocks│                    │ each item ▸ drills to raw    │
└───────────┴────────────────────┴──────────────────────────────┘
```

- **Far-left column, Sources:** one row per source, with a live count. Sources that aren't connected are greyed out with "—". Below them, the list of current **estimates** (name, confidence).
- **Middle column, source stream:** clicking a source shows its detailed live stream of events (the planetar-ui "channel conversation" pattern). An event that feeds an estimate is tagged with it ("→ est. Race Rocks"). Events the inference ignored are shown with the reason (e.g. "in port, not counted"). Clicking an estimate shows that estimate's evidence stream.
- **Right, map and inspector:** the map shows estimate areas (heat blobs sized by uncertainty), boats, hydrophone sites and report locations. Selecting an estimate or a marker fills the inspector below the map: confidence, then each piece of evidence with a link to its raw data (track replay, audio clip, original post).
- **Collapsing:** both left columns collapse and expand the way planetar-ui's do (keyboard shortcut plus a « handle), and the column dividers can be dragged to resize. With both collapsed, the map and inspector fill the screen.

Mockups from the session: `layout.html` (options) and `layout-v2.html` (the chosen form), in `.superpowers/brainstorm/2667024-1793456742/content/` beside this document. They are copied into the repo's `docs/mockups/` when it is created.

## Sources

| Source | Status for v1 | What it contributes |
|---|---|---|
| **Whale-watch boats (AIS)** | **Required.** Real data | The core inference (below) |
| **Hydrophones** | Show sites and their stream if a usable feed exists | Evidence when orca calls are detected near an estimate |
| **Sighting reports** | Listed, greyed out (no feed chosen yet) | A located, timestamped report is direct evidence, and the main way an estimate gets an "orca" label |
| **VHF radio** | Listed, greyed out | Future work: needs a radio receiver and transcription |
| **Social media** | Listed, greyed out | Future work |

### Whale-watch boats: the core inference

The input is live AIS positions, as planetar-ais already produces them on the bus (`vessel.ais.position`, recorded to `planetar-ais/data/ais/`).

1. **Which boats count.** A curated list of whale-watching operators' vessels (by MMSI, with operator and name). This is a small data file, editable by hand. Vessels not on the list are ignored by the inference but stay visible on the map.
2. **Behaviour.** A watched boat is one that is outside a harbour and has been slow (well below its transit speed) and staying within a small area for several minutes, typically after a fast transit. Harbours, docks and fuel stops are excluded by drawn polygons.
3. **Clustering.** Watched boats close together in space and time form one estimate. More boats, more distinct operators, and longer loiter all raise confidence. A boat that leaves at speed after loitering is evidence the encounter ended, or that the whales are moving.
4. **Location.** The estimate sits near the boats but not on them. Boats keep a regulated distance from whales, so the estimate area is wider than the boat cluster. It is a probability area, not a point.
5. **Every estimate records its evidence:** which boats, which time windows, which rule fired, plus any other source's evidence that was merged in. This record is what the inspector shows.

Starting thresholds (slow speed, loiter time, cluster radius, harbour polygons) are for the builder to choose. They are tested now against simulated encounters with known answers (a scenario generator replays them onto the bus as AIS, clearly marked as simulated), and tuned on recorded real AIS from spring 2027. They must be visible in one config file, not scattered through the code, because the founder will want to see and argue with them.

## How it gets made

**Founder's decisions:**
- A new, separate app called `planetar-ui-orca`, very similar to planetar-ui. It is a sibling, not a mode of planetar-ui.
- Layout A in the planetar-ui form, as above.
- Built on planetar (the bus, the provenance idea, the existing services).
- **Build now, tune later** (2026-10-31). The inference is built and tested now against simulated encounters with known answers. Meanwhile AIS recording is widened to Haro Strait and the San Juan Islands and keeps running, and the thresholds are tuned on real encounters when the whale-watch season picks up in spring 2027.
- **Estimates are labelled "whales", species unknown.** Boat behaviour shows that boats are watching *something*, often humpbacks. An estimate says "orca" (or a pod) only when a source states it outright, such as a sighting report or an orca-call detection.
- **No sighting-report feed in v1.** Sighting reports stay listed as a source, greyed out as not connected, until the founder picks a feed and handles any signup.

**Builder's calls (each marked as such; the founder can override):**
- *Stack:* the same as planetar-ui (React 19 + Vite + TypeScript, MapLibre, Zustand stores, `react-resizable-panels`, Playwright tests), starting from a copy of planetar-ui's shell rather than a shared library. Extracting a shared library is the later app-builder work.
- *Repo:* its own git repo, `~/github/planetarx/planetar-ui-orca`, pushed to the `planetarx` GitHub org, GPLv3 like the other planetar repos.
- *Inference runs as a bus service, not in the browser.* It subscribes to the source topics and publishes estimates as envelopes, using the envelope's causation/correlation ids to point at its evidence. Any client, and later the app builder, can then consume estimates. It can live in the app repo (as planetar-ui's `bridge/` does) until a second mission needs it elsewhere.
- *AIS coverage:* planetar-ais's Victoria box (48.20–48.65 N, 123.70–123.05 W) covers Race Rocks and the Victoria waterfront, but stops short of much of Haro Strait and the San Juan Islands, where much whale watching happens. Adding a wider orca operating area to planetar-ais is a small change; the builder decides how.
- *Runs on bb* beside the existing planetar tier, on its own ports, and is not deployed to planetar.ca. Used from a desktop browser on bb (localhost); LAN, phone and on-the-water use are later work.
- *Estimates and evidence are stored by the app's own service*, not in planetar-ontology. The service keeps current estimates and their evidence and serves a snapshot over HTTP, so a page reload shows them at once; live changes arrive over the bus. The shared ontology is left alone until a second mission shows what belongs there.
- *Hydrophones in v1:* show the Orcasound/ONC sites with links to their live audio. Orca-call evidence comes only from an existing outside detection feed (such as Orcasound's OrcaHello), if one is usable; training our own call detector is out of scope. planetar-acoustic is not changed.
- *A silent hydrophone does not lower confidence in v1.* It is shown beside the estimate ("no calls detected at X in the last N min"), and the founder judges. Counting silence as evidence needs per-site coverage data, which is later work.

## Constraints

- planetar.ca must stay up. Nothing here deploys to production without the founder's go-ahead.
- Don't start a second planetar broker on the live ports; use the running bus on bb.
- Keep to the data sources' terms. Where a feed's terms forbid redistribution, use it for personal display only.
- No secrets in repos. API keys come from the environment, as with planetar-ais.

## Left to the builder

- Exact inference thresholds and the confidence formula (in one visible config file).
- The estimate data shape and topic names (follow planetar's `<domain>.<thing>` topic convention and register the prefixes with any consumer that needs them).
- How each source's raw data is stored and replayed for drill-down.
- Test strategy, following planetar-ui's Playwright setup plus unit tests for the inference.
