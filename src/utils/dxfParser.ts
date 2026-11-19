/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import DxfParser from 'dxf-parser';
import iconv from 'iconv-lite';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, Point2D, UnifiedCADData } from '../types/cad';
import { detectKoreanEncoding } from './encoding';

const LAYER_COLORS = [
  '#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', 
  '#60a5fa', '#f97316', '#2dd4bf', '#a3e635', '#f472b6', 
  '#818cf8', '#c084fc', '#fb7185', '#22d3ee', '#fb923c'
];

function normalizeDegrees(deg: number): number {
  const mod = ((deg % 360) + 360) % 360;
  return Number(mod.toFixed(4));
}

function rgbIntToHex(val: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.round(val)));
  return '#' + clamped.toString(16).padStart(6, '0');
}

function resolveEntityColorHex(colorIndex: unknown, colorValue: unknown): string | undefined {
  const idx = typeof colorIndex === 'number' ? Math.abs(colorIndex) : undefined;
  // 0 = ByBlock, 256 = ByLayer -> leave entity color undefined unless TrueColor (420) is distinct
  if (idx === 0 || idx === 256) {
    return undefined;
  }
  if (typeof colorValue === 'number' && Number.isFinite(colorValue)) {
    if (colorValue >= 0 && colorValue <= 0xffffff) {
      return rgbIntToHex(colorValue);
    }
  }
  if (idx !== undefined && idx > 0 && idx < 256) {
    return dxfColorToHex(idx);
  }
  return undefined;
}

export function parseDxfBuffer(
  buffer: ArrayBuffer,
  filename: string = 'drawing.dxf',
  forcedEncoding?: 'utf-8' | 'euc-kr'
): UnifiedCADData {
  const enc = forcedEncoding || detectKoreanEncoding(buffer);
  const text = iconv.decode(Buffer.from(buffer), enc === 'utf-8' ? 'utf-8' : 'cp949');

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
  const layersMap = new Map<string, CADLayer>();

  const now = Date.now();

  // 1. Process Layers
  if (dxf.tables && dxf.tables.layer && dxf.tables.layer.layers) {
    const layerEntries = Object.values(dxf.tables.layer.layers);
    layerEntries.forEach((l: any, idx: number) => {
      const resolvedLayerColor =
        resolveEntityColorHex(l.colorIndex, l.color) ||
        LAYER_COLORS[idx % LAYER_COLORS.length];
      layersMap.set(l.name, {
        id: `layer-${l.name.replace(/[\s\.]/g, '_')}`,
        name: l.name,
        color: resolvedLayerColor,
        visible: l.visible !== undefined ? !!l.visible : true,
        locked: !!l.frozen,
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
   * If a point already exists within 50cm, merge metadata without letting generic POINT overwrite TEXT/MTEXT/INSERT properties.
   */
  const addOrUpdatePoint = (newPt: CADPoint) => {
    const EPSILON = 0.5;
    const existing = points.find(p => Math.abs(p.x - newPt.x) < EPSILON && Math.abs(p.y - newPt.y) < EPSILON);

    if (existing) {
      const currentIsGeneric = existing.name.startsWith('PT_') || existing.name.startsWith('BLOCK_') || !existing.name;
      const newIsBetter = !newPt.name.startsWith('PT_') && !newPt.name.startsWith('BLOCK_') && newPt.name;

      if (currentIsGeneric && newIsBetter) {
        existing.name = newPt.name;
      }

      const existingAttrs = existing.attributes || {};
      const newAttrs = newPt.attributes || {};
      const existingDxfType = String(existingAttrs.DXF_TYPE || '').toUpperCase();
      const newDxfType = String(newAttrs.DXF_TYPE || '').toUpperCase();
      const existingIsRich = existingDxfType === 'TEXT' || existingDxfType === 'MTEXT' || existingDxfType === 'INSERT';
      const newIsPoint = !newDxfType || newDxfType === 'POINT';

      const merged = existingIsRich && newIsPoint
        ? { ...newAttrs, ...existingAttrs }
        : { ...existingAttrs, ...newAttrs };

      merged.TEXTSTRING = existing.name;
      existing.attributes = merged;

      if (newPt.z !== undefined && (existing.z === undefined || existing.z === 0)) {
        existing.z = newPt.z;
      }
    } else {
      points.push({
        ...newPt,
        attributes: { ...(newPt.attributes || {}), TEXTSTRING: newPt.attributes?.TEXTSTRING || newPt.name }
      });
    }
  };

  if (dxf.entities) {
    dxf.entities.forEach((ent: any, idx: number) => {
      const layerId = getLayerId(ent.layer);
      const color = resolveEntityColorHex(ent.colorIndex, ent.color);
      const attributes: Record<string, string | number> = {
        DXF_TYPE: String(ent.type || 'UNKNOWN')
      };
      if (ent.handle) attributes.handle = String(ent.handle);
      if (ent.lineType) attributes.LINE_TYPE = String(ent.lineType);
      if (typeof ent.lineTypeScale === 'number' && Number.isFinite(ent.lineTypeScale)) {
        attributes.LT_SCALE = Number(ent.lineTypeScale.toFixed(4));
      }
      if (typeof ent.lineweight === 'number' && Number.isFinite(ent.lineweight)) {
        attributes.LINEWEIGHT = ent.lineweight;
      }
      if (typeof ent.colorIndex === 'number' && Number.isFinite(ent.colorIndex)) {
        attributes.DXF_ACI = ent.colorIndex;
      }

      const getEntityPos = (e: any): Point2D => {
        const hasAlignment =
          (typeof e.halign === 'number' && e.halign !== 0) ||
          (typeof e.valign === 'number' && e.valign !== 0);
        const endPt = e.endPoint;
        const endPtUsable =
          endPt &&
          (Math.abs(Number(endPt.x ?? 0)) > 1e-9 ||
            Math.abs(Number(endPt.y ?? 0)) > 1e-9 ||
            (e.startPoint && Number(e.startPoint.x ?? 0) === 0 && Number(e.startPoint.y ?? 0) === 0));

        const p =
          (hasAlignment && endPtUsable ? endPt : undefined) ||
          e.position ||
          e.startPoint ||
          e.endPoint ||
          e.center ||
          (e.vertices && e.vertices[0]) ||
          e;

        let x = typeof p.x === 'number' ? p.x : Number(p.x ?? 0);
        let y = typeof p.y === 'number' ? p.y : Number(p.y ?? 0);
        const rawZ = p.z ?? e.elevation;
        let z = rawZ !== undefined ? Number(rawZ) : undefined;
        if (z !== undefined && !Number.isFinite(z)) z = undefined;

        if (x === 0 && y === 0 && (e.x !== undefined || e.y !== undefined)) {
          x = Number(e.x ?? 0);
          y = Number(e.y ?? 0);
          if (e.z !== undefined && Number.isFinite(Number(e.z))) {
            z = Number(e.z);
          }
        }

        return z !== undefined ? { x, y, z } : { x, y };
      };

      switch (ent.type) {
        case 'POINT': {
          const ptPos = getEntityPos(ent);
          updateBounds(ptPos);
          addOrUpdatePoint({
            id: `dxf-pt-${now}-${idx}`,
            name: `PT_${points.length + 1}`,
            x: ptPos.x,
            y: ptPos.y,
            z: ptPos.z ?? 0,
            layerId,
            isSurveyNode: true,
            attributes
          });
          break;
        }

        case 'LINE': {
          const lStart = getEntityPos(ent.startPoint || ent.vertices?.[0] || { x: ent.x, y: ent.y, z: ent.z });
          const lEnd = getEntityPos(ent.endPoint || ent.vertices?.[1] || { x: ent.x2 || ent.endX, y: ent.y2 || ent.endY, z: ent.z2 || ent.endZ });
          updateBounds(lStart);
          updateBounds(lEnd);
          lines.push({
            id: `dxf-ln-${now}-${idx}`,
            name: `LINE_${idx + 1}`,
            start: {
              x: lStart.x,
              y: lStart.y
            },
            end: {
              x: lEnd.x,
              y: lEnd.y
            },
            layerId,
            color,
            attributes
          });
          break;
        }

        case 'LWPOLYLINE':
        case 'POLYLINE': {
          if (!ent.vertices || !Array.isArray(ent.vertices)) break;
          const elev = typeof ent.elevation === 'number' && Number.isFinite(ent.elevation) ? ent.elevation : undefined;
          const pts: Point2D[] = ent.vertices.map((v: any) => {
            const p: Point2D = {
              x: Number(v.x ?? 0),
              y: Number(v.y ?? 0)
            };
            updateBounds(p);
            return p;
          });
          if (pts.length >= 2) {
            const isClosed = !!(
              ent.shape ||
              ent.closed ||
              (pts.length >= 3 && Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].y - pts[pts.length - 1].y) < 0.05)
            );
            const finalPts = [...pts];
            if (isClosed && Math.hypot(finalPts[0].x - finalPts[finalPts.length - 1].x, finalPts[0].y - finalPts[finalPts.length - 1].y) >= 1e-6) {
              finalPts.push({ ...finalPts[0] });
            }
            const plAttrs: Record<string, string | number> = {
              ...attributes,
              IS_CLOSED: isClosed ? 1 : 0
            };
            if (typeof ent.width === 'number' && Number.isFinite(ent.width) && ent.width > 0) {
              plAttrs.PL_WIDTH = Number(ent.width.toFixed(4));
            }
            if (elev !== undefined) {
              plAttrs.ELEVATION = Number(elev.toFixed(4));
            }
            polylines.push({
              id: `dxf-pl-${now}-${idx}`,
              name: `PLINE_${idx + 1}`,
              points: finalPts,
              isClosed,
              layerId,
              color,
              attributes: plAttrs
            });
          }
          break;
        }

        case 'TEXT':
        case 'MTEXT': {
          const tPos = getEntityPos(ent);
          updateBounds(tPos);
          const textContent = (ent.text || ent.textString || '').trim();
          if (!textContent) break;
          const dxfTextH = Number(ent.textHeight ?? ent.height);

          let rotationDeg = 0;
          if (ent.type === 'MTEXT') {
            const dv = ent.directionVector;
            if (dv && (Math.abs(Number(dv.x ?? 0)) > 1e-9 || Math.abs(Number(dv.y ?? 0)) > 1e-9)) {
              rotationDeg = normalizeDegrees(Math.atan2(Number(dv.y ?? 0), Number(dv.x ?? 0)) * (180 / Math.PI));
            } else if (typeof ent.rotation === 'number' && Number.isFinite(ent.rotation)) {
              // DXF MTEXT code 50 is radians in AutoCAD (typically non-integer within ±2π), though some writers emit degrees
              const r = ent.rotation;
              const isRadians = r !== 0 && !Number.isInteger(r) && Math.abs(r) <= Math.PI * 2 + 1e-4;
              rotationDeg = normalizeDegrees(isRadians ? r * (180 / Math.PI) : r);
            }
          } else if (typeof ent.rotation === 'number' && Number.isFinite(ent.rotation)) {
            rotationDeg = normalizeDegrees(ent.rotation);
          }

          const txtAttrs: Record<string, string | number> = {
            ...attributes,
            origin: ent.type,
            TEXTSTRING: textContent,
            TEXTHEIGHT: Number.isFinite(dxfTextH) && dxfTextH > 0 ? dxfTextH : 1,
            ROTATION: rotationDeg,
            'marker-symbol': 'circle',
            'marker-size': 'medium'
          };

          if (ent.type === 'TEXT') {
            if (typeof ent.halign === 'number' && Number.isFinite(ent.halign)) {
              txtAttrs.TXT_HALIGN = ent.halign;
            }
            if (typeof ent.valign === 'number' && Number.isFinite(ent.valign)) {
              txtAttrs.TXT_VALIGN = ent.valign;
            }
            if (typeof ent.xScale === 'number' && Number.isFinite(ent.xScale) && ent.xScale > 0) {
              txtAttrs.TXT_XSCALE = Number(ent.xScale.toFixed(4));
            }
          } else {
            if (typeof ent.width === 'number' && Number.isFinite(ent.width) && ent.width > 0) {
              txtAttrs.MTEXT_W = Number(ent.width.toFixed(4));
            }
            if (typeof ent.attachmentPoint === 'number' && Number.isFinite(ent.attachmentPoint)) {
              txtAttrs.MTEXT_ATT = ent.attachmentPoint;
            }
            if (typeof ent.drawingDirection === 'number' && Number.isFinite(ent.drawingDirection)) {
              txtAttrs.MTEXT_DIR = ent.drawingDirection;
            }
          }

          // Convert text to point to avoid double rendering in CADCanvas (which labels points)
          addOrUpdatePoint({
            id: `dxf-pt-txt-${now}-${idx}`,
            name: textContent,
            x: tPos.x,
            y: tPos.y,
            z: tPos.z ?? 0,
            layerId,
            isSurveyNode: true,
            attributes: txtAttrs
          });
          break;
        }

        case 'INSERT': {
          const iPos = getEntityPos(ent);
          updateBounds(iPos);
          const insName = ent.name || `BLOCK_${idx + 1}`;
          const insAttrs: Record<string, string | number> = {
            ...attributes,
            origin: 'INSERT',
            blockName: insName,
            TEXTSTRING: insName,
            TEXTHEIGHT: 1,
            ROTATION: typeof ent.rotation === 'number' && Number.isFinite(ent.rotation)
              ? normalizeDegrees(ent.rotation)
              : 0,
            'marker-symbol': 'circle',
            'marker-size': 'medium'
          };
          if (typeof ent.xScale === 'number' && Number.isFinite(ent.xScale)) {
            insAttrs.BLK_SX = Number(ent.xScale.toFixed(4));
          }
          if (typeof ent.yScale === 'number' && Number.isFinite(ent.yScale)) {
            insAttrs.BLK_SY = Number(ent.yScale.toFixed(4));
          }
          addOrUpdatePoint({
            id: `dxf-ins-${now}-${idx}`,
            name: insName,
            x: iPos.x,
            y: iPos.y,
            z: iPos.z ?? 0,
            layerId,
            isSurveyNode: true,
            attributes: insAttrs
          });
          break;
        }

        case 'CIRCLE':
        case 'ARC': {
          const center = getEntityPos(ent);
          const radius = Number(ent.radius || 0);
          if (radius <= 0) break;
          const circlePts: Point2D[] = [];
          const segments = 32;
          const isCircle = ent.type === 'CIRCLE';
          const startRad = isCircle ? 0 : Number(ent.startAngle ?? 0);
          const endRadRaw = isCircle ? Math.PI * 2 : Number(ent.endAngle ?? Math.PI * 2);
          let sweepRad = isCircle
            ? Math.PI * 2
            : (endRadRaw >= startRad ? endRadRaw - startRad : endRadRaw + Math.PI * 2 - startRad);
          if (!isCircle && sweepRad <= 1e-6) {
            sweepRad = Math.PI * 2;
          }
          const deltaRad = sweepRad / segments;
          for (let i = 0; i <= segments; i++) {
            const ang = startRad + i * deltaRad;
            const p: Point2D = {
              x: center.x + Math.cos(ang) * radius,
              y: center.y + Math.sin(ang) * radius
            };
            updateBounds(p);
            circlePts.push(p);
          }

          const geomAttrs: Record<string, string | number> = {
            ...attributes,
            CIR_CX: Number(center.x.toFixed(4)),
            CIR_CY: Number(center.y.toFixed(4)),
            CIR_R: Number(radius.toFixed(4))
          };
          if (center.z !== undefined && center.z !== 0) {
            geomAttrs.ELEVATION = Number(center.z.toFixed(4));
          }

          if (isCircle || sweepRad >= Math.PI * 2 - 1e-3) {
            if (circlePts.length >= 2) {
              circlePts[circlePts.length - 1] = { ...circlePts[0] };
            }
            geomAttrs.IS_CLOSED = 1;
            polylines.push({
              id: `dxf-cir-${now}-${idx}`,
              name: `CIRCLE_${idx + 1}`,
              points: circlePts,
              isClosed: true,
              layerId,
              color,
              attributes: geomAttrs
            });
          } else {
            geomAttrs.IS_CLOSED = 0;
            geomAttrs.ARC_SANG = normalizeDegrees(startRad * (180 / Math.PI));
            geomAttrs.ARC_EANG = normalizeDegrees(endRadRaw * (180 / Math.PI));
            polylines.push({
              id: `dxf-arc-${now}-${idx}`,
              name: `ARC_${idx + 1}`,
              points: circlePts,
              isClosed: false,
              layerId,
              color,
              attributes: geomAttrs
            });
          }
          break;
        }
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
    6: '#ff00ff', 7: '#ffffff', 8: '#808080', 9: '#c0c0c0', 10: '#ff0000'
  };

  if (aci[index]) return aci[index];

  const hue = (index * 137.5) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}
