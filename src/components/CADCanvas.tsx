/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Focus } from 'lucide-react';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D, SnapPoint, SnapType, ToolMode } from '../types/cad';
import { distance2D, findSnapPoint } from '../utils/geometry';

interface CADCanvasProps {
  tool: ToolMode;
  ortho: boolean;
  snapEnabled: boolean;
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  activeLayerId: string;
  selectedEntityId: string | null;
  onSelectEntity: (id: string | null) => void;
  onAddPoint: (point: CADPoint) => void;
  onAddLine: (line: CADLine) => void;
  onAddPolyline: (polyline: CADPolyline) => void;
  onAddPolygon: (polygon: CADPolygon) => void;
  onCursorMove: (world: Point2D | null, snap: SnapPoint | null) => void;
  onLiveMeasurementChange?: (data: { currentSegment: number; totalLength: number; area?: number; pointCount: number }) => void;
  activePoints: Point2D[];
  setActivePoints: React.Dispatch<React.SetStateAction<Point2D[]>>;
  zoomExtentsTrigger?: number | { timestamp: number; targetPoints?: Point2D[] } | null;
}

export const CADCanvas: React.FC<CADCanvasProps> = ({
  tool,
  ortho,
  snapEnabled,
  layers,
  points,
  lines,
  polylines,
  polygons,
  texts,
  activeLayerId,
  selectedEntityId,
  onSelectEntity,
  onAddPoint,
  onAddLine,
  onAddPolyline,
  onAddPolygon,
  onCursorMove,
  onLiveMeasurementChange,
  activePoints,
  setActivePoints,
  zoomExtentsTrigger
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Viewport state: CAD world coordinate at canvas center
  const [view, setView] = useState<{ panX: number; panY: number; zoom: number }>({
    panX: 0,
    panY: 0,
    zoom: 2.0 // pixels per meter
  });

  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapPoint | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<{ clientX: number; clientY: number; panX: number; panY: number } | null>(null);
  const touchStartRef = useRef<{ dist: number; midX: number; midY: number; panX: number; panY: number; zoom: number } | null>(null);

  // Quick lookup for layer visibility and color
  const layerMap = useRef<Map<string, CADLayer>>(new Map());
  useEffect(() => {
    const map = new Map<string, CADLayer>();
    layers.forEach(l => map.set(l.id, l));
    layerMap.current = map;
  }, [layers]);

  // Coordinate transforms
  const worldToScreen = useCallback((world: Point2D, width: number, height: number) => {
    const cx = width / 2;
    const cy = height / 2;
    return {
      x: cx + (world.x - view.panX) * view.zoom,
      y: cy - (world.y - view.panY) * view.zoom
    };
  }, [view]);

  const screenToWorld = useCallback((screenX: number, screenY: number, width: number, height: number): Point2D => {
    const cx = width / 2;
    const cy = height / 2;
    return {
      x: view.panX + (screenX - cx) / view.zoom,
      y: view.panY - (screenY - cy) / view.zoom
    };
  }, [view]);

  // Zoom to fit all entities or specific target points (e.g. newly placed CSV survey points)
  const zoomExtents = useCallback((targetPoints?: Point2D[]) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let count = 0;

    const consider = (p: Point2D) => {
      if (typeof p.x !== 'number' || typeof p.y !== 'number' || !isFinite(p.x) || !isFinite(p.y)) return;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
      count++;
    };

    if (targetPoints && targetPoints.length > 0) {
      targetPoints.forEach(consider);
    } else {
      points.forEach(consider);
      lines.forEach(l => { consider(l.start); consider(l.end); });
      polylines.forEach(pl => pl.points.forEach(consider));
      polygons.forEach(pg => pg.points.forEach(consider));
      texts.forEach(t => consider({ x: t.x, y: t.y }));
    }

    if (count === 0) return;

    const padding = 75; // pixels
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || (canvas.width / dpr) || window.innerWidth;
    const height = canvas.clientHeight || (canvas.height / dpr) || window.innerHeight;

    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;

    if (!isFinite(worldWidth) || !isFinite(worldHeight) || worldWidth <= 0 || worldHeight <= 0) {
      // Fallback if dimensions are invalid
      setView({
        panX: isFinite(minX + maxX) ? (minX + maxX) / 2 : 0,
        panY: isFinite(minY + maxY) ? (minY + maxY) / 2 : 0,
        zoom: 2.0
      });
      return;
    }

    const zoomX = (width - padding * 2) / worldWidth;
    const zoomY = (height - padding * 2) / worldHeight;
    const newZoom = Math.max(0.0001, Math.min(2000, Math.min(zoomX, zoomY)));

    setView({
      panX: (minX + maxX) / 2,
      panY: (minY + maxY) / 2,
      zoom: newZoom
    });
  }, [points, lines, polylines, polygons, texts]);

  // Respond to zoom extents trigger
  useEffect(() => {
    if (zoomExtentsTrigger) {
      if (typeof zoomExtentsTrigger === 'object') {
        zoomExtents(zoomExtentsTrigger.targetPoints);
      } else if (typeof zoomExtentsTrigger === 'number' && zoomExtentsTrigger > 0) {
        zoomExtents();
      }
    }
  }, [zoomExtentsTrigger, zoomExtents]);

  // Initial fit on first points loaded
  useEffect(() => {
    if (points.length > 0) {
      zoomExtents();
    }
  }, [points.length, zoomExtents]);

  // Orthogonal constraint
  const applyOrtho = useCallback((current: Point2D, reference: Point2D): Point2D => {
    const dx = Math.abs(current.x - reference.x);
    const dy = Math.abs(current.y - reference.y);
    if (dx > dy) {
      return { x: current.x, y: reference.y };
    } else {
      return { x: reference.x, y: current.y };
    }
  }, []);

  // Update live measurements to parent
  useEffect(() => {
    if (!onLiveMeasurementChange) return;

    let totalLength = 0;
    for (let i = 0; i < activePoints.length - 1; i++) {
      totalLength += distance2D(activePoints[i], activePoints[i + 1]);
    }

    let currentSegment = 0;
    if (activePoints.length > 0 && cursorWorld) {
      const activeLast = activePoints[activePoints.length - 1];
      const targetPoint = activeSnap ? activeSnap.point : cursorWorld;
      currentSegment = distance2D(activeLast, targetPoint);
    }

    let area = 0;
    if (tool === 'polygon' && activePoints.length >= 2 && cursorWorld) {
      const pts = [...activePoints, activeSnap ? activeSnap.point : cursorWorld];
      for (let i = 0; i < pts.length; i++) {
        const j = (i + 1) % pts.length;
        area += pts[i].x * pts[j].y;
        area -= pts[j].x * pts[i].y;
      }
      area = Math.abs(area) / 2.0;
    }

    onLiveMeasurementChange({
      currentSegment,
      totalLength: totalLength + (tool !== 'polygon' ? currentSegment : 0),
      area: tool === 'polygon' ? area : undefined,
      pointCount: activePoints.length
    });
  }, [activePoints, cursorWorld, activeSnap, tool, onLiveMeasurementChange]);

  // High-performance Spatial Hash Index for 60fps snapping even with 50,000+ entities
  const spatialIndex = useMemo(() => {
    const cellSize = 100; // 100m grid cell
    const cellMap = new Map<string, { points: CADPoint[]; lines: CADLine[]; polylines: CADPolyline[]; polygons: CADPolygon[] }>();

    const getCell = (cx: number, cy: number) => {
      const key = `${cx}:${cy}`;
      let c = cellMap.get(key);
      if (!c) {
        c = { points: [], lines: [], polylines: [], polygons: [] };
        cellMap.set(key, c);
      }
      return c;
    };

    // Index points
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const cx = Math.floor(p.x / cellSize);
      const cy = Math.floor(p.y / cellSize);
      getCell(cx, cy).points.push(p);
    }

    // Index lines
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const minCx = Math.floor(Math.min(l.start.x, l.end.x) / cellSize);
      const maxCx = Math.floor(Math.max(l.start.x, l.end.x) / cellSize);
      const minCy = Math.floor(Math.min(l.start.y, l.end.y) / cellSize);
      const maxCy = Math.floor(Math.max(l.start.y, l.end.y) / cellSize);
      if ((maxCx - minCx + 1) * (maxCy - minCy + 1) <= 16) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            getCell(cx, cy).lines.push(l);
          }
        }
      }
    }

    // Index polylines
    for (let i = 0; i < polylines.length; i++) {
      const pl = polylines[i];
      if (pl.points.length === 0) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let j = 0; j < pl.points.length; j++) {
        const pt = pl.points[j];
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      const minCx = Math.floor(minX / cellSize);
      const maxCx = Math.floor(maxX / cellSize);
      const minCy = Math.floor(minY / cellSize);
      const maxCy = Math.floor(maxY / cellSize);
      if ((maxCx - minCx + 1) * (maxCy - minCy + 1) <= 16) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            getCell(cx, cy).polylines.push(pl);
          }
        }
      }
    }

    // Index polygons
    for (let i = 0; i < polygons.length; i++) {
      const pg = polygons[i];
      if (pg.points.length === 0) continue;
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (let j = 0; j < pg.points.length; j++) {
        const pt = pg.points[j];
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }
      const minCx = Math.floor(minX / cellSize);
      const maxCx = Math.floor(maxX / cellSize);
      const minCy = Math.floor(minY / cellSize);
      const maxCy = Math.floor(maxY / cellSize);
      if ((maxCx - minCx + 1) * (maxCy - minCy + 1) <= 16) {
        for (let cx = minCx; cx <= maxCx; cx++) {
          for (let cy = minCy; cy <= maxCy; cy++) {
            getCell(cx, cy).polygons.push(pg);
          }
        }
      }
    }

    return { cellMap, cellSize };
  }, [points, lines, polylines, polygons]);

  // Calculate snap with ultra-fast spatial candidate lookup (< 0.05ms)
  const evaluateSnap = useCallback((rawWorld: Point2D): { effectiveWorld: Point2D; snap: SnapPoint | null } => {
    if (!snapEnabled) {
      return { effectiveWorld: rawWorld, snap: null };
    }

    // Snap radius: 24 pixels converted to world meters
    const snapRadiusMeters = 24 / view.zoom;
    const { cellMap, cellSize } = spatialIndex;

    const minCx = Math.floor((rawWorld.x - snapRadiusMeters) / cellSize);
    const maxCx = Math.floor((rawWorld.x + snapRadiusMeters) / cellSize);
    const minCy = Math.floor((rawWorld.y - snapRadiusMeters) / cellSize);
    const maxCy = Math.floor((rawWorld.y + snapRadiusMeters) / cellSize);

    const candPoints: CADPoint[] = [];
    const candLines: CADLine[] = [];
    const candPolylines: CADPolyline[] = [];
    const candPolygons: CADPolygon[] = [];
    const seenLineIds = new Set<string>();
    const seenPlIds = new Set<string>();
    const seenPgIds = new Set<string>();

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const c = cellMap.get(`${cx}:${cy}`);
        if (!c) continue;

        for (let i = 0; i < c.points.length; i++) {
          const pt = c.points[i];
          const l = layerMap.current.get(pt.layerId);
          if (l?.visible !== false) candPoints.push(pt);
        }
        for (let i = 0; i < c.lines.length; i++) {
          const ln = c.lines[i];
          if (!seenLineIds.has(ln.id)) {
            seenLineIds.add(ln.id);
            const l = layerMap.current.get(ln.layerId);
            if (l?.visible !== false) candLines.push(ln);
          }
        }
        for (let i = 0; i < c.polylines.length; i++) {
          const pl = c.polylines[i];
          if (!seenPlIds.has(pl.id)) {
            seenPlIds.add(pl.id);
            const l = layerMap.current.get(pl.layerId);
            if (l?.visible !== false) candPolylines.push(pl);
          }
        }
        for (let i = 0; i < c.polygons.length; i++) {
          const pg = c.polygons[i];
          if (!seenPgIds.has(pg.id)) {
            seenPgIds.add(pg.id);
            const l = layerMap.current.get(pg.layerId);
            if (l?.visible !== false) candPolygons.push(pg);
          }
        }
      }
    }

    const snap = findSnapPoint({
      worldCursor: rawWorld,
      worldRadius: snapRadiusMeters,
      points: candPoints,
      lines: candLines,
      polylines: candPolylines,
      polygons: candPolygons,
      activePoints
    });

    if (snap) {
      // Haptic feedback if newly snapped
      if (!activeSnap || activeSnap.point.x !== snap.point.x || activeSnap.point.y !== snap.point.y) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate(12); } catch { /* ignore */ }
        }
      }
      return { effectiveWorld: snap.point, snap };
    }

    return { effectiveWorld: rawWorld, snap: null };
  }, [snapEnabled, view.zoom, spatialIndex, activePoints, activeSnap]);

  // Pointer move handler
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isPanning && panStartRef.current) {
      const panStart = panStartRef.current;
      if (!panStart) return;
      const dx = e.clientX - panStart.clientX;
      const dy = e.clientY - panStart.clientY;
      const originX = panStart.panX;
      const originY = panStart.panY;

      setView(v => ({
        ...v,
        panX: originX - dx / v.zoom,
        panY: originY + dy / v.zoom
      }));
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const rawWorld = screenToWorld(screenX, screenY, rect.width, rect.height);

    let effectiveWorld = rawWorld;
    let snap: SnapPoint | null = null;

    if (activePoints.length > 0 && ortho) {
      const lastPoint = activePoints[activePoints.length - 1];
      effectiveWorld = applyOrtho(rawWorld, lastPoint);
    }

    const snapRes = evaluateSnap(effectiveWorld);
    effectiveWorld = snapRes.effectiveWorld;
    snap = snapRes.snap;

    setCursorWorld(effectiveWorld);
    setActiveSnap(snap);
    onCursorMove(effectiveWorld, snap);
  };

  // Pointer down handler
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || tool === 'pan' || (e.pointerType === 'touch' && e.isPrimary === false)) {
      // Middle click or Pan tool
      setIsPanning(true);
      panStartRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        panX: view.panX,
        panY: view.panY
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      return;
    }

    if (e.button !== 0) return; // Only left button for actions

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    let targetWorld = screenToWorld(screenX, screenY, rect.width, rect.height);

    if (activePoints.length > 0 && ortho) {
      targetWorld = applyOrtho(targetWorld, activePoints[activePoints.length - 1]);
    }

    const { effectiveWorld } = evaluateSnap(targetWorld);
    targetWorld = effectiveWorld;

    // Tool actions
    if (tool === 'select') {
      // Select nearest entity
      let foundId: string | null = null;
      const hitRadius = 15 / view.zoom;

      for (const pt of points) {
        if (distance2D(targetWorld, pt) < hitRadius) {
          foundId = pt.id;
          break;
        }
      }
      onSelectEntity(foundId);
    } else if (tool === 'point') {
      onAddPoint({
        id: `pt-${Date.now()}`,
        name: `측점_${points.length + 1}`,
        x: targetWorld.x,
        y: targetWorld.y,
        layerId: activeLayerId,
        isSurveyNode: false
      });
    } else if (tool === 'line') {
      if (activePoints.length === 0) {
        setActivePoints([targetWorld]);
      } else {
        const start = activePoints[0];
        onAddLine({
          id: `line-${Date.now()}`,
          start,
          end: targetWorld,
          layerId: activeLayerId
        });
        setActivePoints([]);
      }
    } else if (tool === 'polyline') {
      setActivePoints(prev => [...prev, targetWorld]);
    } else if (tool === 'polygon') {
      setActivePoints(prev => [...prev, targetWorld]);
    } else if (tool === 'measure') {
      setActivePoints(prev => [...prev, targetWorld]);
    }
  };

  const handlePointerUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    setIsPanning(false);
    panStartRef.current = null;
    if (e && e.currentTarget && 'hasPointerCapture' in e.currentTarget) {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }
  };

  // Mouse wheel zoom
  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldBefore = screenToWorld(mouseX, mouseY, rect.width, rect.height);
    const zoomFactor = e.deltaY < 0 ? 1.2 : 0.833;
    const newZoom = Math.max(0.0001, Math.min(2000, view.zoom * zoomFactor));

    // Keep world coordinate under mouse cursor stable
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const newPanX = worldBefore.x - (mouseX - cx) / newZoom;
    const newPanY = worldBefore.y + (mouseY - cy) / newZoom;

    setView({
      panX: newPanX,
      panY: newPanY,
      zoom: newZoom
    });
  };

  // Double click / Tap to finish Polyline or Polygon
  const handleDoubleClick = () => {
    if (tool === 'polyline' && activePoints.length >= 2) {
      onAddPolyline({
        id: `pl-${Date.now()}`,
        points: activePoints,
        isClosed: false,
        layerId: activeLayerId
      });
      setActivePoints([]);
    } else if (tool === 'polygon' && activePoints.length >= 3) {
      onAddPolygon({
        id: `poly-${Date.now()}`,
        points: activePoints,
        layerId: activeLayerId
      });
      setActivePoints([]);
    } else if (tool === 'measure') {
      setActivePoints([]);
    }
  };

  // Mobile Pinch-to-zoom & two-finger pan touch listeners
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        touchStartRef.current = {
          dist,
          midX,
          midY,
          panX: view.panX,
          panY: view.panY,
          zoom: view.zoom
        };
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      const touchStart = touchStartRef.current;
      if (e.touches.length === 2 && touchStart) {
        e.preventDefault();
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const newDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const newMidX = (t1.clientX + t2.clientX) / 2;
        const newMidY = (t1.clientY + t2.clientY) / 2;

        const scale = newDist / (touchStart.dist || 1);
        const targetZoom = Math.max(0.0001, Math.min(2000, touchStart.zoom * scale));

        const dx = newMidX - touchStart.midX;
        const dy = newMidY - touchStart.midY;
        const originPanX = touchStart.panX;
        const originPanY = touchStart.panY;

        setView({
          panX: originPanX - dx / targetZoom,
          panY: originPanY + dy / targetZoom,
          zoom: targetZoom
        });
      }
    };

    const onTouchEnd = () => {
      touchStartRef.current = null;
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
    };
  }, [view]);

  // Dynamic Screen Resize Observer (Mobile, Tablet orientation, Window resizing)
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      setViewportSize({ width: canvas.clientWidth, height: canvas.clientHeight });
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    const canvas = canvasRef.current;
    let observer: ResizeObserver | null = null;
    if (canvas && typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(() => handleResize());
      observer.observe(canvas);
    }

    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (observer) observer.disconnect();
    };
  }, []);

  // Main Canvas Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Retina display scaling
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // 1. Dark CAD Background
    ctx.fillStyle = '#090d16'; // Deep CAD slate black
    ctx.fillRect(0, 0, width, height);

    // 2. Adaptive Engineering Metric Grid
    drawCADGrid(ctx, width, height, view);

    const getScreen = (p: Point2D) => worldToScreen(p, width, height);

    // Visible World Bounding Box for High-Speed Viewport Culling
    const marginMeters = 30 / view.zoom;
    const visMinX = view.panX - (width / 2) / view.zoom - marginMeters;
    const visMaxX = view.panX + (width / 2) / view.zoom + marginMeters;
    const visMinY = view.panY - (height / 2) / view.zoom - marginMeters;
    const visMaxY = view.panY + (height / 2) / view.zoom + marginMeters;

    // 3. Render Polygons (fills first with viewport culling)
    polygons.forEach(pg => {
      const layer = layerMap.current.get(pg.layerId);
      if (layer && !layer.visible) return;
      if (pg.points.length < 3) return;

      // Fast AABB check
      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
      for (let i = 0; i < pg.points.length; i++) {
        const pt = pg.points[i];
        pMinX = Math.min(pMinX, pt.x);
        pMinY = Math.min(pMinY, pt.y);
        pMaxX = Math.max(pMaxX, pt.x);
        pMaxY = Math.max(pMaxY, pt.y);
      }
      if (pMaxX < visMinX || pMinX > visMaxX || pMaxY < visMinY || pMinY > visMaxY) {
        return; // Cull
      }

      const color = pg.color || layer?.color || '#38bdf8';
      ctx.beginPath();
      const first = getScreen(pg.points[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pg.points.length; i++) {
        const pt = getScreen(pg.points[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();

      ctx.fillStyle = color + '22'; // 13% opacity fill
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = selectedEntityId === pg.id ? 3.5 : 2;
      ctx.stroke();

      // Area label at centroid
      if (view.zoom > 0.04) {
        let cx = 0, cy = 0;
        pg.points.forEach(p => { cx += p.x; cy += p.y; });
        cx /= pg.points.length;
        cy /= pg.points.length;
        const screenC = getScreen({ x: cx, y: cy });

        let area = 0;
        for (let i = 0; i < pg.points.length; i++) {
          const j = (i + 1) % pg.points.length;
          area += pg.points[i].x * pg.points[j].y - pg.points[j].x * pg.points[i].y;
        }
        area = Math.abs(area) / 2.0;

        ctx.fillStyle = '#ffffff';
        ctx.font = '11px Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${area.toFixed(1)}㎡ (${(area / 3.305785).toFixed(1)}평)`, screenC.x, screenC.y);
      }
    });

    // 4. Render Polylines (with viewport culling)
    polylines.forEach(pl => {
      const layer = layerMap.current.get(pl.layerId);
      if (layer && !layer.visible) return;
      if (pl.points.length < 2) return;

      // Fast AABB Cull
      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
      for (let i = 0; i < pl.points.length; i++) {
        const pt = pl.points[i];
        pMinX = Math.min(pMinX, pt.x);
        pMinY = Math.min(pMinY, pt.y);
        pMaxX = Math.max(pMaxX, pt.x);
        pMaxY = Math.max(pMaxY, pt.y);
      }
      if (pMaxX < visMinX || pMinX > visMaxX || pMaxY < visMinY || pMinY > visMaxY) {
        return; // Cull
      }

      const color = pl.color || layer?.color || '#38bdf8';
      ctx.beginPath();
      const first = getScreen(pl.points[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pl.points.length; i++) {
        const pt = getScreen(pl.points[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      if (pl.isClosed) ctx.closePath();

      ctx.strokeStyle = color;
      ctx.lineWidth = selectedEntityId === pl.id ? 3.5 : (layer?.lineWidth || 2);
      ctx.stroke();


    });

    // 5. Render Lines (HIGH-SPEED LAYER BATCHING)
    // Group all visible lines by layerId to execute 1 batch stroke per layer
    const linesByLayer = new Map<string, CADLine[]>();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const minX = Math.min(l.start.x, l.end.x);
      const maxX = Math.max(l.start.x, l.end.x);
      const minY = Math.min(l.start.y, l.end.y);
      const maxY = Math.max(l.start.y, l.end.y);

      // Viewport culling
      if (maxX < visMinX || minX > visMaxX || maxY < visMinY || minY > visMaxY) {
        continue;
      }

      let arr = linesByLayer.get(l.layerId);
      if (!arr) {
        arr = [];
        linesByLayer.set(l.layerId, arr);
      }
      arr.push(l);
    }

    // Render batch lines per layer
    linesByLayer.forEach((layerLines, layerId) => {
      const layer = layerMap.current.get(layerId);
      if (layer && !layer.visible) return;

      ctx.beginPath();
      for (let i = 0; i < layerLines.length; i++) {
        const l = layerLines[i];
        const sp1 = getScreen(l.start);
        const sp2 = getScreen(l.end);
        ctx.moveTo(sp1.x, sp1.y);
        ctx.lineTo(sp2.x, sp2.y);
      }
      ctx.strokeStyle = layer?.color || '#38bdf8';
      ctx.lineWidth = layer?.lineWidth || 1.5;
      ctx.stroke();


    });

    // 6. Render Survey Points & Nodes (Batched with Viewport Culling)
    const visiblePoints: CADPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (pt.x < visMinX || pt.x > visMaxX || pt.y < visMinY || pt.y > visMaxY) {
        continue;
      }
      const layer = layerMap.current.get(pt.layerId);
      if (layer && !layer.visible) continue;
      visiblePoints.push(pt);
    }

    // Draw visible points
    const showPointLabels = visiblePoints.length <= 150 && view.zoom > 0.08;
    ctx.lineWidth = 1.5;

    for (let i = 0; i < visiblePoints.length; i++) {
      const pt = visiblePoints[i];
      const sp = getScreen(pt);
      const isSelected = selectedEntityId === pt.id;
      const layer = layerMap.current.get(pt.layerId);

      ctx.strokeStyle = isSelected ? '#f59e0b' : (layer?.color || '#ef4444');
      ctx.fillStyle = isSelected ? '#fbbf24' : '#ef4444';

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sp.x - 5, sp.y);
      ctx.lineTo(sp.x + 5, sp.y);
      ctx.moveTo(sp.x, sp.y - 5);
      ctx.lineTo(sp.x, sp.y + 5);
      ctx.stroke();

      if (showPointLabels || isSelected) {
        ctx.font = '10px Pretendard, sans-serif';
        ctx.fillStyle = '#cbd5e1';
        ctx.textAlign = 'left';
        const labelText = pt.name + (pt.z !== undefined ? ` (${pt.z.toFixed(2)})` : '');
        ctx.fillText(labelText, sp.x + 7, sp.y - 3);
      }
    }

    // 7. Render Text Entities (with Viewport Culling)
    for (let i = 0; i < texts.length; i++) {
      const txt = texts[i];
      if (txt.x < visMinX || txt.x > visMaxX || txt.y < visMinY || txt.y > visMaxY) {
        continue;
      }
      const layer = layerMap.current.get(txt.layerId);
      if (layer && !layer.visible) continue;

      const pxHeight = txt.height * view.zoom;
      if (pxHeight < 5.0) continue; // LOD: Skip sub-pixel microscopic text when zoomed out
      const renderPxHeight = Math.max(8, pxHeight);
      const sp = getScreen({ x: txt.x, y: txt.y });

      ctx.save();
      ctx.translate(sp.x, sp.y);
      if (txt.rotation) {
        ctx.rotate((-txt.rotation * Math.PI) / 180);
      }
      ctx.font = `${renderPxHeight}px Pretendard, sans-serif`;
      ctx.fillStyle = txt.color || layer?.color || '#ffffff';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(txt.text, 0, 0);
      ctx.restore();
    }

    // 8. Render Active Drawing Rubber-Band / Preview
    if (activePoints.length > 0) {
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([5, 5]);

      ctx.beginPath();
      const first = getScreen(activePoints[0]);
      ctx.moveTo(first.x, first.y);

      for (let i = 1; i < activePoints.length; i++) {
        const pt = getScreen(activePoints[i]);
        ctx.lineTo(pt.x, pt.y);
      }

      // Rubber-band line to cursor
      if (cursorWorld) {
        const curSp = getScreen(cursorWorld);
        ctx.lineTo(curSp.x, curSp.y);

        if (tool === 'polygon' && activePoints.length >= 2) {
          ctx.lineTo(first.x, first.y); // close preview
        }
      }
      ctx.stroke();
      ctx.setLineDash([]); // Reset dash

      // Draw vertex markers for active points
      activePoints.forEach((p, idx) => {
        const sp = getScreen(p);
        ctx.fillStyle = idx === 0 ? '#10b981' : '#38bdf8';
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Live cursor distance callout
      if (cursorWorld) {
        const last = activePoints[activePoints.length - 1];
        const segDist = distance2D(last, cursorWorld);
        const curSp = getScreen(cursorWorld);

        ctx.font = '12px JetBrains Mono, monospace';
        const label = `${segDist.toFixed(2)}m`;
        const tw = ctx.measureText(label).width;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(curSp.x + 12, curSp.y - 25, tw + 14, 20, 4);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'left';
        ctx.fillText(label, curSp.x + 19, curSp.y - 11);
      }
    }

    // 9. Render Magnetic Snap Indicator
    if (activeSnap) {
      const snapSp = getScreen(activeSnap.point);
      drawSnapMarker(ctx, snapSp, activeSnap.type, activeSnap.label);
    }

    // 10. Scale Bar in bottom-left
    drawScaleBar(ctx, width, height, view.zoom);

    ctx.restore();
  }, [
    view,
    points,
    lines,
    polylines,
    polygons,
    texts,
    activePoints,
    cursorWorld,
    activeSnap,
    tool,
    selectedEntityId,
    worldToScreen,
    viewportSize
  ]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none touch-none">
      <canvas
        ref={canvasRef}
        className="w-full h-full block cursor-crosshair"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />

      {/* Floating AutoCAD Z-E (Zoom Extents) Quick Button */}
      <div className="absolute right-3.5 bottom-7 z-10 pointer-events-none flex flex-col items-end gap-1.5">
        <button
          onClick={() => zoomExtents()}
          title="전체 도면 및 측점 화면 맞춤"
          className="pointer-events-auto flex items-center justify-center p-2.5 bg-slate-900/90 hover:bg-sky-600 text-sky-400 hover:text-white border border-slate-700 hover:border-sky-500 rounded-2xl shadow-xl backdrop-blur-md transition group active:scale-95"
        >
          <Focus className="w-5 h-5 transition" />
        </button>
      </div>
    </div>
  );
};

// Helper: Draw Adaptive CAD Grid
function drawCADGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: { panX: number; panY: number; zoom: number }
) {
  // Determine suitable grid spacing in world meters
  const minPixelsBetweenLines = 60;
  const rawSpacing = minPixelsBetweenLines / view.zoom;

  // Find nearest power of 10 or 1, 2, 5 multiple
  const power = Math.pow(10, Math.floor(Math.log10(rawSpacing)));
  let spacing = power;
  if (rawSpacing / power > 5) spacing = power * 10;
  else if (rawSpacing / power > 2) spacing = power * 5;
  else if (rawSpacing / power > 1) spacing = power * 2;

  const left = view.panX - (width / 2) / view.zoom;
  const right = view.panX + (width / 2) / view.zoom;
  const bottom = view.panY - (height / 2) / view.zoom;
  const top = view.panY + (height / 2) / view.zoom;

  const startX = Math.floor(left / spacing) * spacing;
  const startY = Math.floor(bottom / spacing) * spacing;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  // Vertical grid lines
  for (let x = startX; x <= right; x += spacing) {
    const sx = width / 2 + (x - view.panX) * view.zoom;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
  }

  // Horizontal grid lines
  for (let y = startY; y <= top; y += spacing) {
    const sy = height / 2 - (y - view.panY) * view.zoom;
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
  }
  ctx.stroke();

  // Axis Coordinate Labels along edges
  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.textAlign = 'left';

  for (let x = startX; x <= right; x += spacing * 2) {
    const sx = width / 2 + (x - view.panX) * view.zoom;
    if (sx > 40 && sx < width - 40) {
      ctx.fillText(`${x.toFixed(0)}m`, sx + 4, height - 8);
    }
  }

  for (let y = startY; y <= top; y += spacing * 2) {
    const sy = height / 2 - (y - view.panY) * view.zoom;
    if (sy > 40 && sy < height - 40) {
      ctx.fillText(`${y.toFixed(0)}m`, 8, sy - 4);
    }
  }
}

// Helper: Draw Magnetic Snap Marker
function drawSnapMarker(
  ctx: CanvasRenderingContext2D,
  screenPt: { x: number; y: number },
  type: SnapType,
  label: string
) {
  const { x, y } = screenPt;
  ctx.lineWidth = 2;

  if (type === 'node') {
    // Green circle + cross
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === 'endpoint') {
    // Green square
    ctx.strokeStyle = '#22c55e';
    ctx.strokeRect(x - 6, y - 6, 12, 12);
  } else if (type === 'midpoint') {
    // Cyan triangle
    ctx.strokeStyle = '#06b6d4';
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 7, y + 6);
    ctx.lineTo(x - 7, y + 6);
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'intersection') {
    // Yellow X
    ctx.strokeStyle = '#eab308';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x + 6, y + 6);
    ctx.moveTo(x + 6, y - 6);
    ctx.lineTo(x - 6, y + 6);
    ctx.stroke();
  } else {
    // Nearest: Hourglass
    ctx.strokeStyle = '#a855f7';
    ctx.beginPath();
    ctx.moveTo(x - 5, y - 5);
    ctx.lineTo(x + 5, y + 5);
    ctx.lineTo(x - 5, y + 5);
    ctx.lineTo(x + 5, y - 5);
    ctx.closePath();
    ctx.stroke();
  }

  // Snap Label Badge
  ctx.font = '11px Pretendard, sans-serif';
  const textW = ctx.measureText(label).width;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
  ctx.strokeStyle = '#22c55e';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 10, y + 10, textW + 12, 18, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#4ade80';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 16, y + 23);
}

// Helper: Draw Real-world Scale Bar
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: number
) {
  // Target width on screen ~ 100px
  const targetPixels = 100;
  const metersRaw = targetPixels / zoom;

  // Round meters to clean 1, 2, 5, 10, 20, 50, 100, 200, 500, etc.
  const power = Math.pow(10, Math.floor(Math.log10(metersRaw)));
  let barMeters = power;
  if (metersRaw / power > 5) barMeters = power * 5;
  else if (metersRaw / power > 2) barMeters = power * 2;
  else if (metersRaw / power > 1) barMeters = power;

  const barPixels = barMeters * zoom;
  const startX = 20;
  const startY = height - 20;

  // Draw bar
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(startX + barPixels, startY);
  ctx.moveTo(startX, startY - 4);
  ctx.lineTo(startX, startY + 4);
  ctx.moveTo(startX + barPixels, startY - 4);
  ctx.lineTo(startX + barPixels, startY + 4);
  ctx.stroke();

  // Label
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  const label = barMeters >= 1000 ? `${(barMeters / 1000).toFixed(1)} km` : `${barMeters.toFixed(0)} m`;
  ctx.fillText(label, startX + barPixels / 2, startY - 6);
}
