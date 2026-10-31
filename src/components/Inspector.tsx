import type { ReactNode } from 'react';
import { EvidenceItem } from '@/components/SourceStream';
import { PaneHeader } from '@/components/PaneHeader';
import { HYDROPHONES } from '@/data/hydrophones';
import { sourceById } from '@/data/sources';
import { estimateLabel, pct, timeOf } from '@/lib/format';
import { distanceM } from '@/lib/geo';
import { useBoatsStore } from '@/store/boatsStore';
import { useEstimatesStore } from '@/store/estimatesStore';
import { useEvidenceStore } from '@/store/evidenceStore';
import { useLayoutStore } from '@/store/layoutStore';
import type { OrcaEvidence } from '@/types/orca';

const NEARBY_HYDROPHONE_M = 10_000;
const NS_PER_MIN = 60_000_000_000n;

function Row({ k, v }: { k: string; v: ReactNode }) {
  return <div className="insp-row"><span className="insp-k">{k}</span><span className="insp-v">{v}</span></div>;
}

function EvidenceList({ items }: { items: OrcaEvidence[] }) {
  const select = useLayoutStore((s) => s.select);
  if (!items.length) return <div className="list-empty">No evidence held for this yet.</div>;
  return (
    <>
      {items.map((e) => (
        <EvidenceItem key={e.id} e={e} onSelect={
          e.raw?.kind === 'ais-track' ? () => select({ kind: 'boat', mmsi: (e.raw as { mmsi: number }).mmsi })
            : e.raw?.kind === 'url' ? () => window.open((e.raw as { url: string }).url, '_blank', 'noopener')
              : undefined} />
      ))}
    </>
  );
}

export function Inspector() {
  const selection = useLayoutStore((s) => s.selection);
  const estimates = useEstimatesStore((s) => s.byId);
  const evidenceById = useEvidenceStore((s) => s.byId);
  const boatEvidence = useEvidenceStore((s) => s.bySource.boats);
  const boats = useBoatsStore((s) => s.byMmsi);

  let content: ReactNode;
  if (selection.kind === 'estimate') {
    const e = estimates[selection.id];
    if (!e) content = <div className="list-empty">This estimate is no longer available.</div>;
    else {
      const items = e.evidenceIds.map((id) => evidenceById[id]).filter(Boolean)
        .sort((a, b) => (BigInt(b.atNs) > BigInt(a.atNs) ? 1 : -1));
      const watchedMin = Number((BigInt(e.updatedNs) - BigInt(e.firstNs)) / NS_PER_MIN);
      const near = HYDROPHONES.map((h) => ({ h, d: distanceM(e, h) }))
        .filter((x) => x.d <= NEARBY_HYDROPHONE_M).sort((a, b) => a.d - b.d);
      content = (
        <>
          <div className="insp-head">
            <span className="insp-title">{estimateLabel(e)}</span>
            {e.simulated && <span className="tag-sim">SIMULATED</span>}
            {e.status === 'ended' && <span className="tag-ended">ENDED</span>}
          </div>
          <Row k="confidence" v={<b>{pct(e.confidence)}</b>} />
          <Row k="evidence" v={`${e.boats.length} boats · ${e.operators.length} operators · watched for ${watchedMin} min`} />
          <Row k="first seen / updated" v={`${timeOf(e.firstNs)} / ${timeOf(e.updatedNs)}`} />
          <Row k="area" v={`${e.lat.toFixed(4)}, ${e.lon.toFixed(4)} · ±${Math.round(e.radiusM)} m`} />
          <Row k="hydrophones nearby" v={near.length
            ? near.map((x) => `${x.h.name} (${(x.d / 1000).toFixed(1)} km)`).join(', ') + ' · call detection not connected'
            : `none within ${NEARBY_HYDROPHONE_M / 1000} km`} />
          <div className="list-heading">Why we think so</div>
          <EvidenceList items={items} />
        </>
      );
    }
  } else if (selection.kind === 'boat') {
    const b = boats[selection.mmsi];
    const items = boatEvidence.filter((e) => e.mmsi === selection.mmsi);
    content = (
      <>
        <div className="insp-head">
          <span className="insp-title">{b?.pos.name ?? `Boat ${selection.mmsi}`}</span>
          {b?.pos.simulated && <span className="tag-sim">SIMULATED</span>}
        </div>
        <Row k="vessel" v={`MMSI ${selection.mmsi}`} />
        {b ? (
          <>
            <Row k="speed / course" v={`${b.pos.sog.toFixed(1)} kn · ${Math.round(b.pos.cog ?? 0)}°`} />
            <Row k="last position" v={`${b.pos.lat.toFixed(4)}, ${b.pos.lon.toFixed(4)} at ${timeOf(b.pos.lastSeenNs)}`} />
            <Row k="track held" v={`${b.track.length} positions (last 2 h)`} />
          </>
        ) : <Row k="position" v="no position received yet" />}
        <div className="list-heading">Its evidence</div>
        <EvidenceList items={items} />
      </>
    );
  } else {
    const src = sourceById(selection.id);
    content = (
      <>
        <div className="insp-head"><span className="insp-title">{src.label}</span>
          {!src.connected && <span className="tag-ended">NOT CONNECTED</span>}</div>
        <p className="insp-blurb">{src.blurb}</p>
        <p className="insp-blurb">Select an estimate or a boat on the map to see why.</p>
      </>
    );
  }

  return (
    <div className="pane pane-inspector">
      <PaneHeader section="Inspector" />
      <div className="pane-body">{content}</div>
    </div>
  );
}
