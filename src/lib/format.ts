/** ns-since-epoch string → local "HH:MM". */
export const timeOf = (ns: string) =>
  new Date(Number(BigInt(ns) / 1_000_000n)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const pct = (x: number) => `${Math.round(x * 100)}%`;

/** "Whales" unless a source named the species. */
export const estimateLabel = (e: { species: string | null }) => e.species ?? 'Whales';

/** An http(s) URL from bus data, or null — never open javascript:/data: links. */
export function safeHttpUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}
