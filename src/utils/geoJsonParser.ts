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

  // 0. Pre-load layers from metadata if this is one of our backups
  // We identify our backups via the metadata.generator field
  const isOurBackup = json.metadata?.generator === 'Web GIS/CAD App';
  const metaLayers = json.metadata?.layers;
  
  if (isOurBackup && Array.isArray(metaLayers)) {
    metaLayers.forEach((l: any) => {
      if (l && typeof l === 'object' && l.id && l.name) {
        layerMap.set(l.name, {
          ...l,
          visible: l.visible ?? true,
          locked: l.locked ?? false
        });
      }
    });
  }

  const features = json.features || (json.type === 'Feature' ? [json] : []);

  features.forEach((feature: any, idx: number) => {
    const props = feature.properties || {};
    const geom = feature.geometry;
    if (!geom) return;

    // Determine layer name (fallback to default)
    const layerName = props.layer || props.Layer || props.CADLayer || props.layername || '기본 레이어';
    
    if (!layerMap.has(layerName)) {
      layerMap.set(layerName, {
        id: props.layerId || `layer-${layerName.replace(/[\s\.]/g, '_')}`,
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
      // transformCoords correctly handles cases where source/target are LOCAL or identical
      const transformed = transformCoords(lng, lat, sourceCrs, targetCrs);
      return {
        x: transformed.x,
        y: transformed.y,
        z: coords[2] // Preserve Z if present
      };
    };

    // 1. Point Geometries
    if (geom.type === 'Point') {
      const pt = getPoint(geom.coordinates);
      
      // Recognition logic: distinguish between a Text label and a Survey Point
      const dxftype = (props.dxftype || props.entity || '').toUpperCase();
      
      if (dxftype === 'TEXT') {
        // Create Text Entity
        const textEntity: CADText = {
          id: props.id || `gj-txt-${Date.now()}-${idx}`,
          x: pt.x,
          y: pt.y,
          text: props.text || props.TEXTSTRING || '',
          height: Number(props.height || props.TEXT_SIZE || 2.0),
          rotation: Number(props.rotation || props.TEXT_ANGLE || 0),
          layerId: layer.id,
          color: props.color
        };
        texts.push(textEntity);

        // ALSO create a CADPoint if it looks like a survey station (requested by user)
        if (props.TEXTSTRING || props.text) {
          points.push({
            id: props.id ? `pt-${props.id}` : `gj-pt-txt-${Date.now()}-${idx}`,
            name: String(props.TEXTSTRING || props.text),
            x: pt.x,
            y: pt.y,
            z: pt.z,
            layerId: layer.id,
            isSurveyNode: true
          });
        }
      } else {
        const name = props.TEXTSTRING || props.text || props.label || props.name || props.PT_NAME || `PT_${idx + 1}`;
        points.push({
          id: props.id || `gj-pt-${Date.now()}-${idx}`,
          name: String(name),
          x: pt.x,
          y: pt.y,
          z: pt.z,
          layerId: layer.id,
          isSurveyNode: props.isSurveyNode !== undefined ? !!props.isSurveyNode : true
        });
      }
    } 
    // 2. MultiPoint
    else if (geom.type === 'MultiPoint') {
      geom.coordinates.forEach((c: number[], subIdx: number) => {
        const pt = getPoint(c);
        points.push({
          id: props.id ? `${props.id}_${subIdx}` : `gj-mpt-${Date.now()}-${idx}-${subIdx}`,
          name: props.name || `MPT_${idx + 1}_${subIdx + 1}`,
          x: pt.x,
          y: pt.y,
          z: pt.z,
          layerId: layer.id,
          isSurveyNode: true
        });
      });
    }
    // 3. Line Geometries
    else if (geom.type === 'LineString') {
      const pts = geom.coordinates.map((c: number[]) => getPoint(c));
      polylines.push({
        id: props.id || `gj-pl-${Date.now()}-${idx}`,
        name: props.name || `LINE_${idx + 1}`,
        points: pts,
        layerId: layer.id,
        isClosed: !!props.isClosed,
        attributes: props
      });
    } else if (geom.type === 'MultiLineString') {
      geom.coordinates.forEach((line: number[][], subIdx: number) => {
        const pts = line.map((c: number[]) => getPoint(c));
        polylines.push({
          id: props.id ? `${props.id}_${subIdx}` : `gj-mpl-${Date.now()}-${idx}-${subIdx}`,
          name: props.name || `MLINE_${idx + 1}_${subIdx + 1}`,
          points: pts,
          layerId: layer.id,
          attributes: props
        });
      });
    }
    // 4. Polygon Geometries
    else if (geom.type === 'Polygon') {
      const outerRing = geom.coordinates[0];
      if (Array.isArray(outerRing) && outerRing.length >= 3) {
        const pts = outerRing.map((c: number[]) => getPoint(c));
        // Remove trailing duplicate if it exists (CAD polygons are point lists)
        const first = pts[0];
        const last = pts[pts.length - 1];
        const displayPts = (first.x === last.x && first.y === last.y && pts.length > 2) ? pts.slice(0, -1) : pts;
        
        polygons.push({
          id: props.id || `gj-pg-${Date.now()}-${idx}`,
          name: props.name || `POLY_${idx + 1}`,
          points: displayPts,
          layerId: layer.id,
          fillOpacity: 0.15
        });
      }
    } else if (geom.type === 'MultiPolygon') {
      geom.coordinates.forEach((poly: number[][][], subIdx: number) => {
        const outerRing = poly[0];
        if (Array.isArray(outerRing) && outerRing.length >= 3) {
          const pts = outerRing.map((c: number[]) => getPoint(c));
          const first = pts[0];
          const last = pts[pts.length - 1];
          const displayPts = (first.x === last.x && first.y === last.y && pts.length > 2) ? pts.slice(0, -1) : pts;
          
          polygons.push({
            id: props.id ? `${props.id}_${subIdx}` : `gj-mpg-${Date.now()}-${idx}-${subIdx}`,
            name: props.name || `MPOLY_${idx + 1}_${subIdx + 1}`,
            points: displayPts,
            layerId: layer.id,
            fillOpacity: 0.15
          });
        }
      });
    }
  });

  // Calculate bounds for auto-zoom
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  [...points, ...polylines.flatMap(p => p.points), ...polygons.flatMap(p => p.points), ...texts].forEach(p => {
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
    layerName: json.metadata?.name || json.name || 'GeoJSON 데이터',
    bounds: minX !== Infinity ? { minX, minY, maxX, maxY } : undefined
  };
}
