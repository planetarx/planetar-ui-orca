import { create } from 'zustand';
import type { EstimateEvent, OrcaEstimate, Snapshot } from '@/types/orca';

export type ServiceStatus = 'connecting' | 'online' | 'offline';
export type BusStatus = 'connecting' | 'open' | 'closed';

interface EstimatesState {
  byId: Record<string, OrcaEstimate>;
  serviceStatus: ServiceStatus;
  busStatus: BusStatus;
  applyEvent: (ev: EstimateEvent) => void;
  loadSnapshot: (s: Snapshot) => void;
  setStatus: (s: ServiceStatus) => void;
  setBus: (s: BusStatus) => void;
}

export const useEstimatesStore = create<EstimatesState>((set) => ({
  byId: {},
  serviceStatus: 'connecting',
  busStatus: 'connecting',
  applyEvent: ({ estimate }) => set((s) => ({ byId: { ...s.byId, [estimate.id]: estimate } })),
  loadSnapshot: (snap) => set({ byId: Object.fromEntries(snap.estimates.map((e) => [e.id, e])) }),
  setStatus: (serviceStatus) => set({ serviceStatus }),
  setBus: (busStatus) => set({ busStatus }),
}));

/** Estimates can't be trusted as live when either the bus or the service is down. */
export const isStale = (s: { serviceStatus: ServiceStatus; busStatus: BusStatus }) =>
  s.serviceStatus === 'offline' || s.busStatus === 'closed';

/** Active estimates, most confident first. */
export const activeEstimates = (byId: Record<string, OrcaEstimate>) =>
  Object.values(byId).filter((e) => e.status === 'active').sort((a, b) => b.confidence - a.confidence);
