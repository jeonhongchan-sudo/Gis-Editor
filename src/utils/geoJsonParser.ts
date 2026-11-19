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
          id: l.id,
          name: l.name,
          color: l.color || LAYER_COLORS[layerMap.size % LAYER_COLORS.length],
          visible: l.visible !== undefined ? !!l.visible : true,
          locked: l.locked !== undefined ? !!l.locked : false,
          lineWidth: l.lineWidth || 2
        });
      }
    });
  }

  const STRIPPED_GEOJSON_ATTR_KEYS = new Set([
    'id', 'name', 'title', 'label', 'text', 'layer', 'layerid', 'dxftype',
    'issurveynode', 'isclosed', 'z', 'length_m', 'color', 'marker-color', 'stroke', 'stroke-width', 'stroke-opacity'
  ]);

  const normalizeMarkerSize = (val: unknown): 'minimum' | 'medium' | 'max' => {
    const s = String(val || '').trim().toLowerCase();
    if (s === 'minimum' || s === 'min' || s === 'small') return 'minimum';
    if (s === 'max' || s === 'maximum' || s === 'large') return 'max';
    return 'medium';
  };

  const cleanAttributes = (rawProps: Record<string, any>, pointLabel?: string): Record<string, string | number> => {
    const cleaned: Record<string, string | number> = {};
    Object.entries(rawProps).forEach(([k, v]) => {
      const lk = k.trim().toLowerCase();
      if (!k.trim() || STRIPPED_GEOJSON_ATTR_KEYS.has(lk) || v === undefined || v === null) return;
      if (lk === 'height' || lk === 'textheight' || lk === 'rotation') return; // Unified below for points
      if (lk === 'marker-size') {
        cleaned['marker-size'] = normalizeMarkerSize(v);
        return;
      }
      cleaned[k] = typeof v === 'number' || typeof v === 'string' ? v : String(v);
    });
    const rawRot = Number(rawProps.ROTATION ?? rawProps.rotation);
    if (Number.isFinite(rawRot)) {
      cleaned.ROTATION = Number(rawRot.toFixed(4));
    }
    if (pointLabel !== undefined) {
      cleaned.TEXTSTRING = String(rawProps.TEXTSTRING || pointLabel);
      if (!cleaned['marker-size']) cleaned['marker-size'] = 'medium';
      if (!cleaned['marker-symbol']) cleaned['marker-symbol'] = String(rawProps['marker-symbol'] || 'circle');
      const rawH = Number(rawProps.TEXTHEIGHT ?? rawProps.textheight ?? rawProps.HEIGHT ?? rawProps.height);
      cleaned.TEXTHEIGHT = Number.isFinite(rawH) && rawH > 0 ? rawH : 1;
    }
    return cleaned;
  };

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
    const getPoint = (coords: number[], includeZ = false): Point2D => {
      const [lng, lat] = coords;
      // transformCoords correctly handles cases where source/target are LOCAL or identical
      const transformed = transformCoords(lng, lat, sourceCrs, targetCrs);
      const rawZ = includeZ && coords[2] !== undefined && Number.isFinite(Number(coords[2]))
        ? Number(coords[2])
        : undefined;
      return rawZ !== undefined
        ? { x: transformed.x, y: transformed.y, z: rawZ }
        : { x: transformed.x, y: transformed.y };
    };

    const resolvePointZ = (pt: Point2D): number | undefined => {
      if (pt.z !== undefined && Number.isFinite(pt.z)) return pt.z;
      const propZ = Number(props.z);
      return props.z !== undefined && Number.isFinite(propZ) ? propZ : undefined;
    };

    // 1. Point Geometries
    if (geom.type === 'Point') {
      const pt = getPoint(geom.coordinates, true);
      const ptZ = resolvePointZ(pt);
      
      // Recognition logic: distinguish between a Text label and a Survey Point
      const dxftype = (props.dxftype || props.entity || '').toUpperCase();
      
      if (dxftype === 'TEXT') {
        const name = String(props.TEXTSTRING || props.text || props.title || props.label || props.name || `TXT_${idx + 1}`);
        points.push({
          id: props.id || `gj-pt-txt-${Date.now()}-${idx}`,
          name,
          x: pt.x,
          y: pt.y,
          z: ptZ,
          layerId: layer.id,
          isSurveyNode: true,
          attributes: cleanAttributes(props, name)
        });
      } else {
        const name = String(props.TEXTSTRING || props.text || props.title || props.label || props.name || props.PT_NAME || `PT_${idx + 1}`);

        points.push({
          id: props.id || `gj-pt-${Date.now()}-${idx}`,
          name,
          x: pt.x,
          y: pt.y,
          z: ptZ,
          layerId: layer.id,
          isSurveyNode: props.isSurveyNode !== undefined ? !!props.isSurveyNode : true,
          attributes: cleanAttributes(props, name)
        });
      }
    } 
    // 2. MultiPoint
    else if (geom.type === 'MultiPoint') {
      geom.coordinates.forEach((c: number[], subIdx: number) => {
        const pt = getPoint(c, true);
        const ptZ = resolvePointZ(pt);
        const mptName = String(props.TEXTSTRING || props.name || props.title || `MPT_${idx + 1}_${subIdx + 1}`);
        points.push({
          id: props.id ? `${props.id}_${subIdx}` : `gj-mpt-${Date.now()}-${idx}-${subIdx}`,
          name: mptName,
          x: pt.x,
          y: pt.y,
          z: ptZ,
          layerId: layer.id,
          isSurveyNode: true,
          attributes: cleanAttributes(props, mptName)
        });
      });
    }
    // 3. Line Geometries (strictly 2D)
    else if (geom.type === 'LineString') {
      const pts = geom.coordinates.map((c: number[]) => getPoint(c, false));
      const isClosed = !!props.isClosed;
      if (isClosed && pts.length >= 2) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (first.x !== last.x || first.y !== last.y) {
          pts.push({ ...first });
        }
      }
      polylines.push({
        id: props.id || `gj-pl-${Date.now()}-${idx}`,
        name: props.NAME || props.name || props.title || `LINE_${idx + 1}`,
        points: pts,
        layerId: layer.id,
        isClosed,
        attributes: cleanAttributes(props)
      });
    } else if (geom.type === 'MultiLineString') {
      geom.coordinates.forEach((line: number[][], subIdx: number) => {
        const pts = line.map((c: number[]) => getPoint(c));
        polylines.push({
          id: props.id ? `${props.id}_${subIdx}` : `gj-mpl-${Date.now()}-${idx}-${subIdx}`,
          name: props.NAME || props.name || props.title || `MLINE_${idx + 1}_${subIdx + 1}`,
          points: pts,
          layerId: layer.id,
          attributes: cleanAttributes(props)
        });
      });
    }
    // 4. Polygon Geometries -> 외곽선 기준 선(Polyline)으로 변환
    else if (geom.type === 'Polygon') {
      const rings: number[][][] = Array.isArray(geom.coordinates) ? geom.coordinates : [];
      rings.forEach((ring: number[][], ringIdx: number) => {
        if (Array.isArray(ring) && ring.length >= 2) {
          const pts = ring.map((c: number[]) => getPoint(c));
          const first = pts[0];
          const last = pts[pts.length - 1];
          if (first.x !== last.x || first.y !== last.y) {
            pts.push({ ...first });
          }
          const baseName = props.NAME || props.name || props.title || `외곽선_${idx + 1}`;
          polylines.push({
            id: props.id
              ? (ringIdx === 0 ? `${props.id}` : `${props.id}_ring${ringIdx}`)
              : `gj-pgline-${Date.now()}-${idx}-${ringIdx}`,
            name: ringIdx === 0 ? baseName : `${baseName}_내부${ringIdx}`,
            points: pts,
            layerId: layer.id,
            isClosed: true,
            attributes: cleanAttributes(props)
          });
        }
      });
    } else if (geom.type === 'MultiPolygon') {
      const polys: number[][][][] = Array.isArray(geom.coordinates) ? geom.coordinates : [];
      polys.forEach((poly: number[][][], subIdx: number) => {
        if (!Array.isArray(poly)) return;
        poly.forEach((ring: number[][], ringIdx: number) => {
          if (Array.isArray(ring) && ring.length >= 2) {
            const pts = ring.map((c: number[]) => getPoint(c));
            const first = pts[0];
            const last = pts[pts.length - 1];
            if (first.x !== last.x || first.y !== last.y) {
              pts.push({ ...first });
            }
            const baseName = props.NAME || props.name || props.title || `외곽선_${idx + 1}_${subIdx + 1}`;
            polylines.push({
              id: props.id
                ? (ringIdx === 0 ? `${props.id}_${subIdx}` : `${props.id}_${subIdx}_ring${ringIdx}`)
                : `gj-mpgline-${Date.now()}-${idx}-${subIdx}-${ringIdx}`,
              name: ringIdx === 0 ? baseName : `${baseName}_내부${ringIdx}`,
              points: pts,
              layerId: layer.id,
              isClosed: true,
              attributes: cleanAttributes(props)
            });
          }
        });
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
