import type { ReactNode } from 'react';

/** planetar-ui's pane header, with an optional « collapse button. */
export function PaneHeader({ section, title, onCollapse, collapseLabel, children }: {
  section: string;
  title?: ReactNode;
  onCollapse?: () => void;
  collapseLabel?: string;
  children?: ReactNode;
}) {
  return (
    <div className="pane-header">
      <span className="ph-section">{section}</span>
      {title && <span className="ph-title">{title}</span>}
      <span className="ph-spacer" />
      {children}
      {onCollapse && (
        <button className="ph-collapse" aria-label={collapseLabel} title={collapseLabel} onClick={onCollapse}>«</button>
      )}
    </div>
  );
}
