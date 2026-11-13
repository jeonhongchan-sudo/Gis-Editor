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
}

/**
 * Converts internal CAD state into a GeoJSON FeatureCollection.
 * Includes layer metadata and all entity properties to serve as a robust project backup.
 */
export function exportToGeoJson(options: GeoJsonExportOptions): any {
  const { points = [], lines = [], polylines = [], polygons = [], texts = [], layers = [], targetCrs, sourceCrs } = options;

  const projectPoint = (p: Point2D): number[] => {
    if (targetCrs && sourceCrs && sourceCrs !== 'LOCAL') {
      const transformed = transformCoords(p.x, p.y, sourceCrs, targetCrs);
      return [
        Number(transformed.x.toFixed(8)),
        Number(transformed.y.toFixed(8))
      ];
    }
    return [p.x, p.y];
  };

  const getLayerName = (id: string): string => {
    const l = layers.find(lay => lay.id === id);
    if (l) return l.name;
    if (id.startsWith('layer-')) return id.replace(/^layer-/, '');
    return id || '0';
  };

  console.log(`Exporting GeoJSON: ${points.length} pts, ${lines.length} lines, ${polylines.length} pls, ${polygons.length} pgs, ${texts.length} txts (Target: ${targetCrs || 'RAW'})`);

  const REDUNDANT_OR_COLOR_KEYS = new Set([
    'id', 'name', 'title', 'text', 'textstring', 'layer', 'layerid',
    'dxftype', 'issurveynode', 'isclosed', 'z',
    'color', 'marker-color', 'stroke', 'stroke-width',
    'marker-size', 'marker-symbol', 'textheight', 'height'
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

  const normalizeMarkerSize = (val: unknown): 'minimum' | 'medium' | 'max' => {
    const s = String(val || '').trim().toLowerCase();
    if (s === 'minimum' || s === 'min' || s === 'small') return 'minimum';
    if (s === 'max' || s === 'maximum' || s === 'large') return 'max';
    return 'medium';
  };

  const features: any[] = [];
  
  // 1. Export Points
  points.forEach(p => {
    if (!p) return;
    const coords = projectPoint(p);
    const a = p.attributes || {};
    const textString = String(a.TEXTSTRING ?? a.textstring ?? p.name ?? '').trim();
    const rawHeight = Number(a.TEXTHEIGHT ?? a.textheight ?? a.HEIGHT ?? a.height);
    const textHeight = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;

    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords
      },
      properties: {
        id: p.id,
        TEXTSTRING: textString,
        layer: getLayerName(p.layerId),
        TEXTHEIGHT: textHeight,
        'marker-size': normalizeMarkerSize(a['marker-size']),
        'marker-symbol': String(a['marker-symbol'] || 'circle'),
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
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords
      },
      properties: {
        id: t.id,
        TEXTSTRING: t.text,
        TEXTHEIGHT: Number.isFinite(Number(t.height)) && t.height > 0 ? Number(t.height) : 1,
        rotation: t.rotation,
        layer: getLayerName(t.layerId),
        dxftype: 'TEXT',
        ...pickCustomAttributes(t.attributes)
      }
    });
  });

  // 3. Export Lines
  lines.forEach(l => {
    if (!l || !l.start || !l.end) return;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [projectPoint(l.start), projectPoint(l.end)]
      },
      properties: {
        id: l.id,
        name: l.name,
        layer: getLayerName(l.layerId),
        ...pickCustomAttributes(l.attributes)
      }
    });
  });

  // 4. Export Polylines
  polylines.forEach(pl => {
    if (!pl || !Array.isArray(pl.points) || pl.points.length < 2) return;
    const coords = pl.points.map(p => projectPoint(p));
    if (pl.isClosed && coords.length >= 2) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
      }
    }
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coords
      },
      properties: {
        id: pl.id,
        name: pl.name,
        layer: getLayerName(pl.layerId),
        ...(pl.isClosed ? { isClosed: true } : {}),
        ...pickCustomAttributes(pl.attributes)
      }
    });
  });

  // 5. Export Polygons as closed LineStrings (외곽선 기준 선으로 통일 출력)
  polygons.forEach(pg => {
    if (!pg || !Array.isArray(pg.points) || pg.points.length < 2) return;
    const coords = pg.points.map(p => projectPoint(p));
    if (coords.length > 0) {
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([first[0], first[1]]);
      }
    }
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coords
      },
      properties: {
        id: pg.id,
        name: pg.name,
        layer: getLayerName(pg.layerId),
        isClosed: true,
        ...pickCustomAttributes(pg.attributes)
      }
    });
  });

  const isWgs84 = targetCrs === 'EPSG:4326';
  const geojson: any = {
    type: 'FeatureCollection',
    metadata: {
      generator: 'Web GIS/CAD App',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      ...(isWgs84 ? {} : { layers: layers.map(({ color: _color, ...rest }) => rest) }),
      crs: targetCrs || 'RAW_TM',
      sourceCrs: sourceCrs
    },
    features: features
  };

  return geojson;
}
