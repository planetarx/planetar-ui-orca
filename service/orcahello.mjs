// OrcaHello (Orcasound's AI call detector, github.com/orcasound/aifororcas-livesystem)
// → hydrophone evidence. Detections arrive off the bus on `acoustic.orcahello`, published
// once per box by planetar-acoustic/orcahello (which polls the public API). The model flags
// possible calls; a human moderator later confirms or rejects them, often hours after.
// OrcaHello targets Southern Residents, so `found: "yes"` means SRKW confirmed; Bigg's
// (transient) orcas and humpbacks come back `found: "no"` with whale tags. The moderator's
// tags, never the model's guess, decide "whales" and the species.
//
// The ingest whitelists the fields: the API also returns the moderator's e-mail address,
// which never reaches the bus (vessels and whales only; no people).

export const ORCAHELLO_TOPIC = 'acoustic.orcahello';

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

/** Changes when the moderator's verdict does (same as the ingest's). */
export function detectionSignature(d) {
  return `${d.id}|${Boolean(d.reviewed)}|${d.found}|${(d.tagList ?? []).join(';')}`;
}

/** `(d) => true` the first time a detection is seen and whenever its review changes:
 *  the ingest republishes its whole window periodically, for consumers that restarted. */
export function createDetectionGate() {
  const seen = new Map(); // OrcaHello id → signature
  return (d) => {
    if (!d?.id) return false;
    const sig = detectionSignature(d);
    if (seen.get(d.id) === sig) return false;
    seen.set(d.id, sig);
    return true;
  };
}
