/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLayer, CADLine, CADPolygon, CADPolyline, Point2D } from '../types/cad';
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

  return {
    id: makeId('rect'),
    name: name || '사각형',
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY }
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
  if (anchor === 'center') {
    const hw = Math.abs(width) / 2;
    const hh = Math.abs(height) / 2;
    return createRectanglePolyline(
      { x: basePoint.x - hw, y: basePoint.y - hh },
      { x: basePoint.x + hw, y: basePoint.y + hh },
      layerId,
      name
    );
  }
  return createRectanglePolyline(
    basePoint,
    { x: basePoint.x + width, y: basePoint.y + height },
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
  const pts: Point2D[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (Math.PI * 2 * i) / segments;
    pts.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius
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

/**
 * Unwraps a line or polyline (including closing segment if closed) into an explicit open vertex chain
 * along with cumulative arc-lengths at each vertex.
 */
function getChainWithArcLengths(
  entity: { kind: 'line'; data: CADLine } | { kind: 'polyline'; data: CADPolyline }
): { pts: Point2D[]; cumLen: number[]; totalLength: number; isClosed: boolean } {
  let pts: Point2D[];
  let isClosed = false;

  if (entity.kind === 'line') {
    pts = [{ ...entity.data.start }, { ...entity.data.end }];
  } else {
    pts = entity.data.points.map(p => ({ ...p }));
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
      res.push({ x: p.x, y: p.y });
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
        cursorWorld.y > Math.max(p1.y, p2.y) + minRadiusPad(bestDist)
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

function minRadiusPad(r: number): number {
  return r;
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
  tolerance = 0.01
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
      points: [{ ...ln.start }, { ...ln.end }],
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
      points: pl.points.map(p => ({ ...p })),
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
