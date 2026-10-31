import { create } from 'zustand';
import type { EstimateEvent, OrcaEstimate, Snapshot } from '@/types/orca';

export type ServiceStatus = 'connecting' | 'online' | 'offline';

interface EstimatesState {
  byId: Record<string, OrcaEstimate>;
  serviceStatus: ServiceStatus;
  applyEvent: (ev: EstimateEvent) => void;
  loadSnapshot: (s: Snapshot) => void;
  setStatus: (s: ServiceStatus) => void;
}

export const useEstimatesStore = create<EstimatesState>((set) => ({
  byId: {},
  serviceStatus: 'connecting',
  applyEvent: ({ estimate }) => set((s) => ({ byId: { ...s.byId, [estimate.id]: estimate } })),
  loadSnapshot: (snap) => set({ byId: Object.fromEntries(snap.estimates.map((e) => [e.id, e])) }),
  setStatus: (serviceStatus) => set({ serviceStatus }),
}));

/** Active estimates, most confident first. */
export const activeEstimates = (byId: Record<string, OrcaEstimate>) =>
  Object.values(byId).filter((e) => e.status === 'active').sort((a, b) => b.confidence - a.confidence);
