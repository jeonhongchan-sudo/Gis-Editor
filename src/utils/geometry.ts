/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLine, CADPoint, CADPolygon, CADPolyline, Point2D, SnapPoint, SnapType } from '../types/cad';

export function distance2D(p1: Point2D, p2: Point2D): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function calculatePolylineLength(points: Point2D[]): number {
  if (points.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) {
    len += distance2D(points[i], points[i + 1]);
  }
  return len;
}

export function calculatePolygonArea(points: Point2D[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2.0;
}

export function metersToPyeong(sqMeters: number): number {
  return sqMeters / 3.305785;
}

export function midpoint2D(p1: Point2D, p2: Point2D): Point2D {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2
  };
}

/**
 * Returns closest point on segment p1-p2 to point p, and the distance
 */
export function closestPointOnSegment(p: Point2D, p1: Point2D, p2: Point2D): { point: Point2D; distance: number; t: number } {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) {
    return { point: { ...p1 }, distance: distance2D(p, p1), t: 0 };
  }
  let t = ((p.x - p1.x) * dx + (p.y - p1.y) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  const proj = {
    x: p1.x + t * dx,
    y: p1.y + t * dy
  };
  return { point: proj, distance: distance2D(p, proj), t };
}

/**
 * Line segment intersection test
 */
export function lineIntersection(
  p1: Point2D, p2: Point2D,
  p3: Point2D, p4: Point2D
): Point2D | null {
  const d = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(d) < 1e-9) return null;

  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / d;
  const u = -((p1.x - p2.x) * (p1.y - p3.y) - (p1.y - p2.y) * (p1.x - p3.x)) / d;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return {
      x: p1.x + t * (p2.x - p1.x),
      y: p1.y + t * (p2.y - p1.y)
    };
  }
  return null;
}

export interface FindSnapOptions {
  worldCursor: Point2D;
  worldRadius: number; // Search radius in CAD world units (meters)
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts?: import('../types/cad').CADText[];
  activePoints?: Point2D[]; // currently being drawn
  enabledSnapTypes?: Partial<Record<SnapType, boolean>>;
}

/**
 * Find highest priority snap point near cursor
 * Priority: Node / Vertex Point > Endpoint > Midpoint > Intersection > Nearest
 */
export function findSnapPoint(opts: FindSnapOptions): SnapPoint | null {
  const {
    worldCursor,
    worldRadius,
    points,
    lines,
    polylines,
    polygons,
    texts = [],
    activePoints = [],
    enabledSnapTypes = { node: true, endpoint: true, midpoint: true, intersection: true, nearest: true }
  } = opts;

  let bestSnap: SnapPoint | null = null;
  let minDistance = worldRadius;

  // 1. Survey Points & Nodes
  if (enabledSnapTypes.node !== false) {
    for (const pt of points) {
      if (Math.abs(pt.x - worldCursor.x) > minDistance || Math.abs(pt.y - worldCursor.y) > minDistance) continue;
      const d = distance2D(worldCursor, pt);
      if (d < minDistance) {
        minDistance = d;
        bestSnap = {
          point: { x: pt.x, y: pt.y, z: pt.z },
          type: 'node',
          sourceId: pt.id,
          label: pt.name ? `측점 [${pt.name}]` : '점 (Node)'
        };
      }
    }

    // Text anchor nodes (user requirement: "우리 도면은 텍스트가 노드점이 돼")
    for (const txt of texts) {
      if (Math.abs(txt.x - worldCursor.x) > minDistance || Math.abs(txt.y - worldCursor.y) > minDistance) continue;
      const d = distance2D(worldCursor, { x: txt.x, y: txt.y });
      if (d < minDistance) {
        minDistance = d;
        bestSnap = {
          point: { x: txt.x, y: txt.y },
          type: 'node',
          sourceId: txt.id,
          label: txt.text ? `측점/텍스트 [${txt.text}]` : '텍스트 노드'
        };
      }
    }
  }

  // Active polyline points (e.g. closing polygon back to first vertex)
  if (activePoints.length > 0) {
    for (let i = 0; i < activePoints.length; i++) {
      const pt = activePoints[i];
      if (Math.abs(pt.x - worldCursor.x) > minDistance || Math.abs(pt.y - worldCursor.y) > minDistance) continue;
      const d = distance2D(worldCursor, pt);
      if (d < minDistance) {
        minDistance = d;
        bestSnap = {
          point: { x: pt.x, y: pt.y },
          type: 'endpoint',
          label: i === 0 ? '시작점 (폐합)' : `버텍스 #${i + 1}`
        };
      }
    }
  }

  // 2. Endpoints & Vertices of lines & polylines
  if (enabledSnapTypes.endpoint !== false) {
    for (const line of lines) {
      if (Math.abs(line.start.x - worldCursor.x) <= minDistance && Math.abs(line.start.y - worldCursor.y) <= minDistance) {
        const d1 = distance2D(worldCursor, line.start);
        if (d1 < minDistance) {
          minDistance = d1;
          bestSnap = { point: { ...line.start }, type: 'endpoint', label: '선 끝점' };
        }
      }
      if (Math.abs(line.end.x - worldCursor.x) <= minDistance && Math.abs(line.end.y - worldCursor.y) <= minDistance) {
        const d2 = distance2D(worldCursor, line.end);
        if (d2 < minDistance) {
          minDistance = d2;
          bestSnap = { point: { ...line.end }, type: 'endpoint', label: '선 끝점' };
        }
      }
    }

    // Check ALL vertices of polylines
    for (const pl of polylines) {
      for (let i = 0; i < pl.points.length; i++) {
        const pt = pl.points[i];
        if (Math.abs(pt.x - worldCursor.x) <= minDistance && Math.abs(pt.y - worldCursor.y) <= minDistance) {
          const d = distance2D(worldCursor, pt);
          if (d < minDistance) {
            minDistance = d;
            const isEnd = i === 0 || i === pl.points.length - 1;
            bestSnap = {
              point: { ...pt },
              type: 'endpoint',
              label: isEnd ? (i === 0 ? '선 시작점' : '선 끝점') : `선 굴절점 #${i + 1}`
            };
          }
        }
      }
    }

    for (const poly of polygons) {
      for (let i = 0; i < poly.points.length; i++) {
        const pt = poly.points[i];
        if (Math.abs(pt.x - worldCursor.x) > minDistance || Math.abs(pt.y - worldCursor.y) > minDistance) continue;
        const d = distance2D(worldCursor, pt);
        if (d < minDistance) {
          minDistance = d;
          bestSnap = { point: { ...pt }, type: 'endpoint', label: `꼭짓점 #${i + 1}` };
        }
      }
    }
  }

  // 3. Midpoints
  if (enabledSnapTypes.midpoint !== false) {
    for (const line of lines) {
      const mid = midpoint2D(line.start, line.end);
      if (Math.abs(mid.x - worldCursor.x) > minDistance || Math.abs(mid.y - worldCursor.y) > minDistance) continue;
      const d = distance2D(worldCursor, mid);
      if (d < minDistance) {
        minDistance = d;
        bestSnap = { point: mid, type: 'midpoint', label: '중간점 (Midpoint)' };
      }
    }

    for (const pl of polylines) {
      for (let i = 0; i < pl.points.length - 1; i++) {
        const p1 = pl.points[i];
        const p2 = pl.points[i + 1];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;
        if (Math.abs(midX - worldCursor.x) > minDistance || Math.abs(midY - worldCursor.y) > minDistance) continue;
        const mid = { x: midX, y: midY };
        const d = distance2D(worldCursor, mid);
        if (d < minDistance) {
          minDistance = d;
          bestSnap = { point: mid, type: 'midpoint', label: '중간점 (Midpoint)' };
        }
      }
      if (pl.isClosed && pl.points.length >= 2) {
        const p1 = pl.points[pl.points.length - 1];
        const p2 = pl.points[0];
        if (p1.x !== p2.x || p1.y !== p2.y) {
          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;
          if (Math.abs(midX - worldCursor.x) <= minDistance && Math.abs(midY - worldCursor.y) <= minDistance) {
            const mid = { x: midX, y: midY };
            const d = distance2D(worldCursor, mid);
            if (d < minDistance) {
              minDistance = d;
              bestSnap = { point: mid, type: 'midpoint', label: '중간점 (Midpoint)' };
            }
          }
        }
      }
    }
  }

  // 4. Nearest along segments (within bounding box)
  if (!bestSnap && enabledSnapTypes.nearest !== false) {
    for (const line of lines) {
      const minX = Math.min(line.start.x, line.end.x) - minDistance;
      const maxX = Math.max(line.start.x, line.end.x) + minDistance;
      const minY = Math.min(line.start.y, line.end.y) - minDistance;
      const maxY = Math.max(line.start.y, line.end.y) + minDistance;
      if (worldCursor.x < minX || worldCursor.x > maxX || worldCursor.y < minY || worldCursor.y > maxY) continue;

      const { point, distance } = closestPointOnSegment(worldCursor, line.start, line.end);
      if (distance < minDistance) {
        minDistance = distance;
        bestSnap = { point, type: 'nearest', label: '선 상의 점 (Nearest)' };
      }
    }
  }

  return bestSnap;
}

export interface BoundingBox2D {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function isPointInBox(p: Point2D, box: BoundingBox2D): boolean {
  return p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
}

export function isLineInOrIntersectBox(p1: Point2D, p2: Point2D, box: BoundingBox2D): boolean {
  // If either point is inside the box
  if (isPointInBox(p1, box) || isPointInBox(p2, box)) return true;

  // Box bounds check
  const lineMinX = Math.min(p1.x, p2.x);
  const lineMaxX = Math.max(p1.x, p2.x);
  const lineMinY = Math.min(p1.y, p2.y);
  const lineMaxY = Math.max(p1.y, p2.y);
  if (lineMaxX < box.minX || lineMinX > box.maxX || lineMaxY < box.minY || lineMinY > box.maxY) {
    return false;
  }

  // Check 4 edges of the box
  const tl: Point2D = { x: box.minX, y: box.maxY };
  const tr: Point2D = { x: box.maxX, y: box.maxY };
  const bl: Point2D = { x: box.minX, y: box.minY };
  const br: Point2D = { x: box.maxX, y: box.minY };

  if (lineIntersection(p1, p2, tl, tr)) return true;
  if (lineIntersection(p1, p2, tr, br)) return true;
  if (lineIntersection(p1, p2, br, bl)) return true;
  if (lineIntersection(p1, p2, bl, tl)) return true;

  return false;
}

export function isPolylineInOrIntersectBox(pts: Point2D[], box: BoundingBox2D, isClosed?: boolean): boolean {
  for (let i = 0; i < pts.length; i++) {
    if (isPointInBox(pts[i], box)) return true;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    if (isLineInOrIntersectBox(pts[i], pts[i + 1], box)) return true;
  }
  if (isClosed && pts.length >= 2) {
    if (isLineInOrIntersectBox(pts[pts.length - 1], pts[0], box)) return true;
  }
  return false;
}

/**
 * Calculate total bounding box across all entities
 */
export function calculateExtents(
  points: CADPoint[],
  lines: CADLine[],
  polylines: CADPolyline[],
  polygons: CADPolygon[],
  texts: import('../types/cad').CADText[] = []
): { minX: number; minY: number; maxX: number; maxY: number; hasData: boolean } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let count = 0;

  const update = (p: Point2D) => {
    if (isNaN(p.x) || isNaN(p.y)) return;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    count++;
  };

  points.forEach(update);
  lines.forEach(l => { update(l.start); update(l.end); });
  polylines.forEach(pl => pl.points.forEach(update));
  polygons.forEach(pg => pg.points.forEach(update));
  texts.forEach(t => update({ x: t.x, y: t.y }));

  if (count === 0) {
    return { minX: 0, minY: 0, maxX: 100, maxY: 100, hasData: false };
  }

  return { minX, minY, maxX, maxY, hasData: true };
}
