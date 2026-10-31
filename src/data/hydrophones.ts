// Hydrophone sites near the orca area. Orcasound coordinates and slugs are
// from its live feed list (live.orcasound.net/api/json/feeds, 2026-10-31);
// ONC sites from planetar-acoustic's catalogue. ONC has no public live-listen page.

export interface Hydrophone {
  id: string;
  name: string;
  network: 'orcasound' | 'onc';
  lat: number;
  lon: number;
  listenUrl: string | null;
}

const orcasound = (slug: string, name: string, lat: number, lon: number): Hydrophone =>
  ({ id: slug, name, network: 'orcasound', lat, lon, listenUrl: `https://live.orcasound.net/listen/${slug}` });

export const HYDROPHONES: Hydrophone[] = [
  orcasound('orcasound-lab', 'Orcasound Lab', 48.5583, -123.1736),
  orcasound('andrews-bay', 'Andrews Bay', 48.5467, -123.1664),
  orcasound('north-sjc', 'North San Juan Channel', 48.5913, -123.0588),
  orcasound('port-townsend', 'Port Townsend', 48.1357, -122.7606),
  orcasound('bush-point', 'Bush Point', 48.0337, -122.6040),
  orcasound('sunset-bay', 'Beach Camp at Sunset Bay', 47.8650, -122.3339),
  { id: 'CBYIP', name: 'Saanich Inlet (ONC)', network: 'onc', lat: 48.65, lon: -123.5, listenUrl: null },
  { id: 'SEVIP', name: 'Strait of Georgia East (ONC)', network: 'onc', lat: 49.04, lon: -123.317, listenUrl: null },
];
