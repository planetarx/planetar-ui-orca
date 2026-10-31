/** ns-since-epoch string → local "HH:MM". */
export const timeOf = (ns: string) =>
  new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "Whales" unless a source named the species. */
export const estimateLabel = (e: { species: string | null }) => e.species ?? 'Whales';
