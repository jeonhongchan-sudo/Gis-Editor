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
  const { points, lines, polylines, polygons, texts, layers, crs } = options;

  const features: any[] = [];

  // 1. Export Points
  points.forEach(p => {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: p.z !== undefined ? [p.x, p.y, p.z] : [p.x, p.y]
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

  // 2. Export Texts (as Points with text properties)
  texts.forEach(t => {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Point',
        coordinates: [t.x, t.y]
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

  // 3. Export Lines (as LineStrings)
  lines.forEach(l => {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [l.start.x, l.start.y],
          [l.end.x, l.end.y]
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
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: pl.points.map(p => [p.x, p.y])
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
    const coords = pg.points.map(p => [p.x, p.y]);
    // Close the loop if not closed
    if (coords.length > 0 && (coords[0][0] !== coords[coords.length - 1][0] || coords[0][1] !== coords[coords.length - 1][1])) {
      coords.push([coords[0][0], coords[0][1]]);
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
      layers: layers // Store full layer definitions (colors, etc.)
    },
    features: features
  };

  // Standard CRS property for GIS compatibility if not standard WGS84
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
