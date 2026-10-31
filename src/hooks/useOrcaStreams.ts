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
const SNAPSHOT_EVERY_MS = 60_000; // also catches an `ended` missed while the bridge was down
const OFFLINE_AFTER_FAILS = 2;

async function loadSnapshot() {
  try {
    const snap = await fetchSnapshot();
    useEstimatesStore.getState().loadSnapshot(snap);
    useEvidenceStore.getState().ingestMany(snap.evidence);
    useEstimatesStore.getState().setStatus('online');
    return snap.startedNs;
  } catch {
    useEstimatesStore.getState().setStatus('offline');
    return null;
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

  let serviceStarted: string | null = null;
  const refresh = async () => { serviceStarted = (await loadSnapshot()) ?? serviceStarted; };

  // Bus status; a reconnect means we may have missed events — refill.
  let wasOpen = false;
  const offStatus = broker.onStatus((st) => {
    useEstimatesStore.getState().setBus(st);
    if (st === 'open' && wasOpen === false && serviceStarted !== null) void refresh();
    wasOpen = st === 'open';
  });

  void refresh();
  let fails = 0;
  const health = window.setInterval(async () => {
    const started = await fetchHealth();
    const { serviceStatus, setStatus } = useEstimatesStore.getState();
    if (started !== null) {
      fails = 0;
      // Back from offline, or restarted (new start stamp, empty state): refill.
      if (serviceStatus !== 'online' || started !== serviceStarted) void refresh();
    } else if (++fails >= OFFLINE_AFTER_FAILS) {
      setStatus('offline');
    }
  }, HEALTH_EVERY_MS);
  const snapshots = window.setInterval(() => void refresh(), SNAPSHOT_EVERY_MS);

  return () => {
    unsubs.forEach((u) => u());
    offEnv();
    offStatus();
    window.clearInterval(health);
    window.clearInterval(snapshots);
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
