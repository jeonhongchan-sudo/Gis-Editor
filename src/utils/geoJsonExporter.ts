/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText } from '../types/cad';

interface GeoJsonExportOptions {
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  layers: CADLayer[];
  crs?: string;
}

/**
 * Converts internal CAD state into a GeoJSON FeatureCollection.
 * Includes layer metadata and all entity properties to serve as a robust project backup.
 */
export function exportToGeoJson(options: GeoJsonExportOptions): any {
  const { points = [], lines = [], polylines = [], polygons = [], texts = [], layers = [], crs } = options;

  console.log(`Exporting GeoJSON: ${points.length} pts, ${lines.length} lines, ${polylines.length} pls, ${polygons.length} pgs, ${texts.length} txts`);

  const features: any[] = [];

  // 1. Export Points
  points.forEach(p => {
    if (!p) return;
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [Number(p.x) || 0, Number(p.y) || 0, ...(p.z !== undefined ? [Number(p.z) || 0] : [])]
      },
      properties: {
        id: p.id,
        name: p.name,
        TEXTSTRING: p.name,
        layer: layers.find(l => l.id === p.layerId)?.name || '0',
        layerId: p.layerId,
        dxftype: 'POINT',
        isSurveyNode: p.isSurveyNode
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
        coordinates: [Number(t.x) || 0, Number(t.y) || 0]
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
          [Number(l.start.x) || 0, Number(l.start.y) || 0],
          [Number(l.end.x) || 0, Number(l.end.y) || 0]
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
        coordinates: pl.points.map(p => [Number(p.x) || 0, Number(p.y) || 0])
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
    const coords = pg.points.map(p => [Number(p.x) || 0, Number(p.y) || 0]);
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
        dxftype: 'POLYGON'
      }
    });
  });

  const geojson: any = {
    type: 'FeatureCollection',
    metadata: {
      generator: 'Web GIS/CAD App',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      layers: layers
    },
    features: features
  };

  if (crs && crs !== 'EPSG:4326') {
    geojson.crs = {
      type: 'name',
      properties: {
        name: `urn:ogc:def:crs:EPSG::${crs.replace('EPSG:', '')}`
      }
    };
  }

  return geojson;
}
