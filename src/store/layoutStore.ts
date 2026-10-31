import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SourceId } from '@/types/orca';

export type LeftPane = 'sources' | 'stream';

export type Selection =
  | { kind: 'source'; id: SourceId }
  | { kind: 'estimate'; id: string }
  | { kind: 'boat'; mmsi: number };

interface LayoutState {
  visible: Record<LeftPane, boolean>;
  /** Percent of the window, as react-resizable-panels reports it. */
  widths: Record<LeftPane, number>;
  selection: Selection;
  showHelp: boolean;
  toggle: (pane: LeftPane) => void;
  setWidth: (pane: LeftPane, pct: number) => void;
  select: (sel: Selection) => void;
  resetLayout: () => void;
  toggleHelp: () => void;
}

export const DEFAULT_WIDTHS: Record<LeftPane, number> = { sources: 16, stream: 30 };
const DEFAULTS = {
  visible: { sources: true, stream: true },
  widths: DEFAULT_WIDTHS,
  selection: { kind: 'source', id: 'boats' } as Selection,
};

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      showHelp: false,
      toggle: (pane) => set((s) => ({ visible: { ...s.visible, [pane]: !s.visible[pane] } })),
      setWidth: (pane, pct) => set((s) => ({ widths: { ...s.widths, [pane]: pct } })),
      select: (selection) => set({ selection }),
      resetLayout: () => set({ visible: DEFAULTS.visible, widths: DEFAULTS.widths }),
      toggleHelp: () => set((s) => ({ showHelp: !s.showHelp })),
    }),
    {
      name: 'planetar-ui-orca-layout',
      partialize: (s) => ({ visible: s.visible, widths: s.widths, selection: s.selection }),
    },
  ),
);
