/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D } from '../types/cad';
import { transformCoords } from './projections';

interface GeoJsonExportOptions {
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  layers: CADLayer[];
  targetCrs?: string; // e.g. "EPSG:4326" for WGS84
  sourceCrs?: string; // The TM CRS to convert from
  applyLinearZ?: boolean; // Include Z on linear features when checked (default: false)
}

function normalizeHexColor(val: unknown, fallback = '#38bdf8'): string {
  if (typeof val !== 'string') return fallback;
  const trimmed = val.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    const r = trimmed[1], g = trimmed[2], b = trimmed[3];
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return fallback;
}

function calcPlanarLength(pts: Point2D[]): number {
  let len = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    if (Number.isFinite(dx) && Number.isFinite(dy)) {
      len += Math.hypot(dx, dy);
    }
  }
  return len;
}

/**
 * Converts internal CAD state into a GeoJSON FeatureCollection.
 * - Backup mode (!targetCrs): preserves full internal CAD/layer metadata for round-trip restore.
 * - Map mode (targetCrs === 'EPSG:4326'): produces clean RFC 7946 2D GeoJSON with standard
 *   label fields (name, title, label, TEXTSTRING) and Simplestyle properties (marker-color,
 *   marker-size, marker-symbol, stroke, stroke-width) so mobile GIS & web map apps render
 *   points, text labels, and colored lines immediately on upload.
 */
export function exportToGeoJson(options: GeoJsonExportOptions): any {
  const {
    points = [],
    lines = [],
    polylines = [],
    polygons = [],
    texts = [],
    layers = [],
    targetCrs,
    sourceCrs,
    applyLinearZ = false
  } = options;

  const isWgs84 = targetCrs === 'EPSG:4326';
  const layerById = new Map(layers.map(lay => [lay.id, lay]));

  const projectPoint = (p: Point2D, includeZ = true): number[] | null => {
    if (!Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return null;
    const zVal = includeZ && p.z !== undefined && Number.isFinite(Number(p.z)) ? Number(p.z) : undefined;
    if (targetCrs && sourceCrs && sourceCrs !== 'LOCAL') {
      const transformed = transformCoords(p.x, p.y, sourceCrs, targetCrs);
      if (!Number.isFinite(transformed.x) || !Number.isFinite(transformed.y)) return null;
      if (isWgs84 && (Math.abs(transformed.x) > 180 || Math.abs(transformed.y) > 90)) {
        return null;
      }
      const lng = Number(transformed.x.toFixed(8));
      const lat = Number(transformed.y.toFixed(8));
      // For WGS84 map apps, emit standard 2D [lng, lat] (z is preserved in properties)
      return !isWgs84 && zVal !== undefined ? [lng, lat, zVal] : [lng, lat];
    }
    return !isWgs84 && zVal !== undefined ? [p.x, p.y, zVal] : [p.x, p.y];
  };

  const getLayerName = (id: string): string => {
    const l = layerById.get(id);
    if (l) return l.name;
    if (id.startsWith('layer-')) return id.replace(/^layer-/, '');
    return id || '0';
  };

  const getLayerColor = (id: string, entityColor?: unknown): string => {
    return normalizeHexColor(entityColor, normalizeHexColor(layerById.get(id)?.color, '#38bdf8'));
  };

  const getLayerLineWidth = (id: string): number => {
    const w = layerById.get(id)?.lineWidth;
    return typeof w === 'number' && Number.isFinite(w) && w > 0 ? w : 2;
  };

  const REDUNDANT_OR_COLOR_KEYS = new Set([
    'id', 'name', 'title', 'label', 'text', 'textstring', 'layer', 'layerid',
    'dxftype', 'issurveynode', 'isclosed', 'z', 'length_m',
    'color', 'marker-color', 'stroke', 'stroke-width', 'stroke-opacity',
    'marker-size', 'marker-symbol', 'textheight', 'height', 'rotation'
  ]);

  const pickCustomAttributes = (attrs?: Record<string, string | number>) => {
    const clean: Record<string, string | number> = {};
    if (!attrs) return clean;
    Object.entries(attrs).forEach(([k, v]) => {
      if (!REDUNDANT_OR_COLOR_KEYS.has(k.trim().toLowerCase()) && v !== undefined && v !== null) {
        clean[k] = v;
      }
    });
    return clean;
  };

  const normalizeInternalMarkerSize = (val: unknown): 'minimum' | 'medium' | 'max' => {
    const s = String(val || '').trim().toLowerCase();
    if (s === 'minimum' || s === 'min' || s === 'small') return 'minimum';
    if (s === 'max' || s === 'maximum' || s === 'large') return 'max';
    return 'medium';
  };

  const normalizeSimplestyleMarkerSize = (val: unknown): 'small' | 'medium' | 'large' => {
    const s = String(val || '').trim().toLowerCase();
    if (s === 'minimum' || s === 'min' || s === 'small') return 'small';
    if (s === 'max' || s === 'maximum' || s === 'large') return 'large';
    return 'medium';
  };

  const features: any[] = [];

  // 1. Export Points (including DXF/SHP text points)
    points.forEach(p => {
      if (!p) return;
      const coords = projectPoint(p);
      if (!coords) return;
      const a = p.attributes || {};
      const rawText = String(a.TEXTSTRING ?? a.textstring ?? '').trim();
      const textString = rawText || String(p.name ?? '').trim();
      const rawHeight = Number(a.TEXTHEIGHT ?? a.textheight ?? a.HEIGHT ?? a.height);
      const textHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
      const rawRotation = Number(a.ROTATION ?? a.rotation);
      const rotation = Number.isFinite(rawRotation) ? Number(rawRotation.toFixed(4)) : 0;
      const layerName = getLayerName(p.layerId);
      const markerColor = getLayerColor(p.layerId, p.color ?? a['marker-color'] ?? a.color);
      const markerSymbol = String(a['marker-symbol'] || 'circle');

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: coords
        },
        properties: isWgs84
          ? {
              id: p.id,
              name: textString || layerName,
              title: textString || layerName,
              label: textString,
              TEXTSTRING: textString,
              layer: layerName,
              TEXTHEIGHT: textHeight,
              ROTATION: rotation,
              'marker-color': markerColor,
              'marker-size': normalizeSimplestyleMarkerSize(a['marker-size']),
              'marker-symbol': markerSymbol,
              ...(p.z !== undefined && Number.isFinite(Number(p.z)) ? { z: Number(p.z) } : {}),
              ...pickCustomAttributes(a)
            }
          : {
              id: p.id,
              TEXTSTRING: textString,
              layer: layerName,
              layerId: p.layerId,
              TEXTHEIGHT: textHeight,
              ROTATION: rotation,
              'marker-color': markerColor,
              'marker-size': normalizeInternalMarkerSize(a['marker-size']),
              'marker-symbol': markerSymbol,
              ...(p.color ? { color: normalizeHexColor(p.color, markerColor) } : {}),
              ...(p.z !== undefined && Number.isFinite(Number(p.z)) ? { z: Number(p.z) } : {}),
              ...(p.isSurveyNode !== undefined ? { isSurveyNode: p.isSurveyNode } : {}),
              ...pickCustomAttributes(a)
            }
      });
    });

    // 2. Export Texts
    texts.forEach(t => {
      if (!t) return;
      const coords = projectPoint({ x: t.x, y: t.y });
      if (!coords) return;
      const layerName = getLayerName(t.layerId);
      const textLabel = String(t.text ?? '').trim();
      const textHeight = Number.isFinite(Number(t.height)) && t.height > 0 ? Number(t.height) : 1;
      const rotation = Number.isFinite(Number(t.rotation)) ? Number(Number(t.rotation).toFixed(4)) : 0;
      const markerColor = getLayerColor(t.layerId, t.color);

      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: coords
        },
        properties: isWgs84
          ? {
              id: t.id,
              name: textLabel || layerName,
              title: textLabel || layerName,
              label: textLabel,
              TEXTSTRING: textLabel,
              TEXTHEIGHT: textHeight,
              ROTATION: rotation,
              layer: layerName,
              'marker-color': markerColor,
              'marker-size': 'small',
              'marker-symbol': 'circle',
              dxftype: 'TEXT',
              ...pickCustomAttributes(t.attributes)
            }
          : {
              id: t.id,
              TEXTSTRING: textLabel,
              TEXTHEIGHT: textHeight,
              rotation: t.rotation,
              layer: layerName,
              layerId: t.layerId,
              'marker-color': markerColor,
              ...(t.color ? { color: normalizeHexColor(t.color, markerColor) } : {}),
              dxftype: 'TEXT',
              ...pickCustomAttributes(t.attributes)
            }
      });
  });

  // 3. Export Lines
    lines.forEach(l => {
      if (!l || !l.start || !l.end) return;
      const c1 = projectPoint(l.start, applyLinearZ);
      const c2 = projectPoint(l.end, applyLinearZ);
      if (!c1 || !c2) return;
      const layerName = getLayerName(l.layerId);
      const lineName = String(l.name || '').trim() || layerName;
      const stroke = getLayerColor(l.layerId, l.color);
      const strokeWidth = getLayerLineWidth(l.layerId);
      const lengthM = Number(calcPlanarLength([l.start, l.end]).toFixed(3));

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [c1, c2]
        },
        properties: isWgs84
          ? {
              id: l.id,
              name: lineName,
              title: lineName,
              layer: layerName,
              length_m: lengthM,
              stroke,
              'stroke-width': strokeWidth,
              'stroke-opacity': 1,
              ...pickCustomAttributes(l.attributes)
            }
          : {
              id: l.id,
              name: l.name,
              layer: layerName,
              layerId: l.layerId,
              stroke,
              'stroke-width': strokeWidth,
              ...(l.color ? { color: normalizeHexColor(l.color, stroke) } : {}),
              ...pickCustomAttributes(l.attributes)
            }
      });
    });

    // 4. Export Polylines
    polylines.forEach(pl => {
      if (!pl || !Array.isArray(pl.points) || pl.points.length < 2) return;
      const coords = pl.points.map(pt => projectPoint(pt, applyLinearZ)).filter((c): c is number[] => c !== null);
      if (coords.length < 2) return;
      if (pl.isClosed && coords.length >= 2) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([...first]);
        }
      }
      const layerName = getLayerName(pl.layerId);
      const lineName = String(pl.name || '').trim() || layerName;
      const stroke = getLayerColor(pl.layerId, pl.color);
      const strokeWidth = getLayerLineWidth(pl.layerId);
      const metricPts = pl.isClosed && pl.points.length >= 2
        ? [...pl.points, pl.points[0]]
        : pl.points;
      const lengthM = Number(calcPlanarLength(metricPts).toFixed(3));

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords
        },
        properties: isWgs84
          ? {
              id: pl.id,
              name: lineName,
              title: lineName,
              layer: layerName,
              length_m: lengthM,
              stroke,
              'stroke-width': strokeWidth,
              'stroke-opacity': 1,
              ...(pl.isClosed ? { isClosed: true } : {}),
              ...pickCustomAttributes(pl.attributes)
            }
          : {
              id: pl.id,
              name: pl.name,
              layer: layerName,
              layerId: pl.layerId,
              stroke,
              'stroke-width': strokeWidth,
              ...(pl.color ? { color: normalizeHexColor(pl.color, stroke) } : {}),
              ...(pl.isClosed ? { isClosed: true } : {}),
              ...pickCustomAttributes(pl.attributes)
            }
      });
    });

    // 5. Export Polygons as closed LineStrings (외곽선 기준 선으로 통일 출력)
    polygons.forEach(pg => {
      if (!pg || !Array.isArray(pg.points) || pg.points.length < 2) return;
      const coords = pg.points.map(pt => projectPoint(pt, applyLinearZ)).filter((c): c is number[] => c !== null);
      if (coords.length < 2) return;
      if (coords.length > 0) {
        const first = coords[0];
        const last = coords[coords.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) {
          coords.push([...first]);
        }
      }
      const layerName = getLayerName(pg.layerId);
      const polyName = String(pg.name || '').trim() || layerName;
      const stroke = getLayerColor(pg.layerId, pg.color);
      const strokeWidth = getLayerLineWidth(pg.layerId);
      const lengthM = Number(calcPlanarLength([...pg.points, pg.points[0]]).toFixed(3));

      features.push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: coords
        },
        properties: isWgs84
          ? {
              id: pg.id,
              name: polyName,
              title: polyName,
              layer: layerName,
              length_m: lengthM,
              stroke,
              'stroke-width': strokeWidth,
              'stroke-opacity': 1,
              isClosed: true,
              ...pickCustomAttributes(pg.attributes)
            }
          : {
              id: pg.id,
              name: pg.name,
              layer: layerName,
              layerId: pg.layerId,
              stroke,
              'stroke-width': strokeWidth,
              ...(pg.color ? { color: normalizeHexColor(pg.color, stroke) } : {}),
              isClosed: true,
              ...pickCustomAttributes(pg.attributes)
            }
    });
  });

  if (isWgs84) {
    return {
      type: 'FeatureCollection',
      features
    };
  }

  return {
    type: 'FeatureCollection',
    metadata: {
      generator: 'Web GIS/CAD App',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      layers: layers.map(l => ({
        ...l,
        color: normalizeHexColor(l.color, '#38bdf8')
      })),
      crs: 'RAW_TM',
      sourceCrs
    },
    features
  };
}
