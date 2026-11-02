// OrcaHello (Orcasound's AI call detector, github.com/orcasound/aifororcas-livesystem)
// → hydrophone evidence. The detections API is public for reading. The model flags
// possible calls; a human moderator later confirms or rejects them, often hours after.
// OrcaHello targets Southern Residents, so `found: "yes"` means SRKW confirmed; Bigg's
// (transient) orcas and humpbacks come back `found: "no"` with whale tags. The moderator's
// tags, never the model's guess, decide "whales" and the species.
//
// Only whitelisted fields are kept: the API also returns the moderator's e-mail address,
// which is never copied (vessels and whales only; no people).

export const ORCAHELLO_URL = 'https://aifororcasdetections.azurewebsites.net/api/detections';

const WHALE_TAGS = new Set(['srkw', 'resident', 'transient', 'biggs', 'humpback', 'orca', 'whale']);

/** The moderator's verdict on one detection. */
export function classify(d) {
  const reviewed = Boolean(d.reviewed);
  const tags = new Set((d.tagList ?? []).map((t) => String(t).toLowerCase()));
  const confirmedSrkw = reviewed && String(d.found).toLowerCase() === 'yes';
  const whales = confirmedSrkw || (reviewed && [...tags].some((t) => WHALE_TAGS.has(t)));
  let species = null;
  if (whales) {
    if (confirmedSrkw || tags.has('srkw') || tags.has('resident')) species = 'Southern Resident killer whales';
    else if (tags.has('transient') || tags.has('biggs')) species = "Bigg's killer whales";
    else if (tags.has('humpback')) species = 'humpback whales';
    else if (tags.has('orca')) species = 'killer whales';
  }
  return { reviewed, whales, species };
}

const httpsUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

/** One detection → an orca.Evidence.v1 (counted/estimateId are settled by the core). */
export function toEvidence(d, id) {
  const { reviewed, whales, species } = classify(d);
  const site = `${d.location?.name ?? 'Unknown'} hydrophone`;
  const flagged = `OrcaHello flagged possible calls (${Math.round(Number(d.confidence) || 0)}%)`;
  const heard = (d.tagList ?? []).join(', ');
  const text = !reviewed ? `${site}: ${flagged}`
    : whales ? `${site}: moderator confirmed ${species ?? 'whales'}`
      : `${site}: ${flagged}; moderator heard ${heard || 'no whales'}`;
  const url = httpsUrl(d.audioUri) ?? httpsUrl(d.spectrogramUri);
  return {
    id, source: 'hydrophones', atNs: String(BigInt(Date.parse(d.timestamp)) * 1_000_000n), text,
    counted: false, reason: !reviewed ? 'awaiting moderator review' : whales ? null : 'moderator: no whales',
    estimateId: null, mmsi: null, lat: d.location?.latitude ?? null, lon: d.location?.longitude ?? null,
    raw: url ? { kind: 'url', url } : null, simulated: false, species,
  };
}

/**
 * Polls the last `timeframe` of detections, newest first, paging until a short page.
 * `onDetection(d)` fires for a new detection and again when its review changes.
 */
export function createOrcaHelloPoller({ fetch = globalThis.fetch, onDetection, onError = () => {},
  url = ORCAHELLO_URL, timeframe = '24h', recordsPerPage = 50, maxPages = 10 }) {
  const state = new Map(); // OrcaHello id → review signature last reported

  async function poll() {
    try {
      for (let page = 1; page <= maxPages; page++) {
        const q = new URLSearchParams({ Timeframe: timeframe, SortBy: 'timestamp', SortOrder: 'desc',
          Page: String(page), RecordsPerPage: String(recordsPerPage), Location: 'all' });
        const res = await fetch(`${url}?${q}`);
        if (!res.ok) throw new Error(`OrcaHello HTTP ${res.status}`);
        const items = await res.json();
        for (const d of items) {
          const sig = `${d.reviewed}|${d.found}|${(d.tagList ?? []).join(';')}`;
          if (!d?.id || state.get(d.id) === sig) continue;
          state.set(d.id, sig);
          onDetection(d);
        }
        if (items.length < recordsPerPage) break;
      }
    } catch (e) {
      onError(e);
    }
  }

  return { poll };
}
