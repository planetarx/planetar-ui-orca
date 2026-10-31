import { PaneHeader } from '@/components/PaneHeader';
import { HYDROPHONES } from '@/data/hydrophones';
import { sourceById } from '@/data/sources';
import { estimateLabel, pct, timeOf } from '@/lib/format';
import { useEstimatesStore } from '@/store/estimatesStore';
import { useEvidenceStore } from '@/store/evidenceStore';
import { useLayoutStore } from '@/store/layoutStore';
import type { OrcaEvidence } from '@/types/orca';

export function EvidenceItem({ e, onSelect }: { e: OrcaEvidence; onSelect?: () => void }) {
  return (
    <div className={`ev-item${e.counted ? '' : ' ev-ignored'}`} style={{ borderLeftColor: sourceById(e.source).colour }}
      onClick={onSelect} role={onSelect ? 'button' : undefined}>
      <div className="ev-text">
        {e.text}
        {e.counted && <span className="tag-est">→ estimate</span>}
        {e.simulated && <span className="tag-sim">SIMULATED</span>}
      </div>
      <div className="ev-meta">
        {timeOf(e.atNs)} · {sourceById(e.source).label}
        {e.reason && <> · <span className="ev-reason">{e.reason}</span></>}
      </div>
    </div>
  );
}

export function SourceStream() {
  const toggle = useLayoutStore((s) => s.toggle);
  const selection = useLayoutStore((s) => s.selection);
  const select = useLayoutStore((s) => s.select);
  const bySource = useEvidenceStore((s) => s.bySource);
  const byId = useEvidenceStore((s) => s.byId);
  const estimates = useEstimatesStore((s) => s.byId);

  let title: string;
  let items: OrcaEvidence[] = [];
  let body = null;
  if (selection.kind === 'source') {
    const src = sourceById(selection.id);
    title = `${src.label} · live`;
    if (!src.connected) body = <div className="list-empty">Not connected yet. {src.blurb}</div>;
    else if (selection.id === 'hydrophones') {
      body = HYDROPHONES.map((h) => (
        <div className="ev-item" key={h.id} style={{ borderLeftColor: src.colour }}>
          <div className="ev-text">
            {h.listenUrl
              ? <a href={h.listenUrl} target="_blank" rel="noreferrer">{h.name} · Listen live ▸</a>
              : <>{h.name} · no public live audio</>}
          </div>
          <div className="ev-meta">{h.network === 'orcasound' ? 'Orcasound' : 'Ocean Networks Canada'} · call detection not connected</div>
        </div>
      ));
    } else items = bySource[selection.id];
  } else if (selection.kind === 'estimate') {
    const est = estimates[selection.id];
    title = est ? `${estimateLabel(est)} · ${pct(est.confidence)} · evidence` : 'Estimate gone';
    items = (est?.evidenceIds ?? []).map((id) => byId[id]).filter(Boolean)
      .sort((a, b) => (BigInt(b.atNs) > BigInt(a.atNs) ? 1 : -1));
  } else {
    title = `Boat ${selection.mmsi}`;
    items = bySource.boats.filter((e) => e.mmsi === selection.mmsi);
  }

  return (
    <div className="pane pane-stream">
      <PaneHeader section="Stream" title={title} onCollapse={() => toggle('stream')} collapseLabel="Collapse stream" />
      <div className="pane-body">
        {body ?? (items.length === 0
          ? <div className="list-empty">Nothing yet.</div>
          : items.map((e) => (
            <EvidenceItem key={e.id} e={e}
              onSelect={e.mmsi != null ? () => select({ kind: 'boat', mmsi: e.mmsi! }) : undefined} />
          )))}
      </div>
    </div>
  );
}
