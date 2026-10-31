import { PaneHeader } from '@/components/PaneHeader';
import { HYDROPHONES } from '@/data/hydrophones';
import { SOURCES } from '@/data/sources';
import { useOrcaStreams } from '@/hooks/useOrcaStreams';
import { estimateLabel, pct } from '@/lib/format';
import { activeEstimates, useEstimatesStore } from '@/store/estimatesStore';
import { useEvidenceStore } from '@/store/evidenceStore';
import { useLayoutStore } from '@/store/layoutStore';
import type { SourceId } from '@/types/orca';

export function SourceList() {
  useOrcaStreams();
  const toggle = useLayoutStore((s) => s.toggle);
  const selection = useLayoutStore((s) => s.selection);
  const select = useLayoutStore((s) => s.select);
  const boats = useEvidenceStore((s) => s.bySource.boats);
  const byId = useEstimatesStore((s) => s.byId);
  const estimates = activeEstimates(byId);

  const count = (id: SourceId) => {
    if (id === 'boats') return new Set(boats.map((e) => e.mmsi)).size;
    if (id === 'hydrophones') return HYDROPHONES.length;
    return null;
  };

  return (
    <div className="pane pane-sources">
      <PaneHeader section="Sources" onCollapse={() => toggle('sources')} collapseLabel="Collapse sources" />
      <div className="pane-body">
        {SOURCES.map((s) => {
          const on = selection.kind === 'source' && selection.id === s.id;
          return (
            <button key={s.id} className={`source-row${on ? ' sel' : ''}${s.connected ? '' : ' source-off'}`}
              title={s.connected ? s.blurb : 'not connected'} onClick={() => select({ kind: 'source', id: s.id })}>
              <span className="dot" style={{ background: s.colour }} />
              <span className="sr-label">{s.label}</span>
              <span className="sr-count">{s.connected ? count(s.id) : '—'}</span>
            </button>
          );
        })}
        <div className="list-heading">Estimates</div>
        {estimates.length === 0 && <div className="list-empty">none right now</div>}
        {estimates.map((e) => {
          const on = selection.kind === 'estimate' && selection.id === e.id;
          return (
            <button key={e.id} className={`source-row estimate-row${on ? ' sel' : ''}`}
              onClick={() => select({ kind: 'estimate', id: e.id })}>
              <span className="dot" style={{ background: '#ff7850', opacity: 0.3 + e.confidence * 0.7 }} />
              <span className="sr-label">{estimateLabel(e)}{e.simulated && <span className="tag-sim">SIMULATED</span>}</span>
              <span className="sr-count">{pct(e.confidence)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
