import { useEffect } from 'react';
import { broker } from '@/lib/broker';
import { fetchHealth, fetchSnapshot } from '@/lib/service';
import { useEstimatesStore } from '@/store/estimatesStore';
import { useBoatsStore } from '@/store/boatsStore';
import type { BoatPosition } from '@/store/boatsStore';
import { useEvidenceStore } from '@/store/evidenceStore';
import { ORCA_TOPICS } from '@/types/orca';
import type { EstimateEvent, OrcaEvidence } from '@/types/orca';

// Module-level, ref-counted (planetar-ui's pattern): the first mount
// subscribes and starts the health poll, the last unmount stops them.
let refs = 0;
let stop: (() => void) | null = null;

const HEALTH_EVERY_MS = 10_000;
const OFFLINE_AFTER_FAILS = 2;

async function loadSnapshot() {
  try {
    const snap = await fetchSnapshot();
    useEstimatesStore.getState().loadSnapshot(snap);
    useEvidenceStore.getState().ingestMany(snap.evidence);
    useEstimatesStore.getState().setStatus('online');
  } catch {
    useEstimatesStore.getState().setStatus('offline');
  }
}

function start(): () => void {
  const topics = [ORCA_TOPICS.evidence, ORCA_TOPICS.estimate, ORCA_TOPICS.position, ORCA_TOPICS.simPosition];
  const unsubs = topics.map((t) => broker.subscribe(t));
  const offEnv = broker.onEnvelope((env) => {
    if (env.topic === ORCA_TOPICS.evidence) useEvidenceStore.getState().ingest(env.payload as OrcaEvidence);
    else if (env.topic === ORCA_TOPICS.estimate) useEstimatesStore.getState().applyEvent(env.payload as EstimateEvent);
    else if (env.topic === ORCA_TOPICS.position || env.topic === ORCA_TOPICS.simPosition) {
      useBoatsStore.getState().ingest(env.payload as BoatPosition);
    }
  });

  void loadSnapshot();
  let fails = 0;
  const timer = window.setInterval(async () => {
    const ok = await fetchHealth();
    const { serviceStatus, setStatus } = useEstimatesStore.getState();
    if (ok) {
      fails = 0;
      if (serviceStatus !== 'online') void loadSnapshot(); // back: refill what we missed
    } else if (++fails >= OFFLINE_AFTER_FAILS) {
      setStatus('offline');
    }
  }, HEALTH_EVERY_MS);

  return () => {
    unsubs.forEach((u) => u());
    offEnv();
    window.clearInterval(timer);
  };
}

export function useOrcaStreams() {
  useEffect(() => {
    if (refs++ === 0) stop = start();
    return () => {
      if (--refs === 0) {
        stop?.();
        stop = null;
      }
    };
  }, []);
}
