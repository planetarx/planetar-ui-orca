import { PaneHeader } from '@/components/PaneHeader';
import { useLayoutStore } from '@/store/layoutStore';

export function SourceStream() {
  const toggle = useLayoutStore((s) => s.toggle);
  return (
    <div className="pane pane-stream">
      <PaneHeader section="Stream" onCollapse={() => toggle('stream')} collapseLabel="Collapse stream" />
      <div className="pane-body" />
    </div>
  );
}
