/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D } from '../types/cad';
import { SHPParseResult } from './shpParser';
import { transformCoords } from './projections';

const LAYER_COLORS = ['#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', '#60a5fa', '#f97316'];

/**
 * Parses GeoJSON and converts it into our internal CAD representation.
 * Supports source CRS transformation to local CAD coordinates (or standard EPSG:5186 etc.)
 */
export function parseGeoJson(
  json: any,
  sourceCrs: string = 'EPSG:4326',
  targetCrs: string = 'EPSG:5186'
): SHPParseResult {
  const points: CADPoint[] = [];
  const lines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];
  const texts: CADText[] = [];
  const layerMap = new Map<string, CADLayer>();

  const features = json.features || (json.type === 'Feature' ? [json] : []);

  features.forEach((feature: any, idx: number) => {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) return;

    // Determine layer name
    const layerName = props.layer || props.Layer || props.CADLayer || props.layername || '기본 레이어';
    if (!layerMap.has(layerName)) {
      layerMap.set(layerName, {
        id: `layer-${layerName.replace(/[\s\.]/g, '_')}`,
        name: layerName,
        color: LAYER_COLORS[layerMap.size % LAYER_COLORS.length],
        visible: true,
        locked: false,
        lineWidth: 2
      });
    }
    const layer = layerMap.get(layerName)!;

    // Coordinate transformation helper
    const getPoint = (coords: number[]): Point2D => {
      const [lng, lat] = coords;
      const transformed = transformCoords(lng, lat, sourceCrs, targetCrs);
      return {
        x: transformed.x,
        y: transformed.y,
        z: coords[2] // Preserve Z if present
      };
    };

    // Point or MultiPoint
    if (geom.type === 'Point') {
      const pt = getPoint(geom.coordinates);
      const name = props.TEXTSTRING || props.text || props.label || props.name || props.PT_NAME || `PT_${idx + 1}`;
      
      const cadPt: CADPoint = {
        id: `gj-pt-${Date.now()}-${idx}`,
        name,
        x: pt.x,
        y: pt.y,
        z: pt.z,
        layerId: layer.id,
        isSurveyNode: true
      };
      points.push(cadPt);

      // We do NOT create a separate CADText here because CADPoint already renders the label.
      // This prevents the user's reported "duplicated/ghost points" issue.
    } else if (geom.type === 'MultiPoint') {
      geom.coordinates.forEach((c: number[], subIdx: number) => {
        const pt = getPoint(c);
        points.push({
          id: `gj-mpt-${Date.now()}-${idx}-${subIdx}`,
          name: props.name || `MPT_${idx + 1}_${subIdx + 1}`,
          x: pt.x,
          y: pt.y,
          z: pt.z,
          layerId: layer.id,
          isSurveyNode: true
        });
      });
    }
    // LineString or MultiLineString
    else if (geom.type === 'LineString') {
      const pts = geom.coordinates.map((c: number[]) => getPoint(c));
      polylines.push({
        id: `gj-pl-${Date.now()}-${idx}`,
        name: props.name || `LINE_${idx + 1}`,
        points: pts,
        layerId: layer.id,
        attributes: props
      });
    } else if (geom.type === 'MultiLineString') {
      geom.coordinates.forEach((line: number[][], subIdx: number) => {
        const pts = line.map((c: number[]) => getPoint(c));
        polylines.push({
          id: `gj-mpl-${Date.now()}-${idx}-${subIdx}`,
          name: props.name || `MLINE_${idx + 1}_${subIdx + 1}`,
          points: pts,
          layerId: layer.id,
          attributes: props
        });
      });
    }
    // Polygon or MultiPolygon
    else if (geom.type === 'Polygon') {
      const outerRing = geom.coordinates[0];
      const pts = outerRing.map((c: number[]) => getPoint(c));
      polygons.push({
        id: `gj-pg-${Date.now()}-${idx}`,
        name: props.name || `POLY_${idx + 1}`,
        points: pts,
        layerId: layer.id,
        fillOpacity: 0.15
      });
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach((poly: number[][][], subIdx: number) => {
        const pts = poly[0].map((c: number[]) => getPoint(c));
        polygons.push({
          id: `gj-mpg-${Date.now()}-${idx}-${subIdx}`,
          name: props.name || `MPOLY_${idx + 1}_${subIdx + 1}`,
          points: pts,
          layerId: layer.id,
          fillOpacity: 0.15
        });
      });
    }
  });

  // Calculate bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  [...points, ...polylines.flatMap(p => p.points), ...polygons.flatMap(p => p.points)].forEach(p => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });

  return {
    points,
    lines,
    polylines,
    polygons,
    texts,
    layers: Array.from(layerMap.values()),
    layerName: json.name || 'GeoJSON 데이터',
    bounds: minX !== Infinity ? { minX, minY, maxX, maxY } : undefined
  };
}
