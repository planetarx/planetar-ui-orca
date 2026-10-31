// Small-area geometry, as service/geo.mjs.
const R = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A circle of radiusM around a point, as a GeoJSON ring of [lon, lat]. */
export function circleRing(c: { lat: number; lon: number }, radiusM: number, n = 48): [number, number][] {
  const ring: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const b = (2 * Math.PI * i) / n;
    ring.push([
      c.lon + (radiusM * Math.sin(b)) / (111_320 * Math.cos(rad(c.lat))),
      c.lat + (radiusM * Math.cos(b)) / 111_320,
    ]);
  }
  return ring;
}
