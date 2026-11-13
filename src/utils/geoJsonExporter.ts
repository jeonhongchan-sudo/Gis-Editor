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

  const features: any[] = [];
  
  // 1. Export Points
  points.forEach(p => {
    if (!p) return;
    const coords = projectPoint(p);
    const layerObj = layers.find(l => l.id === p.layerId);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords
      },
      properties: {
        id: p.id,
        name: p.name,
        title: p.name,
        TEXTSTRING: p.name,
        layer: getLayerName(p.layerId),
        layerId: p.layerId,
        dxftype: 'POINT',
        isSurveyNode: p.isSurveyNode,
        z: p.z !== undefined ? Number(p.z) : undefined,
        'marker-color': layerObj?.color || '#ef4444',
        'marker-size': 'medium',
        'marker-symbol': 'marker',
        ...(p.attributes || {})
      }
    });
  });

  // 2. Export Texts
  texts.forEach(t => {
    if (!t) return;
    const coords = projectPoint({ x: t.x, y: t.y });
    const layerObj = layers.find(l => l.id === t.layerId);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: coords
      },
      properties: {
        id: t.id,
        text: t.text,
        name: t.text,
        title: t.text,
        TEXTSTRING: t.text,
        height: t.height,
        rotation: t.rotation,
        layer: getLayerName(t.layerId),
        layerId: t.layerId,
        dxftype: 'TEXT',
        color: t.color,
        'marker-color': t.color || layerObj?.color || '#38bdf8',
        'marker-size': 'small',
        'marker-symbol': 'circle'
      }
    });
  });

  // 3. Export Lines
  lines.forEach(l => {
    if (!l || !l.start || !l.end) return;
    const layerObj = layers.find(lay => lay.id === l.layerId);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [projectPoint(l.start), projectPoint(l.end)]
      },
      properties: {
        id: l.id,
        name: l.name,
        title: l.name,
        layer: getLayerName(l.layerId),
        layerId: l.layerId,
        dxftype: 'LINE',
        'stroke': layerObj?.color || '#38bdf8',
        'stroke-width': 2,
        ...(l.attributes || {})
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
    const layerObj = layers.find(l => l.id === pl.layerId);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coords
      },
      properties: {
        id: pl.id,
        name: pl.name,
        title: pl.name,
        layer: getLayerName(pl.layerId),
        layerId: pl.layerId,
        dxftype: 'LWPOLYLINE',
        isClosed: pl.isClosed,
        'stroke': layerObj?.color || '#38bdf8',
        'stroke-width': 2,
        ...(pl.attributes || {})
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
    const layerObj = layers.find(l => l.id === pg.layerId);
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: coords
      },
      properties: {
        id: pg.id,
        name: pg.name,
        title: pg.name,
        layer: getLayerName(pg.layerId),
        layerId: pg.layerId,
        dxftype: 'LWPOLYLINE',
        isClosed: true,
        'stroke': layerObj?.color || '#38bdf8',
        'stroke-width': 2,
        ...(pg.attributes || {})
      }
    });
  });

  const geojson: any = {
    type: 'FeatureCollection',
    metadata: {
      generator: 'Web GIS/CAD App',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      layers: layers,
      crs: targetCrs || 'RAW_TM',
      sourceCrs: sourceCrs
    },
    features: features
  };

  return geojson;
}
