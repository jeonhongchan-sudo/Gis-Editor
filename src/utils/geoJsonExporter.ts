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
      return [transformed.x, transformed.y];
    }
    return [p.x, p.y];
  };

  console.log(`Exporting GeoJSON: ${points.length} pts, ${lines.length} lines, ${polylines.length} pls, ${polygons.length} pgs, ${texts.length} txts (Target: ${targetCrs || 'RAW'})`);

  const features: any[] = [];
  
  // (Point, Text, Line, Polyline, Polygon loops remain same...)
  // 1. Export Points
  points.forEach(p => {
    if (!p) return;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [...projectPoint(p), ...(p.z !== undefined ? [Number(p.z) || 0] : [])]
      },
      properties: {
        id: p.id,
        name: p.name,
        TEXTSTRING: p.name,
        layer: layers.find(l => l.id === p.layerId)?.name || '0',
        layerId: p.layerId,
        dxftype: 'POINT',
        isSurveyNode: p.isSurveyNode,
        ...(p.attributes || {})
      }
    });
  });

  // 2. Export Texts
  texts.forEach(t => {
    if (!t) return;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: projectPoint({ x: t.x, y: t.y })
      },
      properties: {
        id: t.id,
        text: t.text,
        TEXTSTRING: t.text,
        height: t.height,
        rotation: t.rotation,
        layer: layers.find(l => l.id === t.layerId)?.name || '0',
        layerId: t.layerId,
        dxftype: 'TEXT',
        color: t.color
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
        coordinates: [
          projectPoint(l.start),
          projectPoint(l.end)
        ]
      },
      properties: {
        id: l.id,
        name: l.name,
        layer: layers.find(lay => lay.id === l.layerId)?.name || '0',
        layerId: l.layerId,
        dxftype: 'LINE',
        ...(l.attributes || {})
      }
    });
  });

  // 4. Export Polylines
  polylines.forEach(pl => {
    if (!pl || !Array.isArray(pl.points)) return;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: pl.points.map(p => projectPoint(p))
      },
      properties: {
        id: pl.id,
        name: pl.name,
        layer: layers.find(l => l.id === pl.layerId)?.name || '0',
        layerId: pl.layerId,
        dxftype: 'LWPOLYLINE',
        isClosed: pl.isClosed,
        ...(pl.attributes || {})
      }
    });
  });

  // 5. Export Polygons
  polygons.forEach(pg => {
    if (!pg || !Array.isArray(pg.points) || pg.points.length < 3) return;
    const coords = pg.points.map(p => projectPoint(p));
    // Ensure closed ring for standard GeoJSON
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
        type: 'Polygon',
        coordinates: [coords]
      },
      properties: {
        id: pg.id,
        name: pg.name,
        layer: layers.find(l => l.id === pg.layerId)?.name || '0',
        layerId: pg.layerId,
        dxftype: 'POLYGON',
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
