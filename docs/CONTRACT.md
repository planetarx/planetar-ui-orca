# Wire contract: the orca inference service

The SSOT for what `service/` publishes and the UI reads. `src/types/orca.ts` mirrors it; change both together. Adding an optional field is backward-compatible; anything else bumps the schema version.

## Input

`vessel.ais.position` from planetar-ais (payload = the position object; see planetar-ui `docs/AIS-INTEGRATION.md`). The service uses `mmsi`, `name`, `lat`, `lon`, `sog`, `lastSeenNs`, `serverId` and `simulated`. Only vessels listed in `service/data/whale-watch-vessels.json` are tracked.

`sim.vessel.ais.position`: the same payload from `service/simulate.mjs`, always `simulated: true`, plus `simRunId` (one per replay; each replay is inferred on its own). A separate topic so the shared planetar-ontology and planetar-ui never store the simulated vessels.

## `orca.evidence` — schema `orca.Evidence.v1`

One observation from one source, published as it happens.

| Field | Type | Meaning |
|---|---|---|
| `id` | string | UUIDv7 |
| `source` | `boats` \| `hydrophones` \| `reports` \| `vhf` \| `social` | which source it came from |
| `atNs` | string | ns since epoch |
| `text` | string | one human sentence |
| `counted` | boolean | did it feed an estimate? |
| `reason` | string \| null | why it was not counted, e.g. `in harbour: Inner Harbour` |
| `estimateId` | string \| null | the estimate it fed |
| `mmsi`, `lat`, `lon` | number \| null | where and which vessel, when known |
| `raw` | `{kind:'ais-track', mmsi, fromNs, toNs}` \| `{kind:'url', url}` \| null | how to drill down to the raw data |
| `simulated` | boolean | true for anything from a simulated scenario |

## `orca.estimate` — schema `orca.Estimate.v1`

Payload `{ event: 'upsert' | 'ended', estimate }`:

| Field | Type | Meaning |
|---|---|---|
| `id` | string | stable across updates while the same boats stay on it |
| `label` | `"whales"` | always "whales" |
| `species` | string \| null | only when a source states it; never inferred from boats |
| `lat`, `lon`, `radiusM` | number | probability area: boat centroid, radius = farthest boat + whale standoff |
| `confidence` | number 0..1 | see `service/config/inference.json` |
| `status` | `active` \| `ended` | |
| `firstNs`, `updatedNs` | string | ns |
| `boats` | number[] | MMSIs of the watching boats |
| `operators` | string[] | their operators |
| `evidenceIds` | string[] | the evidence behind it |
| `simulated` | boolean | true if any of its boats is simulated |
| `mergedInto` | string, optional | on an `ended` estimate whose boats all joined another: that estimate's id |

## HTTP (port 9410)

- `GET /snapshot` → `{ estimates, evidence (last 500), startedNs }`: active estimates plus those ended in the last 2 h, so a reloaded page fills at once.
- `GET /health` → `{ ok: true, startedNs }`: `startedNs` changes when the service restarts, so a client reloads the snapshot.
- `GET /track?mmsi=&from=&to=` (ns) → `{ mmsi, points: [{lat, lon, sog, atNs}] }`: the raw positions behind a boat's evidence; listed boats only, last 2 h.
