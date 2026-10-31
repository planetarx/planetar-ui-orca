import { useEffect, useState } from 'react';
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels';
import type { Layout } from 'react-resizable-panels';
import { Inspector } from '@/components/Inspector';
import { KeystrokeHelp } from '@/components/KeystrokeHelp';
import { MapPane } from '@/components/MapPane';
import { SourceList } from '@/components/SourceList';
import { SourceStream } from '@/components/SourceStream';
import { useLayoutStore } from '@/store/layoutStore';
import type { LeftPane } from '@/store/layoutStore';
import './App.css';

/*
 * Panel sizes are "%" strings: in react-resizable-panels v4 a bare number
 * means pixels.
 *
 * Sources | Stream | (Map over Inspector). The left panes collapse to zero
 * width in place (collapsible Panels driven through panelRef) rather than
 * being unmounted, so the Group never re-keys and the MapLibre canvas is
 * never remounted — planetar-ui's stretched-map lesson.
 */
export default function App() {
  const visible = useLayoutStore((s) => s.visible);
  const widths = useLayoutStore((s) => s.widths);
  const showHelp = useLayoutStore((s) => s.showHelp);
  const toggle = useLayoutStore((s) => s.toggle);
  const setWidth = useLayoutStore((s) => s.setWidth);
  const resetLayout = useLayoutStore((s) => s.resetLayout);
  const toggleHelp = useLayoutStore((s) => s.toggleHelp);

  const refs = { sources: usePanelRef(), stream: usePanelRef() };
  // Panel default sizes come from the store once, at mount.
  const [initial] = useState(() => ({ visible, widths }));

  // Store → panels: collapse or expand to match the visibility flags.
  useEffect(() => {
    for (const pane of ['sources', 'stream'] as LeftPane[]) {
      const p = refs[pane].current;
      if (!p) continue;
      if (visible[pane] && p.isCollapsed()) p.expand();
      if (!visible[pane] && !p.isCollapsed()) p.collapse();
    }
  });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showHelp) {
        e.preventDefault();
        toggleHelp();
        return;
      }
      if (!(e.ctrlKey && e.shiftKey)) return;
      switch (e.key.toLowerCase()) {
        case 's': e.preventDefault(); toggle('sources'); break;
        case 'c': e.preventDefault(); toggle('stream'); break;
        case '0':
        case ')': e.preventDefault(); resetLayout(); break;
        case '/':
        case '?': e.preventDefault(); toggleHelp(); break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [showHelp, toggle, resetLayout, toggleHelp]);

  // Panels → store: remember drag widths. Collapsing is only by « or the
  // shortcuts; a zero width seen mid-expand must not be read as a collapse.
  const onLayoutChanged = (layout: Layout) => {
    for (const pane of ['sources', 'stream'] as LeftPane[]) {
      const size = layout[`${pane}-panel`];
      if (typeof size === 'number' && size > 0) setWidth(pane, size);
    }
  };

  const strip = (pane: LeftPane, label: string) =>
    !visible[pane] && (
      <button className="pane-strip" aria-label={`Expand ${pane}`} title={`Expand ${pane}`} onClick={() => toggle(pane)}>
        {label} »
      </button>
    );

  return (
    <div className="app">
      {strip('sources', 'SOURCES')}
      {strip('stream', 'STREAM')}
      <div className="workspace">
        <Group orientation="horizontal" onLayoutChanged={onLayoutChanged}>
          <Panel id="sources-panel" panelRef={refs.sources} collapsible collapsedSize="0%" minSize="10%"
            defaultSize={`${initial.visible.sources ? initial.widths.sources : 0}%`}>
            {visible.sources && <SourceList />}
          </Panel>
          <Separator className="resize-handle" />
          <Panel id="stream-panel" panelRef={refs.stream} collapsible collapsedSize="0%" minSize="16%"
            defaultSize={`${initial.visible.stream ? initial.widths.stream : 0}%`}>
            {visible.stream && <SourceStream />}
          </Panel>
          <Separator className="resize-handle" />
          <Panel id="right-panel" minSize="30%">
            <Group orientation="vertical">
              <Panel id="map-panel" defaultSize="65%" minSize="25%">
                <MapPane />
              </Panel>
              <Separator className="resize-handle resize-handle-h" />
              <Panel id="inspector-panel" defaultSize="35%" minSize="12%">
                <Inspector />
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      {showHelp && <KeystrokeHelp />}
    </div>
  );
}
