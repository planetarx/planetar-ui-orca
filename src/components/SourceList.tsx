import { PaneHeader } from '@/components/PaneHeader';
import { useLayoutStore } from '@/store/layoutStore';

export function SourceList() {
  const toggle = useLayoutStore((s) => s.toggle);
  return (
    <div className="pane pane-sources">
      <PaneHeader section="Sources" onCollapse={() => toggle('sources')} collapseLabel="Collapse sources" />
      <div className="pane-body" />
    </div>
  );
}
