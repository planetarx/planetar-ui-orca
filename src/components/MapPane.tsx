import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import 'maplibre-gl/dist/maplibre-gl.css';
import { HYDROPHONES } from '@/data/hydrophones';
import { circleRing } from '@/lib/geo';
import { boatFeatures, estimateFeatures } from '@/lib/mapData';
import { useBoatsStore } from '@/store/boatsStore';
import { activeEstimates, useEstimatesStore } from '@/store/estimatesStore';
import { useLayoutStore } from '@/store/layoutStore';

// planetar-ui's keyless Esri "World Dark Gray" basemap + label overlay.
// Esri tile paths are {z}/{y}/{x}.
const ESRI_CANVAS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas';
const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    basemap: { type: 'raster', tiles: [`${ESRI_CANVAS}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256, attribution: 'Esri, HERE, Garmin, © OpenStreetMap contributors', maxzoom: 16 },
    labels: { type: 'raster', tiles: [`${ESRI_CANVAS}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
      tileSize: 256, maxzoom: 16 },
  },
  layers: [
    { id: 'basemap', type: 'raster', source: 'basemap', paint: { 'raster-brightness-max': 0.92, 'raster-contrast': 0.05 } },
    { id: 'basemap-labels', type: 'raster', source: 'labels' },
  ],
};
const CENTER: [number, number] = [-123.3, 48.4];
/** Boats with no fix for this long leave the map (AIS off, or out of range). */
const BOAT_STALE_MIN = 30;
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function MapPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);

  const byId = useEstimatesStore((s) => s.byId);
  const status = useEstimatesStore((s) => s.serviceStatus);
  const boats = useBoatsStore((s) => s.byMmsi);
  const selection = useLayoutStore((s) => s.selection);

  // ---------- create the map once ----------
  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({ container: containerRef.current, style: MAP_STYLE, center: CENTER, zoom: 9,
      attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'nautical', maxWidth: 120 }), 'bottom-left');
    map.on('load', () => {
      for (const id of ['estimates', 'boats', 'track', 'hydrophones']) map.addSource(id, { type: 'geojson', data: EMPTY });
      map.addLayer({ id: 'est-fill', type: 'fill', source: 'estimates',
        paint: { 'fill-color': '#ff7850', 'fill-opacity': ['get', 'opacity'] } });
      // Simulated estimates get a yellow outline (the SIMULATED tag colour).
      map.addLayer({ id: 'est-line', type: 'line', source: 'estimates',
        paint: { 'line-color': ['case', ['get', 'simulated'], '#facc15', '#ff7850'],
          'line-width': ['case', ['get', 'selected'], 2.5, 1.2], 'line-dasharray': [2, 2] } });
      map.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#4ade80', 'line-width': 1.5, 'line-opacity': 0.7 } });
      map.addLayer({ id: 'hydrophones', type: 'circle', source: 'hydrophones',
        paint: { 'circle-radius': 5, 'circle-color': '#60a5fa', 'circle-stroke-color': '#0b101c', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'boats', type: 'circle', source: 'boats',
        paint: { 'circle-radius': 4.5, 'circle-color': ['case', ['get', 'inEstimate'], '#4ade80', '#6b7280'],
          'circle-stroke-color': ['case', ['get', 'simulated'], '#facc15', '#0b101c'],
          'circle-stroke-width': ['case', ['get', 'simulated'], 2, 1] } });
      (map.getSource('hydrophones') as GeoJSONSource).setData({ type: 'FeatureCollection', features: HYDROPHONES.map((h) => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [h.lon, h.lat] }, properties: { name: h.name } })) });
      loadedRef.current = true;
      map.fire('orca:data');
    });
    for (const layer of ['est-fill', 'boats']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
    map.on('click', 'boats', (e) => {
      const mmsi = Number(e.features?.[0]?.properties?.mmsi);
      if (mmsi) useLayoutStore.getState().select({ kind: 'boat', mmsi });
      e.preventDefault();
    });
    map.on('click', 'est-fill', (e) => {
      if (e.defaultPrevented) return;
      const id = e.features?.[0]?.properties?.id;
      if (id) useLayoutStore.getState().select({ kind: 'estimate', id: String(id) });
    });
    // Panels resize without a window resize; keep the canvas matched to them.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    mapRef.current = map;
    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
    };
  }, []);

  // ---------- data → layers ----------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const draw = () => {
      if (!loadedRef.current) return;
      const offline = status === 'offline';
      const ests = activeEstimates(byId);
      const sel = selection.kind === 'estimate' ? byId[selection.id] : null;
      const inEst = new Set(sel?.boats ?? ests.flatMap((e) => e.boats));
      (map.getSource('estimates') as GeoJSONSource).setData({ type: 'FeatureCollection',
        features: estimateFeatures(ests, sel?.id ?? null, offline) });
      (map.getSource('boats') as GeoJSONSource).setData({ type: 'FeatureCollection',
        features: boatFeatures(boats, inEst, BigInt(Date.now()) * 1_000_000n, BOAT_STALE_MIN) });
      const tr = selection.kind === 'boat' ? boats[selection.mmsi]?.track : null;
      (map.getSource('track') as GeoJSONSource).setData(tr && tr.length > 1
        ? { type: 'Feature', geometry: { type: 'LineString', coordinates: tr.map((t) => [t.lon, t.lat]) }, properties: {} }
        : EMPTY);
    };
    draw();
    map.on('orca:data', draw);
    return () => { map.off('orca:data', draw); };
  }, [byId, boats, selection, status]);

  // ---------- selection change → frame it (once per change; the user's pan wins after) ----------
  const selKey = selection.kind === 'estimate' ? `e:${selection.id}` : selection.kind === 'boat' ? `b:${selection.mmsi}` : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selKey) return;
    const { selection: sel } = useLayoutStore.getState();
    if (sel.kind === 'estimate') {
      const e = useEstimatesStore.getState().byId[sel.id];
      if (!e) return;
      const ring = circleRing(e, e.radiusM * 2.5, 8);
      const lons = ring.map((p) => p[0]);
      const lats = ring.map((p) => p[1]);
      map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { duration: 600, maxZoom: 13 });
    } else if (sel.kind === 'boat') {
      const b = useBoatsStore.getState().byMmsi[sel.mmsi];
      if (b) map.easeTo({ center: [b.pos.lon, b.pos.lat], zoom: Math.max(map.getZoom(), 11), duration: 600 });
    }
  }, [selKey]);

  return (
    <div className="pane pane-map">
      <div ref={containerRef} className="map-container" />
      {status === 'offline' && (
        <div className="offline-banner">Inference service offline — estimates may be stale</div>
      )}
      {selection.kind === 'source' && <span className="map-hint">
        orange = where whales probably are · green = boats watching · blue = hydrophones</span>}
    </div>
  );
}
