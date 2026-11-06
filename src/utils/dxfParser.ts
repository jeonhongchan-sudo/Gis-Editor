/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import DxfParser from 'dxf-parser';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D } from '../types/cad';
import { SHPParseResult } from './shpParser';

const LAYER_COLORS = ['#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', '#60a5fa', '#f97316'];

/**
 * Parses a DXF file and converts it into our internal CAD representation.
 * Focuses on POINT, LINE, LWPOLYLINE, and TEXT entities as requested.
 */
export function parseDxf(dxfString: string, filename: string): SHPParseResult {
  const parser = new DxfParser();
  let dxf: any;
  
  try {
    dxf = parser.parseSync(dxfString);
  } catch (err: any) {
    throw new Error(`DXF 파싱 실패: ${err.message}`);
  }

  const points: CADPoint[] = [];
  const lines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];
  const texts: CADText[] = [];
  const layerMap = new Map<string, CADLayer>();

  // 1. Process Layers from Header/Tables if available
  if (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) {
    Object.values(dxf.tables.layer.layers).forEach((l: any) => {
      if (!l.name) return;
      layerMap.set(l.name, {
        id: `layer-${l.name.replace(/[\s\.]/g, '_')}`,
        name: l.name,
        color: l.color ? `#${l.color.toString(16).padStart(6, '0')}` : LAYER_COLORS[layerMap.size % LAYER_COLORS.length],
        visible: true,
        locked: false,
        lineWidth: 2
      });
    });
  }

  const getLayer = (name: string): CADLayer => {
    const layerName = name || '0';
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
    return layerMap.get(layerName)!;
  };

  const now = Date.now();

  const surveyPointMap = new Map<string, CADPoint>();

  // 2. Process Entities
  if (dxf.entities && Array.isArray(dxf.entities)) {
    dxf.entities.forEach((ent: any, idx: number) => {
      const layer = getLayer(ent.layer);
      
      switch (ent.type) {
        case 'POINT': {
          const pos = ent.position || ent.startPoint || { x: 0, y: 0 };
          const x = Number(pos.x);
          const y = Number(pos.y);
          if (isNaN(x) || isNaN(y)) break;

          // Coordinate key for deduplication (1mm precision)
          const coordKey = `${x.toFixed(3)},${y.toFixed(3)}`;

          // Try to find meaningful name, code, remark in attributes
          let ptName = (ent.name || ent.text || ent.textString || '').trim();
          let ptCode = '';
          let ptRemark = '';

          if (ent.attributes && Array.isArray(ent.attributes)) {
            const nameAttr = ent.attributes.find((a: any) => ['PN', 'NAME', 'ID', '측점', 'NO', 'POINT'].includes((a.tag || '').toUpperCase()));
            const codeAttr = ent.attributes.find((a: any) => ['CD', 'CODE', '지목', '코드'].includes((a.tag || '').toUpperCase()));
            const remarkAttr = ent.attributes.find((a: any) => ['RM', 'REMARK', 'NOTE', '비고', 'DESC', '설명'].includes((a.tag || '').toUpperCase()));
            
            if (nameAttr) ptName = (nameAttr.text || nameAttr.value || '').trim();
            if (codeAttr) ptCode = (codeAttr.text || codeAttr.value || '').trim();
            if (remarkAttr) ptRemark = (remarkAttr.text || remarkAttr.value || '').trim();
          }

          if (!ptName) ptName = `PT_${idx + 1}`;

          // Only add if not already present at this exact spot
          if (!surveyPointMap.has(coordKey)) {
            surveyPointMap.set(coordKey, {
              id: `dxf-pt-${now}-${idx}`,
              name: ptName,
              code: ptCode,
              remark: ptRemark,
              x,
              y,
              z: pos.z !== undefined ? Number(pos.z) : undefined,
              layerId: layer.id,
              isSurveyNode: true
            });
          }
          break;
        }

        case 'INSERT': {
          const pos = ent.position || { x: 0, y: 0 };
          const x = Number(pos.x);
          const y = Number(pos.y);
          if (isNaN(x) || isNaN(y)) break;

          const coordKey = `${x.toFixed(3)},${y.toFixed(3)}`;

          let ptName = '';
          let ptCode = '';
          let ptRemark = '';

          if (ent.attributes && Array.isArray(ent.attributes)) {
            const nameAttr = ent.attributes.find((a: any) => ['PN', 'NAME', 'ID', '측점', 'NO', 'POINT'].includes((a.tag || '').toUpperCase()));
            const codeAttr = ent.attributes.find((a: any) => ['CD', 'CODE', '지목', '코드'].includes((a.tag || '').toUpperCase()));
            const remarkAttr = ent.attributes.find((a: any) => ['RM', 'REMARK', 'NOTE', '비고', 'DESC', '설명'].includes((a.tag || '').toUpperCase()));
            
            if (nameAttr) ptName = (nameAttr.text || nameAttr.value || '').trim();
            if (codeAttr) ptCode = (codeAttr.text || codeAttr.value || '').trim();
            if (remarkAttr) ptRemark = (remarkAttr.text || remarkAttr.value || '').trim();
          }

          if (!ptName) ptName = (ent.name || ent.block || `BLOCK_${idx + 1}`).trim();

          // Only add or update name if current is generic
          const existing = surveyPointMap.get(coordKey);
          if (!existing || existing.name.startsWith('PT_') || existing.name.startsWith('BLOCK_')) {
            surveyPointMap.set(coordKey, {
              id: `dxf-ins-${now}-${idx}`,
              name: ptName,
              code: ptCode,
              remark: ptRemark,
              x,
              y,
              z: pos.z !== undefined ? Number(pos.z) : undefined,
              layerId: layer.id,
              isSurveyNode: true
            });
          }
          break;
        }

        case 'LINE':
          if (ent.vertices && ent.vertices.length >= 2) {
            const x1 = Number(ent.vertices[0].x);
            const y1 = Number(ent.vertices[0].y);
            const x2 = Number(ent.vertices[1].x);
            const y2 = Number(ent.vertices[1].y);
            if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) break;

            lines.push({
              id: `dxf-ln-${now}-${idx}`,
              start: { x: x1, y: y1 },
              end: { x: x2, y: y2 },
              layerId: layer.id,
              name: (ent.name || `LINE_${idx + 1}`).trim()
            });
          }
          break;

        case 'LWPOLYLINE':
        case 'POLYLINE':
          const pts: Point2D[] = (ent.vertices || [])
            .map((v: any) => ({
              x: Number(v.x),
              y: Number(v.y),
              z: v.z !== undefined ? Number(v.z) : undefined
            }))
            .filter((p: Point2D) => !isNaN(p.x) && !isNaN(p.y));
          
          if (pts.length >= 2) {
            const isClosed = !!ent.shape || (pts.length > 2 && pts[0].x === pts[pts.length-1].x && pts[0].y === pts[pts.length-1].y);
            
            if (isClosed && pts.length >= 3) {
              polygons.push({
                id: `dxf-pg-${now}-${idx}`,
                name: (ent.name || `POLY_${idx + 1}`).trim(),
                points: pts,
                layerId: layer.id,
                fillOpacity: 0.15
              });
            } else {
              polylines.push({
                id: `dxf-pl-${now}-${idx}`,
                name: (ent.name || `PLINE_${idx + 1}`).trim(),
                points: pts,
                layerId: layer.id,
                isClosed
              });
            }
          }
          break;

        case 'TEXT':
        case 'MTEXT': {
          const textStr = (ent.text || ent.textString || '').trim();
          const pos = ent.position || ent.startPoint || ent.insertionPoint || (ent.columnAt ? { x: ent.columnAt[0], y: ent.columnAt[1] } : { x: 0, y: 0 });
          const tx = Number(pos.x ?? 0);
          const ty = Number(pos.y ?? 0);
          const tz = pos.z !== undefined ? Number(pos.z) : undefined;
          if (isNaN(tx) || isNaN(ty)) break;

          const coordKey = `${tx.toFixed(3)},${ty.toFixed(3)}`;
          const ptName = textStr || `TEXT_${idx + 1}`;

          // UNIFIED LOGIC: If it's a survey-relevant text in a CAD drawing, 
          // we treat it as a Point (Survey Node) for the Unified DB.
          // The Dynamic Label Engine in CADCanvas will handle the QGIS-style display.
          surveyPointMap.set(coordKey, {
            id: `dxf-txt-pt-${now}-${idx}`,
            name: ptName,
            code: '',
            remark: '',
            x: tx,
            y: ty,
            z: tz,
            layerId: layer.id,
            isSurveyNode: true
          });
          
          // DO NOT push to 'texts' array. This prevents the "ghosting" double-render.
          break;
        }
      }
    });

    points.push(...Array.from(surveyPointMap.values()));
  }

  // Calculate bounds safely without spread (prevents stack overflow on huge files)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const updateBounds = (p: Point2D) => {
    if (isNaN(p.x) || isNaN(p.y)) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  points.forEach((p: Point2D) => updateBounds(p));
  // Note: texts array is now empty for survey-type DXFs, but kept for future general CAD support
  texts.forEach((p: Point2D) => updateBounds(p));
  polylines.forEach(pl => pl.points.forEach((p: Point2D) => updateBounds(p)));
  polygons.forEach(pg => pg.points.forEach((p: Point2D) => updateBounds(p)));
  lines.forEach(l => { updateBounds(l.start); updateBounds(l.end); });

  return {
    points,
    lines,
    polylines,
    polygons,
    texts,
    layers: Array.from(layerMap.values()),
    layerName: filename.replace(/\.[^/.]+$/, ''),
    bounds: minX !== Infinity ? { minX, minY, maxX, maxY } : undefined
  };
}
