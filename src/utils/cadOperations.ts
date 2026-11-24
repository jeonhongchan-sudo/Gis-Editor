/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D } from '../types/cad';
import { closestPointOnSegment, distance2D } from './geometry';

export interface LinearTargetHit {
  kind: 'line' | 'polyline';
  id: string;
  layerId: string;
  segIndex: number;
  t: number;
  point: Point2D;
  distance: number;
  arcLength: number;
  totalLength: number;
  isClosed: boolean;
}

export interface CADGeometryMutation {
  deleteLineIds: string[];
  upsertLines: CADLine[];
  deletePolylineIds: string[];
  upsertPolylines: CADPolyline[];
  upsertPoints?: CADPoint[];
  upsertPolygons?: CADPolygon[];
  upsertTexts?: CADText[];
  message?: string;
}

export interface TrimPreviewResult {
  hit: LinearTargetHit;
  trimSegments: Point2D[][]; // One or two polylines representing the piece that will be removed (1 normally, 2 if wrapping seam of closed loop)
  cutPoints: Point2D[];
  mutation: CADGeometryMutation;
}

export interface BreakGapPreviewResult {
  points: Point2D[]; // Sub-polyline between p1 and p2 that will be removed
}

export interface ExtendPreviewResult {
  hit: LinearTargetHit;
  extendEnd: 'start' | 'end';
  fromPoint: Point2D;
  toPoint: Point2D;
  addedLength: number;
  mutation: CADGeometryMutation;
}

const EPS = 1e-6;

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const pickCoord = (p: Point2D, applyZ: boolean): Point2D =>
  applyZ && p.z !== undefined && Number.isFinite(p.z)
    ? { x: p.x, y: p.y, z: p.z }
    : { x: p.x, y: p.y };

export function createRectanglePolyline(
  p1: Point2D,
  p2: Point2D,
  layerId: string,
  name?: string
): CADPolyline {
  const minX = Math.min(p1.x, p2.x);
  const maxX = Math.max(p1.x, p2.x);
  const minY = Math.min(p1.y, p2.y);
  const maxY = Math.max(p1.y, p2.y);
  const zVal = p1.z !== undefined && Number.isFinite(p1.z) ? p1.z : undefined;
  const withZ = (x: number, y: number): Point2D => (zVal !== undefined ? { x, y, z: zVal } : { x, y });

  return {
    id: makeId('rect'),
    name: name || '사각형',
    points: [
      withZ(minX, minY),
      withZ(maxX, minY),
      withZ(maxX, maxY),
      withZ(minX, maxY)
    ],
    isClosed: true,
    layerId
  };
}

export function createRectangleByDimensions(
  basePoint: Point2D,
  width: number,
  height: number,
  anchor: 'corner' | 'center',
  layerId: string,
  name?: string
): CADPolyline {
  const zProp = basePoint.z !== undefined && Number.isFinite(basePoint.z) ? { z: basePoint.z } : {};
  if (anchor === 'center') {
    const hw = Math.abs(width) / 2;
    const hh = Math.abs(height) / 2;
    return createRectanglePolyline(
      { x: basePoint.x - hw, y: basePoint.y - hh, ...zProp },
      { x: basePoint.x + hw, y: basePoint.y + hh, ...zProp },
      layerId,
      name
    );
  }
  return createRectanglePolyline(
    basePoint,
    { x: basePoint.x + width, y: basePoint.y + height, ...zProp },
    layerId,
    name
  );
}

export function createCirclePolyline(
  center: Point2D,
  radius: number,
  layerId: string,
  segments = 64,
  name?: string
): CADPolyline {
  const zProp = center.z !== undefined && Number.isFinite(center.z) ? { z: center.z } : {};
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    pts.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
      ...zProp
    });
  }
  return {
    id: makeId('circle'),
    name: name || '원',
    points: pts,
    isClosed: true,
    layerId
  };
}

export function createEllipsePolyline(
  center: Point2D,
  rx: number,
  ry: number,
  layerId: string,
  segments = 64,
  name?: string
): CADPolyline {
  const safeRx = Math.abs(rx);
  const safeRy = Math.abs(ry);
  const zProp = center.z !== undefined && Number.isFinite(center.z) ? { z: center.z } : {};
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    pts.push({
      x: center.x + Math.cos(angle) * safeRx,
      y: center.y + Math.sin(angle) * safeRy,
      ...zProp
    });
  }
  return {
    id: makeId('ellipse'),
    name: name || '타원',
    points: pts,
    isClosed: true,
    layerId
  };
}

export function createEllipseByBounds(
  p1: Point2D,
  p2: Point2D,
  layerId: string,
  segments = 64,
  name?: string
): CADPolyline {
  const cx = (p1.x + p2.x) / 2;
  const cy = (p1.y + p2.y) / 2;
  const rx = Math.abs(p2.x - p1.x) / 2;
  const ry = Math.abs(p2.y - p1.y) / 2;
  const center: Point2D =
    p1.z !== undefined && Number.isFinite(p1.z)
      ? { x: cx, y: cy, z: p1.z }
      : { x: cx, y: cy };
  return createEllipsePolyline(center, rx, ry, layerId, segments, name);
}

export function createEllipseByDimensions(
  basePoint: Point2D,
  width: number,
  height: number,
  anchor: 'corner' | 'center',
  layerId: string,
  segments = 64,
  name?: string
): CADPolyline {
  const rx = Math.abs(width) / 2;
  const ry = Math.abs(height) / 2;
  const zProp = basePoint.z !== undefined && Number.isFinite(basePoint.z) ? { z: basePoint.z } : {};
  const center: Point2D =
    anchor === 'center'
      ? { x: basePoint.x, y: basePoint.y, ...zProp }
      : { x: basePoint.x + width / 2, y: basePoint.y + height / 2, ...zProp };
  return createEllipsePolyline(center, rx, ry, layerId, segments, name);
}

export type CalloutStyle = 'rect' | 'ellipse' | 'cloud' | 'leader';

export interface CalloutSpec {
  style: CalloutStyle;
  text: string;
  textHeight: number;
  withLeader: boolean;
}

let cachedMeasureCtx: CanvasRenderingContext2D | null = null;
function measureCalloutTextLayout(text: string, textHeight: number): { width: number; height: number; lineCount: number } {
  const safeH = Math.max(0.01, textHeight);
  const rawLines = text.split(/\r?\n/);
  const lines = rawLines.length > 0 ? rawLines : [''];

  if (!cachedMeasureCtx && typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    cachedMeasureCtx = c.getContext('2d');
  }

  let maxLineW = 0;
  for (const line of lines) {
    if (cachedMeasureCtx) {
      cachedMeasureCtx.font = '600 100px system-ui, -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
      const w = cachedMeasureCtx.measureText(line).width * (safeH / 100);
      if (w > maxLineW) maxLineW = w;
    } else {
      let approx = 0;
      for (const ch of line) {
        approx += ch.charCodeAt(0) > 127 ? 1.0 : 0.62;
      }
      const w = approx * safeH;
      if (w > maxLineW) maxLineW = w;
    }
  }

  const contentW = Math.max(safeH * 1.6, maxLineW);
  const contentH = lines.length * safeH * 1.25;
  return { width: contentW, height: contentH, lineCount: lines.length };
}

function createCloudPoints(cx: number, cy: number, boxW: number, boxH: number, textHeight: number, zVal?: number): Point2D[] {
  const hw = boxW / 2;
  const hh = boxH / 2;
  const corners: Point2D[] = [
    { x: cx - hw, y: cy + hh }, // Top-Left
    { x: cx + hw, y: cy + hh }, // Top-Right
    { x: cx + hw, y: cy - hh }, // Bottom-Right
    { x: cx - hw, y: cy - hh }  // Bottom-Left
  ];

  const targetChord = Math.max(textHeight * 0.75, Math.min(boxW, boxH) * 0.42);
  const out: Point2D[] = [];
  const withZ = (x: number, y: number): Point2D => (zVal !== undefined ? { x, y, z: zVal } : { x, y });

  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    const edgeLen = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.max(e % 2 === 0 ? 2 : 1, Math.round(edgeLen / targetChord));
    const dx = (b.x - a.x) / count;
    const dy = (b.y - a.y) / count;
    const subLen = Math.hypot(dx, dy);
    // Outward normal for clockwise traversal in Y-up world coordinates
    const nx = -dy / Math.max(subLen, 1e-9);
    const ny = dx / Math.max(subLen, 1e-9);
    const bulge = subLen * 0.38;
    const steps = 6;

    for (let s = 0; s < count; s++) {
      const sx = a.x + dx * s;
      const sy = a.y + dy * s;
      for (let k = 0; k < steps; k++) {
        const t = k / steps;
        const arcOut = Math.sin(Math.PI * t) * bulge;
        out.push(withZ(sx + dx * t + nx * arcOut, sy + dy * t + ny * arcOut));
      }
    }
  }
  return out;
}

/**
 * Creates pure line-entity (CADPolyline) callout frames and optional leader lines.
 * Callout text is stored inside frame polyline attributes (`CALLOUT_TEXT`, `CALLOUT_STYLE`, `CALLOUT_FONT_H`)
 * so it renders cleanly inside the line frame without creating CADText or CADPoint markers.
 */
export function createCalloutPolylines(
  boxCenter: Point2D,
  targetPoint: Point2D | null,
  spec: CalloutSpec,
  layerId: string,
  baseName?: string
): CADPolyline[] {
  const cleanText = spec.text.trim();
  const safeH = Math.max(0.01, spec.textHeight);
  const layout = measureCalloutTextLayout(cleanText || ' ', safeH);
  const zVal = boxCenter.z !== undefined && Number.isFinite(boxCenter.z) ? boxCenter.z : undefined;
  const withZ = (x: number, y: number): Point2D => (zVal !== undefined ? { x, y, z: zVal } : { x, y });
  const zTargetProp = targetPoint?.z !== undefined && Number.isFinite(targetPoint.z) ? { z: targetPoint.z } : (zVal !== undefined ? { z: zVal } : {});

  const sharedAttrs: Record<string, string | number> = {
    CALLOUT_TEXT: cleanText,
    CALLOUT_STYLE: spec.style,
    CALLOUT_FONT_H: Number(safeH.toFixed(4))
  };

  if (spec.style === 'leader') {
    const shelfHalfW = layout.width / 2 + safeH * 0.35;
    const leftPt = withZ(boxCenter.x - shelfHalfW, boxCenter.y);
    const rightPt = withZ(boxCenter.x + shelfHalfW, boxCenter.y);

    let pts: Point2D[];
    if (spec.withLeader && targetPoint && distance2D(targetPoint, boxCenter) > 1e-4) {
      const targetOnLeft = targetPoint.x <= boxCenter.x;
      const elbow = targetOnLeft ? leftPt : rightPt;
      const end = targetOnLeft ? rightPt : leftPt;
      pts = [{ x: targetPoint.x, y: targetPoint.y, ...zTargetProp }, elbow, end];
    } else {
      pts = [leftPt, rightPt];
    }

    return [
      {
        id: makeId('callout'),
        name: baseName || `인출선_${cleanText.slice(0, 12) || '주석'}`,
        points: pts,
        isClosed: false,
        layerId,
        attributes: sharedAttrs
      }
    ];
  }

  let boxW: number;
  let boxH: number;
  let framePts: Point2D[];

  if (spec.style === 'ellipse') {
    const rx = (layout.width / 2) * 1.32 + safeH * 0.45;
    const ry = (layout.height / 2) * 1.32 + safeH * 0.45;
    boxW = rx * 2;
    boxH = ry * 2;
    framePts = [];
    const segments = 56;
    for (let i = 0; i < segments; i++) {
      const ang = (Math.PI * 2 * i) / segments;
      framePts.push(withZ(boxCenter.x + Math.cos(ang) * rx, boxCenter.y + Math.sin(ang) * ry));
    }
  } else if (spec.style === 'cloud') {
    boxW = layout.width + safeH * 1.6;
    boxH = layout.height + safeH * 1.3;
    framePts = createCloudPoints(boxCenter.x, boxCenter.y, boxW, boxH, safeH, zVal);
  } else {
    boxW = layout.width + safeH * 1.3;
    boxH = layout.height + safeH * 1.0;
    const hw = boxW / 2;
    const hh = boxH / 2;
    framePts = [
      withZ(boxCenter.x - hw, boxCenter.y - hh),
      withZ(boxCenter.x + hw, boxCenter.y - hh),
      withZ(boxCenter.x + hw, boxCenter.y + hh),
      withZ(boxCenter.x - hw, boxCenter.y + hh)
    ];
  }

  const result: CADPolyline[] = [
    {
      id: makeId('callout'),
      name: baseName || `말풍선_${cleanText.slice(0, 12) || '주석'}`,
      points: framePts,
      isClosed: true,
      layerId,
      attributes: sharedAttrs
    }
  ];

  if (spec.withLeader && targetPoint) {
    const dx = targetPoint.x - boxCenter.x;
    const dy = targetPoint.y - boxCenter.y;
    const hw = boxW / 2;
    const hh = boxH / 2;

    let attachPt: Point2D | null = null;
    if (spec.style === 'ellipse') {
      const norm = Math.hypot(dx / Math.max(hw, 1e-6), dy / Math.max(hh, 1e-6));
      if (norm > 1.02) {
        attachPt = withZ(boxCenter.x + dx / norm, boxCenter.y + dy / norm);
      }
    } else {
      const scale = 1 / Math.max(Math.abs(dx) / Math.max(hw, 1e-6), Math.abs(dy) / Math.max(hh, 1e-6));
      if (scale < 0.98) {
        attachPt = withZ(boxCenter.x + dx * scale, boxCenter.y + dy * scale);
      }
    }

    if (attachPt && distance2D(targetPoint, attachPt) > 1e-4) {
      result.push({
        id: makeId('leader'),
        name: `인출선_${cleanText.slice(0, 12) || '주석'}`,
        points: [{ x: targetPoint.x, y: targetPoint.y, ...zTargetProp }, attachPt],
        isClosed: false,
        layerId
      });
    }
  }

  return result;
}

/**
 * Unwraps a line or polyline (including closing segment if closed) into an explicit open vertex chain
 * along with cumulative arc-lengths at each vertex.
 */
function getChainWithArcLengths(
  entity: { kind: 'line'; data: CADLine } | { kind: 'polyline'; data: CADPolyline },
  applyZ = false
): { pts: Point2D[]; cumLen: number[]; totalLength: number; isClosed: boolean } {
  let pts: Point2D[];
  let isClosed = false;

  if (entity.kind === 'line') {
    pts = [
      pickCoord(entity.data.start, applyZ),
      pickCoord(entity.data.end, applyZ)
    ];
  } else {
    pts = entity.data.points.map(p => pickCoord(p, applyZ));
    isClosed = !!entity.data.isClosed;
    if (isClosed && pts.length >= 2) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (distance2D(first, last) > EPS) {
        pts.push({ ...first });
      }
    }
  }

  const cumLen: number[] = [0];
  for (let i = 0; i < pts.length - 1; i++) {
    cumLen.push(cumLen[i] + distance2D(pts[i], pts[i + 1]));
  }

  return {
    pts,
    cumLen,
    totalLength: cumLen[cumLen.length - 1] || 0,
    isClosed
  };
}

function pointAtArcLength(pts: Point2D[], cumLen: number[], s: number): Point2D {
  const total = cumLen[cumLen.length - 1] || 0;
  const clamped = Math.max(0, Math.min(total, s));
  for (let i = 0; i < pts.length - 1; i++) {
    const s0 = cumLen[i];
    const s1 = cumLen[i + 1];
    if (clamped <= s1 + EPS || i === pts.length - 2) {
      const segLen = s1 - s0;
      if (segLen <= EPS) return { ...pts[i] };
      const ratio = Math.max(0, Math.min(1, (clamped - s0) / segLen));
      return {
        x: pts[i].x + ratio * (pts[i + 1].x - pts[i].x),
        y: pts[i].y + ratio * (pts[i + 1].y - pts[i].y)
      };
    }
  }
  return { ...pts[pts.length - 1] };
}

function dedupeConsecutivePoints(pts: Point2D[]): Point2D[] {
  const res: Point2D[] = [];
  for (const p of pts) {
    if (res.length === 0 || distance2D(res[res.length - 1], p) > 1e-5) {
      res.push(
        p.z !== undefined && Number.isFinite(p.z)
          ? { x: p.x, y: p.y, z: p.z }
          : { x: p.x, y: p.y }
      );
    }
  }
  return res;
}

function slicePointChain(pts: Point2D[], cumLen: number[], sStart: number, sEnd: number): Point2D[] {
  if (sEnd - sStart <= 1e-5) return [];
  const out: Point2D[] = [pointAtArcLength(pts, cumLen, sStart)];
  for (let i = 0; i < cumLen.length; i++) {
    if (cumLen[i] > sStart + 1e-5 && cumLen[i] < sEnd - 1e-5) {
      out.push({ ...pts[i] });
    }
  }
  out.push(pointAtArcLength(pts, cumLen, sEnd));
  return dedupeConsecutivePoints(out);
}

/**
 * Find the closest line or polyline segment to cursorWorld within maxRadius
 */
export function findClosestLinearTarget(
  cursorWorld: Point2D,
  maxRadius: number,
  lines: CADLine[],
  polylines: CADPolyline[],
  layers: CADLayer[],
  onlyEntityId?: string
): LinearTargetHit | null {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  let best: LinearTargetHit | null = null;
  let bestDist = maxRadius;

  for (const ln of lines) {
    if (onlyEntityId && ln.id !== onlyEntityId) continue;
    const lay = layerMap.get(ln.layerId);
    if (lay && !lay.visible) continue;
    const minX = Math.min(ln.start.x, ln.end.x) - bestDist;
    const maxX = Math.max(ln.start.x, ln.end.x) + bestDist;
    const minY = Math.min(ln.start.y, ln.end.y) - bestDist;
    const maxY = Math.max(ln.start.y, ln.end.y) + bestDist;
    if (cursorWorld.x < minX || cursorWorld.x > maxX || cursorWorld.y < minY || cursorWorld.y > maxY) continue;

    const proj = closestPointOnSegment(cursorWorld, ln.start, ln.end);
    if (proj.distance < bestDist) {
      const total = distance2D(ln.start, ln.end);
      bestDist = proj.distance;
      best = {
        kind: 'line',
        id: ln.id,
        layerId: ln.layerId,
        segIndex: 0,
        t: proj.t,
        point: proj.point,
        distance: proj.distance,
        arcLength: proj.t * total,
        totalLength: total,
        isClosed: false
      };
    }
  }

  for (const pl of polylines) {
    if (onlyEntityId && pl.id !== onlyEntityId) continue;
    const lay = layerMap.get(pl.layerId);
    if (lay && !lay.visible) continue;
    if (pl.points.length < 2) continue;

    const { pts, cumLen, totalLength, isClosed } = getChainWithArcLengths({ kind: 'polyline', data: pl });
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      if (
        cursorWorld.x < Math.min(p1.x, p2.x) - bestDist ||
        cursorWorld.x > Math.max(p1.x, p2.x) + bestDist ||
        cursorWorld.y < Math.min(p1.y, p2.y) - bestDist ||
        cursorWorld.y > Math.max(p1.y, p2.y) + bestDist
      ) continue;

      const proj = closestPointOnSegment(cursorWorld, p1, p2);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        const segLen = cumLen[i + 1] - cumLen[i];
        best = {
          kind: 'polyline',
          id: pl.id,
          layerId: pl.layerId,
          segIndex: i,
          t: proj.t,
          point: proj.point,
          distance: proj.distance,
          arcLength: cumLen[i] + proj.t * segLen,
          totalLength,
          isClosed
        };
      }
    }
  }

  return best;
}

/**
 * 1-Point Break (Split at clicked point; closed polylines open at clicked point)
 */
export function breakEntityAtPoint(
  hit: LinearTargetHit,
  lines: CADLine[],
  polylines: CADPolyline[]
): { mutation: CADGeometryMutation | null; error?: string } {
  if (hit.kind === 'line') {
    const ln = lines.find(l => l.id === hit.id);
    if (!ln) return { mutation: null };
    const { pts, cumLen, totalLength } = getChainWithArcLengths({ kind: 'line', data: ln });
    if (hit.arcLength <= 1e-4 || hit.arcLength >= totalLength - 1e-4) {
      return { mutation: null, error: '끝점이 아닌 선 위를 클릭해 주세요.' };
    }
    const splitPt = pointAtArcLength(pts, cumLen, hit.arcLength);
    const l1: CADLine = {
      id: makeId('ln-brk'),
      start: { ...ln.start },
      end: splitPt,
      layerId: ln.layerId,
      color: ln.color,
      name: ln.name,
      attributes: ln.attributes ? { ...ln.attributes } : undefined
    };
    const l2: CADLine = {
      id: makeId('ln-brk'),
      start: { ...splitPt },
      end: { ...ln.end },
      layerId: ln.layerId,
      color: ln.color,
      name: ln.name,
      attributes: ln.attributes ? { ...ln.attributes } : undefined
    };
    return {
      mutation: {
        deleteLineIds: [ln.id],
        upsertLines: [l1, l2],
        deletePolylineIds: [],
        upsertPolylines: [],
        message: '단일선을 2개로 끊었습니다.'
      }
    };
  }

  const pl = polylines.find(p => p.id === hit.id);
  if (!pl) return { mutation: null };
  const { pts, cumLen, totalLength, isClosed } = getChainWithArcLengths({ kind: 'polyline', data: pl });

  if (isClosed) {
    // Open closed polyline at the clicked point
    const splitPt = pointAtArcLength(pts, cumLen, hit.arcLength);
    const after = slicePointChain(pts, cumLen, hit.arcLength, totalLength);
    const before = slicePointChain(pts, cumLen, 0, hit.arcLength);
    const unwrapped = dedupeConsecutivePoints([
      splitPt,
      ...after.slice(1),
      ...before.slice(1),
      splitPt
    ]);
    if (unwrapped.length < 2) return { mutation: null };
    return {
      mutation: {
        deleteLineIds: [],
        upsertLines: [],
        deletePolylineIds: [pl.id],
        upsertPolylines: [
          {
            id: makeId('pl-brk'),
            points: unwrapped,
            isClosed: false,
            layerId: pl.layerId,
            color: pl.color,
            name: pl.name,
            attributes: pl.attributes ? { ...pl.attributes } : undefined
          }
        ],
        message: '폐합 도형을 클릭 위치에서 열었습니다.'
      }
    };
  }

  if (hit.arcLength <= 1e-4 || hit.arcLength >= totalLength - 1e-4) {
    return { mutation: null, error: '끝점이 아닌 선 위를 클릭해 주세요.' };
  }

  const part1 = slicePointChain(pts, cumLen, 0, hit.arcLength);
  const part2 = slicePointChain(pts, cumLen, hit.arcLength, totalLength);
  const upserts: CADPolyline[] = [];
  if (part1.length >= 2) {
    upserts.push({
      id: makeId('pl-brk'),
      points: part1,
      isClosed: false,
      layerId: pl.layerId,
      color: pl.color,
      name: pl.name,
      attributes: pl.attributes ? { ...pl.attributes } : undefined
    });
  }
  if (part2.length >= 2) {
    upserts.push({
      id: makeId('pl-brk'),
      points: part2,
      isClosed: false,
      layerId: pl.layerId,
      color: pl.color,
      name: pl.name,
      attributes: pl.attributes ? { ...pl.attributes } : undefined
    });
  }

  if (upserts.length === 0) return { mutation: null };
  return {
    mutation: {
      deleteLineIds: [],
      upsertLines: [],
      deletePolylineIds: [pl.id],
      upsertPolylines: upserts,
      message: '연속선을 2개로 끊었습니다.'
    }
  };
}

/**
 * Compute preview of the gap that will be removed in 2-point break
 */
export function computeBreakGapPreview(
  hit1: LinearTargetHit,
  hit2: LinearTargetHit,
  lines: CADLine[],
  polylines: CADPolyline[]
): BreakGapPreviewResult | null {
  if (hit1.id !== hit2.id || hit1.kind !== hit2.kind) return null;
  const entity = hit1.kind === 'line'
    ? lines.find(l => l.id === hit1.id)
    : polylines.find(p => p.id === hit1.id);
  if (!entity) return null;

  const { pts, cumLen, totalLength, isClosed } = getChainWithArcLengths(
    hit1.kind === 'line'
      ? { kind: 'line', data: entity as CADLine }
      : { kind: 'polyline', data: entity as CADPolyline }
  );

  const sMin = Math.min(hit1.arcLength, hit2.arcLength);
  const sMax = Math.max(hit1.arcLength, hit2.arcLength);
  if (sMax - sMin <= 1e-4) return null;

  if (!isClosed) {
    const gapPts = slicePointChain(pts, cumLen, sMin, sMax);
    return gapPts.length >= 2 ? { points: gapPts } : null;
  }

  const gapDirect = sMax - sMin;
  const gapWrap = totalLength - gapDirect;
  if (gapDirect <= gapWrap) {
    const gapPts = slicePointChain(pts, cumLen, sMin, sMax);
    return gapPts.length >= 2 ? { points: gapPts } : null;
  } else {
    const tail = slicePointChain(pts, cumLen, sMax, totalLength);
    const head = slicePointChain(pts, cumLen, 0, sMin);
    const combined = dedupeConsecutivePoints([...tail, ...head]);
    return combined.length >= 2 ? { points: combined } : null;
  }
}

/**
 * 2-Point Break (Removes segment between hit1 and hit2 on the same entity)
 */
export function breakEntityBetweenPoints(
  hit1: LinearTargetHit,
  hit2: LinearTargetHit,
  lines: CADLine[],
  polylines: CADPolyline[]
): { mutation: CADGeometryMutation | null; error?: string } {
  if (hit1.id !== hit2.id || hit1.kind !== hit2.kind) {
    return { mutation: null, error: '첫 번째 점과 같은 선 위를 클릭해 주세요.' };
  }

  const sMin = Math.min(hit1.arcLength, hit2.arcLength);
  const sMax = Math.max(hit1.arcLength, hit2.arcLength);
  if (sMax - sMin <= 1e-4) {
    return breakEntityAtPoint(hit1, lines, polylines);
  }

  if (hit1.kind === 'line') {
    const ln = lines.find(l => l.id === hit1.id);
    if (!ln) return { mutation: null };
    const { pts, cumLen, totalLength } = getChainWithArcLengths({ kind: 'line', data: ln });
    const p1 = slicePointChain(pts, cumLen, 0, sMin);
    const p2 = slicePointChain(pts, cumLen, sMax, totalLength);
    const upserts: CADLine[] = [];
    if (p1.length >= 2) {
      upserts.push({
        id: makeId('ln-brk'),
        start: p1[0],
        end: p1[p1.length - 1],
        layerId: ln.layerId,
        color: ln.color,
        name: ln.name,
        attributes: ln.attributes ? { ...ln.attributes } : undefined
      });
    }
    if (p2.length >= 2) {
      upserts.push({
        id: makeId('ln-brk'),
        start: p2[0],
        end: p2[p2.length - 1],
        layerId: ln.layerId,
        color: ln.color,
        name: ln.name,
        attributes: ln.attributes ? { ...ln.attributes } : undefined
      });
    }
    return {
      mutation: {
        deleteLineIds: [ln.id],
        upsertLines: upserts,
        deletePolylineIds: [],
        upsertPolylines: [],
        message: '지정 구간을 끊었습니다.'
      }
    };
  }

  const pl = polylines.find(p => p.id === hit1.id);
  if (!pl) return { mutation: null };
  const { pts, cumLen, totalLength, isClosed } = getChainWithArcLengths({ kind: 'polyline', data: pl });

  const upserts: CADPolyline[] = [];
  if (isClosed) {
    const gapDirect = sMax - sMin;
    const gapWrap = totalLength - gapDirect;
    let remaining: Point2D[];
    if (gapDirect <= gapWrap) {
      const tail = slicePointChain(pts, cumLen, sMax, totalLength);
      const head = slicePointChain(pts, cumLen, 0, sMin);
      remaining = dedupeConsecutivePoints([...tail, ...head]);
    } else {
      remaining = slicePointChain(pts, cumLen, sMin, sMax);
    }
    if (remaining.length >= 2) {
      upserts.push({
        id: makeId('pl-brk'),
        points: remaining,
        isClosed: false,
        layerId: pl.layerId,
        color: pl.color,
        name: pl.name,
        attributes: pl.attributes ? { ...pl.attributes } : undefined
      });
    }
  } else {
    const p1 = slicePointChain(pts, cumLen, 0, sMin);
    const p2 = slicePointChain(pts, cumLen, sMax, totalLength);
    if (p1.length >= 2) {
      upserts.push({
        id: makeId('pl-brk'),
        points: p1,
        isClosed: false,
        layerId: pl.layerId,
        color: pl.color,
        name: pl.name,
        attributes: pl.attributes ? { ...pl.attributes } : undefined
      });
    }
    if (p2.length >= 2) {
      upserts.push({
        id: makeId('pl-brk'),
        points: p2,
        isClosed: false,
        layerId: pl.layerId,
        color: pl.color,
        name: pl.name,
        attributes: pl.attributes ? { ...pl.attributes } : undefined
      });
    }
  }

  return {
    mutation: {
      deleteLineIds: [],
      upsertLines: [],
      deletePolylineIds: [pl.id],
      upsertPolylines: upserts,
      message: '지정 구간을 끊었습니다.'
    }
  };
}

function segmentIntersectionWithParams(
  p1: Point2D,
  p2: Point2D,
  p3: Point2D,
  p4: Point2D,
  tol = 1e-6
): { point: Point2D; t: number; u: number } | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-10) return null;

  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / denom;

  if (t >= -tol && t <= 1 + tol && u >= -tol && u <= 1 + tol) {
    const ct = Math.max(0, Math.min(1, t));
    const cu = Math.max(0, Math.min(1, u));
    return {
      point: {
        x: p1.x + ct * (p2.x - p1.x),
        y: p1.y + ct * (p2.y - p1.y)
      },
      t: ct,
      u: cu
    };
  }
  return null;
}

/**
 * Compute Trim preview & exact mutation for a hovered/clicked linear entity
 * against all visible cutting edges (lines, polylines, polygons).
 */
export function computeTrimOperation(
  hit: LinearTargetHit,
  lines: CADLine[],
  polylines: CADPolyline[],
  polygons: CADPolygon[],
  layers: CADLayer[]
): { preview: TrimPreviewResult | null; error?: string } {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  const targetEntity = hit.kind === 'line'
    ? lines.find(l => l.id === hit.id)
    : polylines.find(p => p.id === hit.id);
  if (!targetEntity) return { preview: null };

  const targetLayer = layerMap.get(targetEntity.layerId);
  if (targetLayer?.locked) {
    return { preview: null, error: '잠긴 레이어의 객체는 수정할 수 없습니다.' };
  }

  const { pts, cumLen, totalLength, isClosed } = getChainWithArcLengths(
    hit.kind === 'line'
      ? { kind: 'line', data: targetEntity as CADLine }
      : { kind: 'polyline', data: targetEntity as CADPolyline }
  );
  if (totalLength <= 1e-5) return { preview: null };

  // Build list of cutting segments from all visible entities
  const cuttingSegs: { ownerId: string; segIndex: number; p1: Point2D; p2: Point2D }[] = [];
  for (const ln of lines) {
    const lay = layerMap.get(ln.layerId);
    if (lay && !lay.visible) continue;
    cuttingSegs.push({ ownerId: ln.id, segIndex: 0, p1: ln.start, p2: ln.end });
  }
  for (const pl of polylines) {
    const lay = layerMap.get(pl.layerId);
    if (lay && !lay.visible) continue;
    const chain = getChainWithArcLengths({ kind: 'polyline', data: pl }).pts;
    for (let i = 0; i < chain.length - 1; i++) {
      cuttingSegs.push({ ownerId: pl.id, segIndex: i, p1: chain[i], p2: chain[i + 1] });
    }
  }
  for (const pg of polygons) {
    const lay = layerMap.get(pg.layerId);
    if (lay && !lay.visible) continue;
    for (let i = 0; i < pg.points.length; i++) {
      cuttingSegs.push({
        ownerId: pg.id,
        segIndex: i,
        p1: pg.points[i],
        p2: pg.points[(i + 1) % pg.points.length]
      });
    }
  }

  // Collect all intersection arc-lengths on the target entity
  const rawCuts: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a1 = pts[i];
    const a2 = pts[i + 1];
    const segLen = cumLen[i + 1] - cumLen[i];
    if (segLen <= EPS) continue;

    for (const cseg of cuttingSegs) {
      if (cseg.ownerId === hit.id) {
        // Ignore self and immediate adjacent polyline vertex joints
        if (Math.abs(cseg.segIndex - i) <= 1) continue;
        if (isClosed && ((i === 0 && cseg.segIndex === pts.length - 2) || (cseg.segIndex === 0 && i === pts.length - 2))) {
          continue;
        }
      }
      const res = segmentIntersectionWithParams(a1, a2, cseg.p1, cseg.p2, 1e-5);
      if (res) {
        const s = cumLen[i] + res.t * segLen;
        rawCuts.push(s);
      }
    }
  }

  // Deduplicate cuts within 1e-4m
  rawCuts.sort((a, b) => a - b);
  const uniqueCuts: number[] = [];
  for (const s of rawCuts) {
    if (uniqueCuts.length === 0 || Math.abs(s - uniqueCuts[uniqueCuts.length - 1]) > 1e-4) {
      uniqueCuts.push(s);
    }
  }

  if (isClosed) {
    // Normalize seam intersection (0 and totalLength represent the same point)
    const interiorCuts = uniqueCuts.filter(s => s > 1e-4 && s < totalLength - 1e-4);
    const hasSeamCut = uniqueCuts.some(s => s <= 1e-4 || s >= totalLength - 1e-4);
    const loopCuts = hasSeamCut ? [0, ...interiorCuts] : interiorCuts;

    if (loopCuts.length < 2) {
      return { preview: null, error: '폐합 도형은 교차점이 2개 이상 있어야 자르기(Trim)할 수 있습니다.' };
    }

    // Find which interval between consecutive loopCuts contains hit.arcLength
    let intervalIdx = loopCuts.length - 1; // default wrap-around [last .. totalLength] + [0 .. first]
    for (let i = 0; i < loopCuts.length - 1; i++) {
      if (hit.arcLength >= loopCuts[i] && hit.arcLength <= loopCuts[i + 1]) {
        intervalIdx = i;
        break;
      }
    }

    let remaining: Point2D[];
    let trimSegments: Point2D[][];
    let cutPoints: Point2D[];

    if (intervalIdx < loopCuts.length - 1) {
      const sA = loopCuts[intervalIdx];
      const sB = loopCuts[intervalIdx + 1];
      trimSegments = [slicePointChain(pts, cumLen, sA, sB)];
      cutPoints = [pointAtArcLength(pts, cumLen, sA), pointAtArcLength(pts, cumLen, sB)];
      const tail = slicePointChain(pts, cumLen, sB, totalLength);
      const head = slicePointChain(pts, cumLen, 0, sA);
      remaining = dedupeConsecutivePoints([...tail, ...head]);
    } else {
      const sLast = loopCuts[loopCuts.length - 1];
      const sFirst = loopCuts[0];
      const seg1 = slicePointChain(pts, cumLen, sLast, totalLength);
      const seg2 = slicePointChain(pts, cumLen, 0, sFirst);
      trimSegments = [seg1, seg2].filter(seg => seg.length >= 2);
      cutPoints = [pointAtArcLength(pts, cumLen, sLast), pointAtArcLength(pts, cumLen, sFirst)];
      remaining = slicePointChain(pts, cumLen, sFirst, sLast);
    }

    if (remaining.length < 2) return { preview: null };
    const pl = targetEntity as CADPolyline;
    return {
      preview: {
        hit,
        trimSegments,
        cutPoints,
        mutation: {
          deleteLineIds: [],
          upsertLines: [],
          deletePolylineIds: [pl.id],
          upsertPolylines: [
            {
              id: makeId('pl-trim'),
              points: remaining,
              isClosed: false,
              layerId: pl.layerId,
              color: pl.color,
              name: pl.name,
              attributes: pl.attributes ? { ...pl.attributes } : undefined
            }
          ],
          message: '선택 구간을 잘라냈습니다 (Trim).'
        }
      }
    };
  }

  // Open Line / Polyline: require at least 1 interior intersection
  const interiorCuts = uniqueCuts.filter(s => s > 1e-4 && s < totalLength - 1e-4);
  if (interiorCuts.length === 0) {
    return { preview: null, error: '교차하는 기준 선이 없어 자르기(Trim)할 수 없습니다.' };
  }

  const boundaries = [0, ...interiorCuts, totalLength];
  let sA = 0;
  let sB = totalLength;
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (hit.arcLength >= boundaries[i] - 1e-5 && hit.arcLength <= boundaries[i + 1] + 1e-5) {
      sA = boundaries[i];
      sB = boundaries[i + 1];
      break;
    }
  }

  const trimmedSeg = slicePointChain(pts, cumLen, sA, sB);
  if (trimmedSeg.length < 2) return { preview: null };

  const cutPoints: Point2D[] = [];
  if (sA > 1e-4) cutPoints.push(pointAtArcLength(pts, cumLen, sA));
  if (sB < totalLength - 1e-4) cutPoints.push(pointAtArcLength(pts, cumLen, sB));

  const leftPart = sA > 1e-4 ? slicePointChain(pts, cumLen, 0, sA) : [];
  const rightPart = sB < totalLength - 1e-4 ? slicePointChain(pts, cumLen, sB, totalLength) : [];

  if (hit.kind === 'line') {
    const ln = targetEntity as CADLine;
    const upsertLines: CADLine[] = [];
    if (leftPart.length >= 2) {
      upsertLines.push({
        id: makeId('ln-trim'),
        start: leftPart[0],
        end: leftPart[leftPart.length - 1],
        layerId: ln.layerId,
        color: ln.color,
        name: ln.name,
        attributes: ln.attributes ? { ...ln.attributes } : undefined
      });
    }
    if (rightPart.length >= 2) {
      upsertLines.push({
        id: makeId('ln-trim'),
        start: rightPart[0],
        end: rightPart[rightPart.length - 1],
        layerId: ln.layerId,
        color: ln.color,
        name: ln.name,
        attributes: ln.attributes ? { ...ln.attributes } : undefined
      });
    }
    return {
      preview: {
        hit,
        trimSegments: [trimmedSeg],
        cutPoints,
        mutation: {
          deleteLineIds: [ln.id],
          upsertLines,
          deletePolylineIds: [],
          upsertPolylines: [],
          message: '선택 구간을 잘라냈습니다 (Trim).'
        }
      }
    };
  }

  const pl = targetEntity as CADPolyline;
  const upsertPolylines: CADPolyline[] = [];
  if (leftPart.length >= 2) {
    upsertPolylines.push({
      id: makeId('pl-trim'),
      points: leftPart,
      isClosed: false,
      layerId: pl.layerId,
      color: pl.color,
      name: pl.name,
      attributes: pl.attributes ? { ...pl.attributes } : undefined
    });
  }
  if (rightPart.length >= 2) {
    upsertPolylines.push({
      id: makeId('pl-trim'),
      points: rightPart,
      isClosed: false,
      layerId: pl.layerId,
      color: pl.color,
      name: pl.name,
      attributes: pl.attributes ? { ...pl.attributes } : undefined
    });
  }
  return {
    preview: {
      hit,
      trimSegments: [trimmedSeg],
      cutPoints,
      mutation: {
        deleteLineIds: [],
        upsertLines: [],
        deletePolylineIds: [pl.id],
        upsertPolylines,
        message: '선택 구간을 잘라냈습니다 (Trim).'
      }
    }
  };
}

/**
 * Join connected CADLines and open CADPolylines into unified CADPolylines
 * (automatically closing into isClosed: true if endpoints meet).
 */
export function joinLinearEntities(
  selectedIds: string[],
  lines: CADLine[],
  polylines: CADPolyline[],
  layers: CADLayer[],
  tolerance = 0.01,
  applyZ = false
): { mutation: CADGeometryMutation | null; error?: string } {
  const idSet = new Set(selectedIds);
  const layerMap = new Map(layers.map(l => [l.id, l]));

  interface Chain {
    sourceLineIds: string[];
    sourcePolylineIds: string[];
    points: Point2D[];
    layerId: string;
    color?: string;
    name?: string;
    attributes?: Record<string, string | number>;
  }

  const chains: Chain[] = [];

  for (const ln of lines) {
    if (!idSet.has(ln.id)) continue;
    if (layerMap.get(ln.layerId)?.locked) continue;
    chains.push({
      sourceLineIds: [ln.id],
      sourcePolylineIds: [],
      points: [
        pickCoord(ln.start, applyZ),
        pickCoord(ln.end, applyZ)
      ],
      layerId: ln.layerId,
      color: ln.color,
      name: ln.name,
      attributes: ln.attributes ? { ...ln.attributes } : undefined
    });
  }

  for (const pl of polylines) {
    if (!idSet.has(pl.id)) continue;
    if (layerMap.get(pl.layerId)?.locked) continue;
    if (pl.isClosed || pl.points.length < 2) continue;
    chains.push({
      sourceLineIds: [],
      sourcePolylineIds: [pl.id],
      points: pl.points.map(p => pickCoord(p, applyZ)),
      layerId: pl.layerId,
      color: pl.color,
      name: pl.name,
      attributes: pl.attributes ? { ...pl.attributes } : undefined
    });
  }

  if (chains.length < 2) {
    return { mutation: null, error: '결합할 열린 선(단일선/연속선)을 2개 이상 선택해 주세요.' };
  }

  // Greedily merge chains whose endpoints touch within tolerance
  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    outer: for (let i = 0; i < chains.length; i++) {
      for (let j = i + 1; j < chains.length; j++) {
        const a = chains[i];
        const b = chains[j];
        const aStart = a.points[0];
        const aEnd = a.points[a.points.length - 1];
        const bStart = b.points[0];
        const bEnd = b.points[b.points.length - 1];

        let combinedPts: Point2D[] | null = null;
        if (distance2D(aEnd, bStart) <= tolerance) {
          combinedPts = [...a.points, ...b.points.slice(1)];
        } else if (distance2D(aEnd, bEnd) <= tolerance) {
          combinedPts = [...a.points, ...b.points.slice(0, -1).reverse()];
        } else if (distance2D(aStart, bEnd) <= tolerance) {
          combinedPts = [...b.points, ...a.points.slice(1)];
        } else if (distance2D(aStart, bStart) <= tolerance) {
          combinedPts = [...b.points.slice(1).reverse(), ...a.points];
        }

        if (combinedPts) {
          a.points = dedupeConsecutivePoints(combinedPts);
          a.sourceLineIds.push(...b.sourceLineIds);
          a.sourcePolylineIds.push(...b.sourcePolylineIds);
          if (!a.attributes && b.attributes) a.attributes = b.attributes;
          chains.splice(j, 1);
          mergedAny = true;
          break outer;
        }
      }
    }
  }

  const joinedChains = chains.filter(c => c.sourceLineIds.length + c.sourcePolylineIds.length >= 2);
  if (joinedChains.length === 0) {
    return { mutation: null, error: '끝점이 서로 맞닿은 선이 없어 결합할 수 없습니다.' };
  }

  const deleteLineIds: string[] = [];
  const deletePolylineIds: string[] = [];
  const upsertPolylines: CADPolyline[] = [];
  let sourceCount = 0;

  for (const ch of joinedChains) {
    deleteLineIds.push(...ch.sourceLineIds);
    deletePolylineIds.push(...ch.sourcePolylineIds);
    sourceCount += ch.sourceLineIds.length + ch.sourcePolylineIds.length;

    let finalPts = [...ch.points];
    let isClosed = false;
    if (finalPts.length >= 3 && distance2D(finalPts[0], finalPts[finalPts.length - 1]) <= tolerance) {
      isClosed = true;
      finalPts = finalPts.slice(0, -1);
    }

    upsertPolylines.push({
      id: makeId('pl-join'),
      points: finalPts,
      isClosed,
      layerId: ch.layerId,
      color: ch.color,
      name: ch.name || '결합선',
      attributes: ch.attributes
    });
  }

  return {
    mutation: {
      deleteLineIds,
      upsertLines: [],
      deletePolylineIds,
      upsertPolylines,
      message: `${sourceCount}개 선을 ${upsertPolylines.length}개 연속선으로 결합했습니다.`
    }
  };
}

function getExtendRay(
  hit: LinearTargetHit,
  lines: CADLine[],
  polylines: CADPolyline[],
  layers: CADLayer[]
): {
  error?: string;
  targetKind?: 'line' | 'polyline';
  entity?: CADLine | CADPolyline;
  extendEnd?: 'start' | 'end';
  fromPoint?: Point2D;
  dir?: Point2D;
  ignoreSegIndex?: number;
} {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  const targetEntity = hit.kind === 'line'
    ? lines.find(l => l.id === hit.id)
    : polylines.find(p => p.id === hit.id);

  if (!targetEntity) return {};

  if (layerMap.get(targetEntity.layerId)?.locked) {
    return { error: '잠긴 레이어의 객체는 수정할 수 없습니다.' };
  }

  if (hit.kind === 'polyline') {
    const pl = targetEntity as CADPolyline;
    if (pl.isClosed) {
      return { error: '폐합된 도형은 연장(Extend)할 수 없습니다.' };
    }
    if (pl.points.length < 2) return {};

    const extendEnd: 'start' | 'end' = hit.arcLength <= hit.totalLength / 2 ? 'start' : 'end';
    if (extendEnd === 'start') {
      const fromPoint = pl.points[0];
      let refPoint: Point2D | null = null;
      for (let i = 1; i < pl.points.length; i++) {
        if (distance2D(fromPoint, pl.points[i]) > EPS) {
          refPoint = pl.points[i];
          break;
        }
      }
      if (!refPoint) return {};
      const dx = fromPoint.x - refPoint.x;
      const dy = fromPoint.y - refPoint.y;
      const len = Math.hypot(dx, dy);
      if (len <= EPS) return {};
      return {
        targetKind: 'polyline',
        entity: pl,
        extendEnd,
        fromPoint,
        dir: { x: dx / len, y: dy / len },
        ignoreSegIndex: 0
      };
    } else {
      const lastIdx = pl.points.length - 1;
      const fromPoint = pl.points[lastIdx];
      let refPoint: Point2D | null = null;
      for (let i = lastIdx - 1; i >= 0; i--) {
        if (distance2D(fromPoint, pl.points[i]) > EPS) {
          refPoint = pl.points[i];
          break;
        }
      }
      if (!refPoint) return {};
      const dx = fromPoint.x - refPoint.x;
      const dy = fromPoint.y - refPoint.y;
      const len = Math.hypot(dx, dy);
      if (len <= EPS) return {};
      return {
        targetKind: 'polyline',
        entity: pl,
        extendEnd,
        fromPoint,
        dir: { x: dx / len, y: dy / len },
        ignoreSegIndex: lastIdx - 1
      };
    }
  }

  const ln = targetEntity as CADLine;
  const dx = ln.end.x - ln.start.x;
  const dy = ln.end.y - ln.start.y;
  const len = Math.hypot(dx, dy);
  if (len <= EPS) return {};

  const extendEnd: 'start' | 'end' = hit.arcLength <= hit.totalLength / 2 ? 'start' : 'end';
  const ux = dx / len;
  const uy = dy / len;

  return {
    targetKind: 'line',
    entity: ln,
    extendEnd,
    fromPoint: extendEnd === 'start' ? { ...ln.start } : { ...ln.end },
    dir: extendEnd === 'start' ? { x: -ux, y: -uy } : { x: ux, y: uy },
    ignoreSegIndex: 0
  };
}

function buildExtendMutation(
  targetKind: 'line' | 'polyline',
  entity: CADLine | CADPolyline,
  extendEnd: 'start' | 'end',
  toPoint: Point2D,
  message: string
): CADGeometryMutation {
  if (targetKind === 'line') {
    const ln = entity as CADLine;
    const updatedLine: CADLine = {
      ...ln,
      start: extendEnd === 'start' ? { ...toPoint } : { ...ln.start },
      end: extendEnd === 'end' ? { ...toPoint } : { ...ln.end }
    };
    return {
      deleteLineIds: [],
      upsertLines: [updatedLine],
      deletePolylineIds: [],
      upsertPolylines: [],
      message
    };
  }

  const pl = entity as CADPolyline;
  const updatedPts = pl.points.map(p => ({ ...p }));
  if (extendEnd === 'start') {
    updatedPts[0] = { ...toPoint };
  } else {
    updatedPts[updatedPts.length - 1] = { ...toPoint };
  }
  const updatedPl: CADPolyline = {
    ...pl,
    points: updatedPts
  };
  return {
    deleteLineIds: [],
    upsertLines: [],
    deletePolylineIds: [],
    upsertPolylines: [updatedPl],
    message
  };
}

/**
 * Extend a CADLine or open CADPolyline end by an exact distance (meters) along its direction vector.
 */
export function computeExtendByDistanceOperation(
  hit: LinearTargetHit,
  distanceMeters: number,
  lines: CADLine[],
  polylines: CADPolyline[],
  layers: CADLayer[]
): { preview: ExtendPreviewResult | null; error?: string } {
  if (!isFinite(distanceMeters) || distanceMeters <= 0) {
    return { preview: null, error: '연장할 치수(m)를 0보다 크게 입력해 주세요.' };
  }

  const ray = getExtendRay(hit, lines, polylines, layers);
  if (ray.error) return { preview: null, error: ray.error };
  if (!ray.entity || !ray.targetKind || !ray.extendEnd || !ray.fromPoint || !ray.dir) {
    return { preview: null };
  }

  const toPoint: Point2D = {
    x: ray.fromPoint.x + ray.dir.x * distanceMeters,
    y: ray.fromPoint.y + ray.dir.y * distanceMeters
  };

  return {
    preview: {
      hit,
      extendEnd: ray.extendEnd,
      fromPoint: ray.fromPoint,
      toPoint,
      addedLength: distanceMeters,
      mutation: buildExtendMutation(
        ray.targetKind,
        ray.entity,
        ray.extendEnd,
        toPoint,
        `${distanceMeters.toFixed(3)}m 연장했습니다 (Extend).`
      )
    }
  };
}

function raySegmentIntersection(
  origin: Point2D,
  dir: Point2D,
  p3: Point2D,
  p4: Point2D
): { point: Point2D; t: number } | null {
  const rx = dir.x;
  const ry = dir.y;
  const sx = p4.x - p3.x;
  const sy = p4.y - p3.y;

  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-10) return null;

  const qpx = p3.x - origin.x;
  const qpy = p3.y - origin.y;

  const t = (qpx * sy - qpy * sx) / denom;
  const u = (qpx * ry - qpy * rx) / denom;

  if (t > 1e-4 && u >= -1e-5 && u <= 1 + 1e-5) {
    return {
      point: {
        x: origin.x + t * rx,
        y: origin.y + t * ry
      },
      t
    };
  }
  return null;
}

/**
 * Extend a CADLine or open CADPolyline end until it reaches the nearest visible boundary edge.
 */
export function computeExtendToBoundaryOperation(
  hit: LinearTargetHit,
  lines: CADLine[],
  polylines: CADPolyline[],
  polygons: CADPolygon[],
  layers: CADLayer[]
): { preview: ExtendPreviewResult | null; error?: string } {
  const ray = getExtendRay(hit, lines, polylines, layers);
  if (ray.error) return { preview: null, error: ray.error };
  if (!ray.entity || !ray.targetKind || !ray.extendEnd || !ray.fromPoint || !ray.dir) {
    return { preview: null };
  }

  const layerMap = new Map(layers.map(l => [l.id, l]));
  let bestT = Infinity;
  let bestPt: Point2D | null = null;

  const considerSegment = (ownerId: string, segIdx: number, p1: Point2D, p2: Point2D) => {
    if (ownerId === hit.id && segIdx === ray.ignoreSegIndex) return;
    const res = raySegmentIntersection(ray.fromPoint!, ray.dir!, p1, p2);
    if (res && res.t < bestT) {
      bestT = res.t;
      bestPt = res.point;
    }
  };

  for (const ln of lines) {
    const lay = layerMap.get(ln.layerId);
    if (lay && !lay.visible) continue;
    considerSegment(ln.id, 0, ln.start, ln.end);
  }
  for (const pl of polylines) {
    const lay = layerMap.get(pl.layerId);
    if (lay && !lay.visible) continue;
    const chain = getChainWithArcLengths({ kind: 'polyline', data: pl }).pts;
    for (let i = 0; i < chain.length - 1; i++) {
      considerSegment(pl.id, i, chain[i], chain[i + 1]);
    }
  }
  for (const pg of polygons) {
    const lay = layerMap.get(pg.layerId);
    if (lay && !lay.visible) continue;
    for (let i = 0; i < pg.points.length; i++) {
      considerSegment(pg.id, i, pg.points[i], pg.points[(i + 1) % pg.points.length]);
    }
  }

  if (!bestPt || !isFinite(bestT)) {
    return { preview: null, error: '연장 방향에 닿는 경계 선이 없습니다.' };
  }

  return {
    preview: {
      hit,
      extendEnd: ray.extendEnd,
      fromPoint: ray.fromPoint,
      toPoint: bestPt,
      addedLength: bestT,
      mutation: buildExtendMutation(
        ray.targetKind,
        ray.entity,
        ray.extendEnd,
        bestPt,
        `경계선까지 ${bestT.toFixed(3)}m 연장했습니다 (Extend).`
      )
    }
  };
}

/**
 * Translate all selected CAD entities (points, lines, polylines, polygons, texts) by (dx, dy).
 * Respects locked layers and preserves all attributes & IDs.
 */
export function moveEntitiesByDelta(
  selectedIds: string[],
  dx: number,
  dy: number,
  entities: {
    points: CADPoint[];
    lines: CADLine[];
    polylines: CADPolyline[];
    polygons: CADPolygon[];
    texts: CADText[];
    layers: CADLayer[];
  }
): { mutation: CADGeometryMutation | null; movedCount: number; skippedLockedCount: number; error?: string } {
  if (!isFinite(dx) || !isFinite(dy)) {
    return { mutation: null, movedCount: 0, skippedLockedCount: 0, error: '유효한 이동 거리(ΔX, ΔY)를 입력해 주세요.' };
  }
  if (Math.hypot(dx, dy) <= 1e-6) {
    return { mutation: null, movedCount: 0, skippedLockedCount: 0, error: '이동 거리가 0입니다.' };
  }
  if (selectedIds.length === 0) {
    return { mutation: null, movedCount: 0, skippedLockedCount: 0, error: '먼저 이동할 객체를 선택해 주세요.' };
  }

  const idSet = new Set(selectedIds);
  const layerMap = new Map(entities.layers.map(l => [l.id, l]));
  let skippedLockedCount = 0;

  const upsertPoints: CADPoint[] = [];
  const upsertLines: CADLine[] = [];
  const upsertPolylines: CADPolyline[] = [];
  const upsertPolygons: CADPolygon[] = [];
  const upsertTexts: CADText[] = [];

  for (const pt of entities.points) {
    if (!idSet.has(pt.id)) continue;
    if (layerMap.get(pt.layerId)?.locked) {
      skippedLockedCount++;
      continue;
    }
    upsertPoints.push({ ...pt, x: pt.x + dx, y: pt.y + dy });
  }

  for (const ln of entities.lines) {
    if (!idSet.has(ln.id)) continue;
    if (layerMap.get(ln.layerId)?.locked) {
      skippedLockedCount++;
      continue;
    }
    upsertLines.push({
      ...ln,
      start: { ...ln.start, x: ln.start.x + dx, y: ln.start.y + dy },
      end: { ...ln.end, x: ln.end.x + dx, y: ln.end.y + dy }
    });
  }

  for (const pl of entities.polylines) {
    if (!idSet.has(pl.id)) continue;
    if (layerMap.get(pl.layerId)?.locked) {
      skippedLockedCount++;
      continue;
    }
    upsertPolylines.push({
      ...pl,
      points: pl.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }))
    });
  }

  for (const pg of entities.polygons) {
    if (!idSet.has(pg.id)) continue;
    if (layerMap.get(pg.layerId)?.locked) {
      skippedLockedCount++;
      continue;
    }
    upsertPolygons.push({
      ...pg,
      points: pg.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy }))
    });
  }

  for (const t of entities.texts) {
    if (!idSet.has(t.id)) continue;
    if (layerMap.get(t.layerId)?.locked) {
      skippedLockedCount++;
      continue;
    }
    upsertTexts.push({ ...t, x: t.x + dx, y: t.y + dy });
  }

  const movedCount =
    upsertPoints.length +
    upsertLines.length +
    upsertPolylines.length +
    upsertPolygons.length +
    upsertTexts.length;

  if (movedCount === 0) {
    return {
      mutation: null,
      movedCount: 0,
      skippedLockedCount,
      error: skippedLockedCount > 0
        ? '잠긴 레이어의 객체는 이동할 수 없습니다.'
        : '이동할 수 있는 선택 객체가 없습니다.'
    };
  }

  const lockedNote = skippedLockedCount > 0 ? ` (잠긴 레이어 ${skippedLockedCount}개 제외)` : '';
  return {
    movedCount,
    skippedLockedCount,
    mutation: {
      deleteLineIds: [],
      upsertLines,
      deletePolylineIds: [],
      upsertPolylines,
      upsertPoints,
      upsertPolygons,
      upsertTexts,
      message: `${movedCount}개 객체를 (ΔX ${dx >= 0 ? '+' : ''}${dx.toFixed(3)}m, ΔY ${dy >= 0 ? '+' : ''}${dy.toFixed(3)}m) 이동했습니다.${lockedNote}`
    }
  };
}

export interface OffsetTargetHit {
  kind: 'line' | 'polyline' | 'polygon';
  id: string;
  layerId: string;
  segIndex: number;
  point: Point2D;
  distance: number;
  isClosed: boolean;
}

export interface OffsetPreviewResult {
  target: OffsetTargetHit;
  previewPoints: Point2D[];
  isClosed: boolean;
  signedDistance: number;
  guideFrom: Point2D;
  guideTo: Point2D;
  mutation: CADGeometryMutation;
}

/**
 * Find closest line, polyline, or polygon edge within maxRadius for Offset tool.
 */
export function findClosestOffsetTarget(
  cursorWorld: Point2D,
  maxRadius: number,
  lines: CADLine[],
  polylines: CADPolyline[],
  polygons: CADPolygon[],
  layers: CADLayer[]
): OffsetTargetHit | null {
  const layerMap = new Map(layers.map(l => [l.id, l]));
  let best: OffsetTargetHit | null = null;
  let bestDist = maxRadius;

  for (const ln of lines) {
    const lay = layerMap.get(ln.layerId);
    if (lay && !lay.visible) continue;
    const minX = Math.min(ln.start.x, ln.end.x) - bestDist;
    const maxX = Math.max(ln.start.x, ln.end.x) + bestDist;
    const minY = Math.min(ln.start.y, ln.end.y) - bestDist;
    const maxY = Math.max(ln.start.y, ln.end.y) + bestDist;
    if (cursorWorld.x < minX || cursorWorld.x > maxX || cursorWorld.y < minY || cursorWorld.y > maxY) continue;

    const proj = closestPointOnSegment(cursorWorld, ln.start, ln.end);
    if (proj.distance < bestDist) {
      bestDist = proj.distance;
      best = {
        kind: 'line',
        id: ln.id,
        layerId: ln.layerId,
        segIndex: 0,
        point: proj.point,
        distance: proj.distance,
        isClosed: false
      };
    }
  }

  for (const pl of polylines) {
    const lay = layerMap.get(pl.layerId);
    if (lay && !lay.visible) continue;
    if (pl.points.length < 2) continue;

    const { pts, isClosed } = getChainWithArcLengths({ kind: 'polyline', data: pl });
    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      if (
        cursorWorld.x < Math.min(p1.x, p2.x) - bestDist ||
        cursorWorld.x > Math.max(p1.x, p2.x) + bestDist ||
        cursorWorld.y < Math.min(p1.y, p2.y) - bestDist ||
        cursorWorld.y > Math.max(p1.y, p2.y) + bestDist
      ) continue;

      const proj = closestPointOnSegment(cursorWorld, p1, p2);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        best = {
          kind: 'polyline',
          id: pl.id,
          layerId: pl.layerId,
          segIndex: i,
          point: proj.point,
          distance: proj.distance,
          isClosed
        };
      }
    }
  }

  for (const pg of polygons) {
    const lay = layerMap.get(pg.layerId);
    if (lay && !lay.visible) continue;
    if (pg.points.length < 3) continue;

    for (let i = 0; i < pg.points.length; i++) {
      const p1 = pg.points[i];
      const p2 = pg.points[(i + 1) % pg.points.length];
      if (
        cursorWorld.x < Math.min(p1.x, p2.x) - bestDist ||
        cursorWorld.x > Math.max(p1.x, p2.x) + bestDist ||
        cursorWorld.y < Math.min(p1.y, p2.y) - bestDist ||
        cursorWorld.y > Math.max(p1.y, p2.y) + bestDist
      ) continue;

      const proj = closestPointOnSegment(cursorWorld, p1, p2);
      if (proj.distance < bestDist) {
        bestDist = proj.distance;
        best = {
          kind: 'polygon',
          id: pg.id,
          layerId: pg.layerId,
          segIndex: i,
          point: proj.point,
          distance: proj.distance,
          isClosed: true
        };
      }
    }
  }

  return best;
}

function signedPolygonArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return area * 0.5;
}

function offsetCornerJoin(
  vertex: Point2D,
  u1: Point2D,
  n1: Point2D,
  u2: Point2D,
  n2: Point2D,
  signedDist: number
): Point2D[] {
  const p1: Point2D = { x: vertex.x + n1.x * signedDist, y: vertex.y + n1.y * signedDist };
  const p2: Point2D = { x: vertex.x + n2.x * signedDist, y: vertex.y + n2.y * signedDist };

  const cross = u1.x * u2.y - u1.y * u2.x;
  const dot = u1.x * u2.x + u1.y * u2.y;

  if (Math.abs(cross) < 1e-4) {
    if (dot > 0) {
      return [{ x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 }];
    }
    return [p1, p2];
  }

  const t = ((p2.x - p1.x) * u2.y - (p2.y - p1.y) * u2.x) / cross;
  const miter: Point2D = {
    x: p1.x + u1.x * t,
    y: p1.y + u1.y * t
  };

  if (distance2D(miter, vertex) > Math.abs(signedDist) * 4) {
    return [p1, p2];
  }

  return [miter];
}

/**
 * Create a parallel offset copy of a CADLine, CADPolyline (open/closed), or CADPolygon
 * toward the side of sidePoint by distanceMeters.
 */
export function computeOffsetOperation(
  target: OffsetTargetHit,
  sidePoint: Point2D,
  distanceMeters: number,
  lines: CADLine[],
  polylines: CADPolyline[],
  polygons: CADPolygon[],
  layers: CADLayer[],
  fallbackLayerId: string
): { preview: OffsetPreviewResult | null; error?: string } {
  if (!isFinite(distanceMeters) || distanceMeters <= 0) {
    return { preview: null, error: '띄울 간격(m)을 0보다 크게 입력해 주세요.' };
  }

  const layerMap = new Map(layers.map(l => [l.id, l]));
  const destLayerId = (targetLayerId: string) =>
    layerMap.get(targetLayerId)?.locked ? fallbackLayerId : targetLayerId;

  if (target.kind === 'line') {
    const ln = lines.find(l => l.id === target.id);
    if (!ln) return { preview: null };
    const dx = ln.end.x - ln.start.x;
    const dy = ln.end.y - ln.start.y;
    const len = Math.hypot(dx, dy);
    if (len <= EPS) return { preview: null, error: '길이가 너무 짧은 선은 간격띄우기할 수 없습니다.' };

    const nx = -dy / len;
    const ny = dx / len;
    const cross = dx * (sidePoint.y - ln.start.y) - dy * (sidePoint.x - ln.start.x);
    const signedDist = cross >= 0 ? distanceMeters : -distanceMeters;

    const newStart: Point2D = { x: ln.start.x + nx * signedDist, y: ln.start.y + ny * signedDist };
    const newEnd: Point2D = { x: ln.end.x + nx * signedDist, y: ln.end.y + ny * signedDist };
    const guideTo: Point2D = { x: target.point.x + nx * signedDist, y: target.point.y + ny * signedDist };

    const newLine: CADLine = {
      id: makeId('ln-off'),
      start: newStart,
      end: newEnd,
      layerId: destLayerId(ln.layerId),
      color: ln.color,
      name: ln.name ? `${ln.name}_offset` : '간격띄우기선'
    };

    return {
      preview: {
        target,
        previewPoints: [newStart, newEnd],
        isClosed: false,
        signedDistance: signedDist,
        guideFrom: target.point,
        guideTo,
        mutation: {
          deleteLineIds: [],
          upsertLines: [newLine],
          deletePolylineIds: [],
          upsertPolylines: [],
          message: `${distanceMeters.toFixed(3)}m 간격으로 평행선을 생성했습니다 (Offset).`
        }
      }
    };
  }

  const rawPoints = target.kind === 'polyline'
    ? polylines.find(p => p.id === target.id)?.points
    : polygons.find(p => p.id === target.id)?.points;
  const srcEntity = target.kind === 'polyline'
    ? polylines.find(p => p.id === target.id)
    : polygons.find(p => p.id === target.id);

  if (!rawPoints || !srcEntity) return { preview: null };

  const isClosed = target.kind === 'polygon' || !!(srcEntity as CADPolyline).isClosed;
  let cleanPts = dedupeConsecutivePoints(rawPoints);
  if (isClosed && cleanPts.length >= 3 && distance2D(cleanPts[0], cleanPts[cleanPts.length - 1]) <= 1e-4) {
    cleanPts = cleanPts.slice(0, -1);
  }

  if ((!isClosed && cleanPts.length < 2) || (isClosed && cleanPts.length < 3)) {
    return { preview: null, error: '간격띄우기를 수행할 꼭짓점이 부족합니다.' };
  }

  const segCount = isClosed ? cleanPts.length : cleanPts.length - 1;
  const segDirs: { u: Point2D; n: Point2D; a: Point2D; b: Point2D }[] = [];
  for (let i = 0; i < segCount; i++) {
    const a = cleanPts[i];
    const b = cleanPts[(i + 1) % cleanPts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len <= EPS) continue;
    const u = { x: dx / len, y: dy / len };
    const n = { x: -u.y, y: u.x };
    segDirs.push({ u, n, a, b });
  }

  if (segDirs.length === 0) {
    return { preview: null, error: '유효한 세그먼트가 없어 간격띄우기할 수 없습니다.' };
  }

  const refIdx = Math.max(0, Math.min(segDirs.length - 1, target.segIndex));
  const refSeg = segDirs[refIdx];
  const refCross = (refSeg.b.x - refSeg.a.x) * (sidePoint.y - refSeg.a.y) - (refSeg.b.y - refSeg.a.y) * (sidePoint.x - refSeg.a.x);
  const signedDist = refCross >= 0 ? distanceMeters : -distanceMeters;
  const guideTo: Point2D = {
    x: target.point.x + refSeg.n.x * signedDist,
    y: target.point.y + refSeg.n.y * signedDist
  };

  let offsetPts: Point2D[] = [];
  if (!isClosed) {
    offsetPts.push({
      x: segDirs[0].a.x + segDirs[0].n.x * signedDist,
      y: segDirs[0].a.y + segDirs[0].n.y * signedDist
    });
    for (let i = 1; i < segDirs.length; i++) {
      const joined = offsetCornerJoin(
        segDirs[i].a,
        segDirs[i - 1].u,
        segDirs[i - 1].n,
        segDirs[i].u,
        segDirs[i].n,
        signedDist
      );
      offsetPts.push(...joined);
    }
    const lastSeg = segDirs[segDirs.length - 1];
    offsetPts.push({
      x: lastSeg.b.x + lastSeg.n.x * signedDist,
      y: lastSeg.b.y + lastSeg.n.y * signedDist
    });
    offsetPts = dedupeConsecutivePoints(offsetPts);
    if (offsetPts.length < 2) {
      return { preview: null, error: '간격띄우기 결과를 생성할 수 없습니다.' };
    }
  } else {
    for (let i = 0; i < segDirs.length; i++) {
      const prevSeg = segDirs[(i - 1 + segDirs.length) % segDirs.length];
      const currSeg = segDirs[i];
      const joined = offsetCornerJoin(
        currSeg.a,
        prevSeg.u,
        prevSeg.n,
        currSeg.u,
        currSeg.n,
        signedDist
      );
      offsetPts.push(...joined);
    }
    offsetPts = dedupeConsecutivePoints(offsetPts);
    if (offsetPts.length >= 3 && distance2D(offsetPts[0], offsetPts[offsetPts.length - 1]) <= 1e-4) {
      offsetPts = offsetPts.slice(0, -1);
    }
    if (offsetPts.length < 3) {
      return { preview: null, error: `간격(${distanceMeters}m)이 도형 크기보다 커서 안쪽으로 생성할 수 없습니다.` };
    }
    const origArea = signedPolygonArea(cleanPts);
    const newArea = signedPolygonArea(offsetPts);
    if (Math.abs(newArea) < 1e-4 || origArea * newArea <= 0) {
      return { preview: null, error: `간격(${distanceMeters}m)이 도형 크기보다 커서 안쪽으로 생성할 수 없습니다.` };
    }
  }

  if (target.kind === 'polygon') {
    const pg = srcEntity as CADPolygon;
    const newPoly: CADPolygon = {
      id: makeId('poly-off'),
      points: offsetPts,
      layerId: destLayerId(pg.layerId),
      color: pg.color,
      name: pg.name ? `${pg.name}_offset` : '간격띄우기구역',
      fillOpacity: pg.fillOpacity
    };
    return {
      preview: {
        target,
        previewPoints: offsetPts,
        isClosed: true,
        signedDistance: signedDist,
        guideFrom: target.point,
        guideTo,
        mutation: {
          deleteLineIds: [],
          upsertLines: [],
          deletePolylineIds: [],
          upsertPolylines: [],
          upsertPolygons: [newPoly],
          message: `${distanceMeters.toFixed(3)}m 간격으로 폴리곤을 복제했습니다 (Offset).`
        }
      }
    };
  }

  const pl = srcEntity as CADPolyline;
  const newPl: CADPolyline = {
    id: makeId('pl-off'),
    points: offsetPts,
    isClosed,
    layerId: destLayerId(pl.layerId),
    color: pl.color,
    name: pl.name ? `${pl.name}_offset` : '간격띄우기선'
  };
  return {
    preview: {
      target,
      previewPoints: offsetPts,
      isClosed,
      signedDistance: signedDist,
      guideFrom: target.point,
      guideTo,
      mutation: {
        deleteLineIds: [],
        upsertLines: [],
        deletePolylineIds: [],
        upsertPolylines: [newPl],
        message: `${distanceMeters.toFixed(3)}m 간격으로 연속선을 생성했습니다 (Offset).`
      }
    }
  };
}
