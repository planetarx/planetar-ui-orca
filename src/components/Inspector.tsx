import { PaneHeader } from '@/components/PaneHeader';

export function Inspector() {
  return (
    <div className="pane pane-inspector">
      <PaneHeader section="Inspector" />
      <div className="pane-body" />
    </div>
  );
}
