// Wire contract for the orca inference service — mirrors docs/CONTRACT.md.
// ns timestamps are strings (JSON numbers lose precision), as in planetar-ui.

export type SourceId = 'boats' | 'hydrophones' | 'reports' | 'vhf' | 'social';

export type EvidenceRaw =
  | { kind: 'ais-track'; mmsi: number; fromNs: string; toNs: string }
  | { kind: 'url'; url: string };

/** `orca.evidence` — schema `orca.Evidence.v1`. One observation from one source. */
export interface OrcaEvidence {
  id: string;
  source: SourceId;
  atNs: string;
  text: string;
  /** Did it feed an estimate? */
  counted: boolean;
  /** Why it was not counted, e.g. "in harbour: Inner Harbour". */
  reason: string | null;
  estimateId: string | null;
  mmsi: number | null;
  lat: number | null;
  lon: number | null;
  raw: EvidenceRaw | null;
  simulated: boolean;
}

/** A place where whales probably are, with the evidence behind it. */
export interface OrcaEstimate {
  id: string;
  label: 'whales';
  /** Only set when a source states it outright; never inferred from boats. */
  species: string | null;
  lat: number;
  lon: number;
  radiusM: number;
  /** 0..1 */
  confidence: number;
  status: 'active' | 'ended';
  firstNs: string;
  updatedNs: string;
  boats: number[];
  operators: string[];
  evidenceIds: string[];
  simulated: boolean;
}

/** `orca.estimate` — schema `orca.Estimate.v1`. */
export interface EstimateEvent {
  event: 'upsert' | 'ended';
  estimate: OrcaEstimate;
}

/** `GET :9410/snapshot` */
export interface Snapshot {
  estimates: OrcaEstimate[];
  evidence: OrcaEvidence[];
  startedNs: string;
}

export const ORCA_TOPICS = {
  evidence: 'orca.evidence',
  estimate: 'orca.estimate',
  position: 'vessel.ais.position',
} as const;
