import { create } from 'zustand';
import type { OrcaEvidence, SourceId } from '@/types/orca';

const CAP = 500;

interface EvidenceState {
  /** Newest first, capped per source. */
  bySource: Record<SourceId, OrcaEvidence[]>;
  byId: Record<string, OrcaEvidence>;
  ingest: (e: OrcaEvidence) => void;
  ingestMany: (es: OrcaEvidence[]) => void;
}

const empty = (): Record<SourceId, OrcaEvidence[]> => ({ boats: [], hydrophones: [], reports: [], vhf: [], social: [] });

export const useEvidenceStore = create<EvidenceState>((set) => ({
  bySource: empty(),
  byId: {},
  ingest: (e) => set((s) => add(s, [e])),
  ingestMany: (es) => set((s) => add(s, es)),
}));

function add(s: EvidenceState, es: OrcaEvidence[]) {
  const bySource = { ...s.bySource };
  const byId = { ...s.byId };
  for (const e of es) {
    if (byId[e.id] || !bySource[e.source]) continue;
    byId[e.id] = e;
    const list = [e, ...bySource[e.source]].sort((a, b) => (BigInt(b.atNs) > BigInt(a.atNs) ? 1 : -1));
    for (const dropped of list.splice(CAP)) delete byId[dropped.id];
    bySource[e.source] = list;
  }
  return { bySource, byId };
}
