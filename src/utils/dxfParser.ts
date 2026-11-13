/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import DxfParser from 'dxf-parser';
import iconv from 'iconv-lite';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D, UnifiedCADData } from '../types/cad';
import { detectKoreanEncoding } from './encoding';

const LAYER_COLORS = [
  '#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', 
  '#60a5fa', '#f97316', '#2dd4bf', '#a3e635', '#f472b6', 
  '#818cf8', '#c084fc', '#fb7185', '#22d3ee', '#fb923c'
];

export function parseDxfBuffer(
  buffer: ArrayBuffer,
  filename: string = 'drawing.dxf',
  forcedEncoding?: 'utf-8' | 'euc-kr'
): UnifiedCADData {
  const enc = forcedEncoding || detectKoreanEncoding(buffer);
  const text = iconv.decode(Buffer.from(buffer), enc === 'euc-kr' ? 'cp949' : 'utf-8');

  const parser = new DxfParser();
  let dxf: any;
  try {
    dxf = parser.parseSync(text);
  } catch (err) {
    console.error('DXF Parse Error:', err);
    throw new Error('DXF 파일 파싱에 실패했습니다. 유효한 DXF 파일인지 확인해 주세요.');
  }

  const points: CADPoint[] = [];
  const lines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];
  const texts: CADText[] = [];
  const layersMap = new Map<string, CADLayer>();

  const now = Date.now();

  // 1. Process Layers
  if (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) {
    const layerEntries = Object.values(dxf.tables.layer.layers);
    layerEntries.forEach((l: any, idx: number) => {
      layersMap.set(l.name, {
        id: `layer-${l.name.replace(/[\s\.]/g, '_')}`,
        name: l.name,
        color: (l.color && l.color > 0 && l.color < 255) ? dxfColorToHex(l.color) : LAYER_COLORS[idx % LAYER_COLORS.length],
        visible: true,
        locked: false,
        lineWidth: 1.5
      });
    });
  }

  // Helper to get or create layer
  const getLayerId = (name: string): string => {
    if (!name) return 'layer-0';
    if (!layersMap.has(name)) {
      const id = `layer-${name.replace(/[\s\.]/g, '_')}`;
      layersMap.set(name, {
        id,
        name,
        color: LAYER_COLORS[layersMap.size % LAYER_COLORS.length],
        visible: true,
        locked: false,
        lineWidth: 1.5
      });
    }
    return layersMap.get(name)!.id;
  };

  // 2. Process Entities
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const updateBounds = (p: Point2D) => {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  };

  /**
   * Deduplication logic: prevents adding multiple points at the same location.
   * If a point already exists within 5mm, we update its name or attributes instead of adding new.
   */
  const addOrUpdatePoint = (newPt: CADPoint) => {
    const EPSILON = 0.5; // Increased to 50cm tolerance for merging jittered labels with nodes
    const existing = points.find(p => Math.abs(p.x - newPt.x) < EPSILON && Math.abs(p.y - newPt.y) < EPSILON);
    
    if (existing) {
      // Name Priority: Prefer meaningful text over generic PT_ or BLOCK_ names
      const currentIsGeneric = existing.name.startsWith('PT_') || existing.name.startsWith('BLOCK_') || !existing.name;
      const newIsBetter = !newPt.name.startsWith('PT_') && !newPt.name.startsWith('BLOCK_') && newPt.name;
      
      if (currentIsGeneric && newIsBetter) {
        existing.name = newPt.name;
      }
      
      existing.attributes = { ...existing.attributes, ...newPt.attributes };
      if (newPt.z !== undefined && (existing.z === undefined || existing.z === 0)) {
        existing.z = newPt.z;
      }
    } else {
      points.push(newPt);
    }
  };

  if (dxf.entities) {
    dxf.entities.forEach((ent: any, idx: number) => {
      const layerId = getLayerId(ent.layer);
      // Only apply explicit color if it's not ByLayer (256)
      const color = (ent.color && ent.color < 256) ? dxfColorToHex(ent.color) : undefined;
      const attributes: Record<string, string | number> = {};
      if (ent.handle) attributes.handle = String(ent.handle);

      const getEntityPos = (e: any): Point2D => {
        // dxf-parser properties vary by entity type and version
        // Prefer position, then startPoint, then endPoint, then center
        const p = e.position || e.startPoint || e.endPoint || e.center || (e.vertices && e.vertices[0]) || e;
        
        let x = typeof p.x === 'number' ? p.x : Number(p.x ?? 0);
        let y = typeof p.y === 'number' ? p.y : Number(p.y ?? 0);
        let z = typeof p.z === 'number' ? p.z : Number(p.z ?? 0);

        // Fallback for flat coordinate properties (sometimes provided directly on entity)
        if (x === 0 && y === 0 && (e.x !== undefined || e.y !== undefined)) {
          x = Number(e.x ?? 0);
          y = Number(e.y ?? 0);
          z = Number(e.z ?? 0);
        }

        return { x, y, z };
      };

      switch (ent.type) {
        case 'POINT':
          const ptPos = getEntityPos(ent);
          updateBounds(ptPos);
          addOrUpdatePoint({
            id: `dxf-pt-${now}-${idx}`,
            name: `PT_${points.length + 1}`,
            x: ptPos.x,
            y: ptPos.y,
            z: ptPos.z,
            layerId,
            isSurveyNode: true,
            attributes
          });
          break;

        case 'LINE':
          const lStart = getEntityPos(ent.startPoint || ent.vertices?.[0] || { x: ent.x, y: ent.y, z: ent.z });
          const lEnd = getEntityPos(ent.endPoint || ent.vertices?.[1] || { x: ent.x2 || ent.endX, y: ent.y2 || ent.endY, z: ent.z2 || ent.endZ });
          updateBounds(lStart);
          updateBounds(lEnd);
          lines.push({
            id: `dxf-ln-${now}-${idx}`,
            name: `LINE_${idx + 1}`,
            start: { x: lStart.x, y: lStart.y },
            end: { x: lEnd.x, y: lEnd.y },
            layerId,
            color,
            attributes
          });
          break;

        case 'LWPOLYLINE':
        case 'POLYLINE':
          if (!ent.vertices || !Array.isArray(ent.vertices)) break;
          const pts: Point2D[] = ent.vertices.map((v: any) => {
            const p = { x: Number(v.x ?? 0), y: Number(v.y ?? 0) };
            updateBounds(p);
            return p;
          });
          if (pts.length >= 2) {
            // AutoCAD closed flag or start/end overlap -> 외곽선 기준 닫힌 선(Polyline)으로 처리
            const isClosed = !!(ent.shape || ent.closed || (pts.length >= 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.05));
            const finalPts = [...pts];
            if (isClosed && Math.hypot(finalPts[0].x - finalPts[finalPts.length - 1].x, finalPts[0].y - finalPts[finalPts.length - 1].y) >= 1e-6) {
              finalPts.push({ ...finalPts[0] });
            }
            polylines.push({
              id: `dxf-pl-${now}-${idx}`,
              name: `PLINE_${idx + 1}`,
              points: finalPts,
              isClosed,
              layerId,
              color,
              attributes
            });
          }
          break;

        case 'TEXT':
        case 'MTEXT':
          const tPos = getEntityPos(ent);
          updateBounds(tPos);
          const textContent = (ent.text || ent.textString || '').trim();
          if (!textContent) break;

          // Convert text to point to avoid double rendering in CADCanvas (which labels points)
          addOrUpdatePoint({
            id: `dxf-pt-txt-${now}-${idx}`,
            name: textContent,
            x: tPos.x,
            y: tPos.y,
            z: tPos.z,
            layerId,
            isSurveyNode: true,
            attributes: { ...attributes, origin: 'TEXT' }
          });
          break;

        case 'INSERT':
          const iPos = getEntityPos(ent);
          updateBounds(iPos);
          addOrUpdatePoint({
            id: `dxf-ins-${now}-${idx}`,
            name: ent.name || `BLOCK_${idx + 1}`,
            x: iPos.x,
            y: iPos.y,
            z: iPos.z,
            layerId,
            isSurveyNode: true,
            attributes: { ...attributes, blockName: ent.name }
          });
          break;

        case 'CIRCLE':
        case 'ARC':
          const center = getEntityPos(ent);
          const radius = Number(ent.radius || 0);
          if (radius <= 0) break;
          const circlePts: Point2D[] = [];
          const segments = 32;
          const startAngle = ent.startAngle || 0;
          const endAngle = ent.endAngle !== undefined ? ent.endAngle : 360;
          const delta = (endAngle - startAngle) / segments;
          for (let i = 0; i <= segments; i++) {
            const ang = (startAngle + i * delta) * Math.PI / 180;
            const p = { x: center.x + Math.cos(ang) * radius, y: center.y + Math.sin(ang) * radius };
            updateBounds(p);
            circlePts.push(p);
          }
          if (ent.type === 'CIRCLE' || (Math.abs(endAngle - startAngle) >= 359.9)) {
            if (circlePts.length >= 2) {
              circlePts[circlePts.length - 1] = { ...circlePts[0] };
            }
            polylines.push({ id: `dxf-cir-${now}-${idx}`, name: `CIRCLE_${idx + 1}`, points: circlePts, isClosed: true, layerId, color, attributes });
          } else {
            polylines.push({ id: `dxf-arc-${now}-${idx}`, name: `ARC_${idx + 1}`, points: circlePts, isClosed: false, layerId, color, attributes });
          }
          break;
      }
    });
  }

  return {
    points,
    lines,
    polylines,
    polygons,
    texts: [], // Explicitly return empty texts to prevent double labeling
    layers: Array.from(layersMap.values()),
    layerName: filename.replace(/\.[^/.]+$/, ''),
    detectedEncoding: enc as 'utf-8' | 'euc-kr',
    bounds: minX !== Infinity ? { minX, minY, maxX, maxY } : undefined
  };
}

function dxfColorToHex(index: number): string {
  // Standard AutoCAD Color Index (ACI) Mapping
  const aci: Record<number, string> = {
    1: '#ff0000', 2: '#ffff00', 3: '#00ff00', 4: '#00ffff', 5: '#0000ff', 
    6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0', 10: '#ff0000',
    // ... basic mapping, then fallback to palette for others
  };
  
  if (aci[index]) return aci[index];
  
  // Diversify based on index for colors 10-255
  const hue = (index * 137.5) % 360; // Golden angle for distribution
  return `hsl(${hue}, 70%, 60%)`;
}
