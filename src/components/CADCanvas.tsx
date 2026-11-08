/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Focus, MapPin } from 'lucide-react';
import { 
  CADLayer, 
  CADLine, 
  CADPoint, 
  CADPolygon, 
  CADPolyline, 
  CADText, 
  Point2D, 
  SnapPoint, 
  SnapType, 
  ToolMode 
} from '../types/cad';
import { 
  distance2D, 
  findSnapPoint, 
  closestPointOnSegment, 
  isPointInBox, 
  isLineInOrIntersectBox, 
  isPolylineInOrIntersectBox, 
  BoundingBox2D 
} from '../utils/geometry';

interface CADCanvasProps {
  theme?: 'light' | 'dark';
  tool: ToolMode;
  snapEnabled: boolean;
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  activeLayerId: string;
  selectedEntityId?: string | null;
  selectedEntityIds?: string[];
  multiSelectMode?: boolean;
  onSelectEntity?: (id: string | null) => void;
  onSelectEntities?: (ids: string[]) => void;
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
  theme = 'dark',
  tool,
  snapEnabled,
  layers,
  points,
  lines,
  polylines,
  polygons,
  texts,
  activeLayerId,
  selectedEntityId,
  selectedEntityIds = [],
  multiSelectMode = false,
  onSelectEntity,
  onSelectEntities,
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

  // Marquee selection box in screen coordinates
  const [selectionBox, setSelectionBox] = useState<{
    startScreen: { x: number; y: number };
    currentScreen: { x: number; y: number };
  } | null>(null);

  // Pointer down position & timestamp to detect drag vs click
  const pointerDownPosRef = useRef<{
    clientX: number;
    clientY: number;
    screenX: number;
    screenY: number;
    time: number;
    button: number;
  } | null>(null);

  // Spacebar pan toggle
  const [isSpacePressed, setIsSpacePressed] = useState(false);

  // Toast / feedback message when polyline click is not on a node
  const [nodeHintToast, setNodeHintToast] = useState<string | null>(null);
  const hintTimeoutRef = useRef<any>(null);

  const showNodeHint = (msg: string) => {
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    setNodeHintToast(msg);
    hintTimeoutRef.current = setTimeout(() => {
      setNodeHintToast(null);
    }, 2400);
  };

  // Listen for Spacebar key to enable pan freely while drawing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // Quick lookup for layer visibility and color
  const layerMap = useRef<Map<string, CADLayer>>(new Map());
  useEffect(() => {
    const map = new Map<string, CADLayer>();
    layers.forEach(l => map.set(l.id, l));
    layerMap.current = map;
  }, [layers]);

  // Unified selected entity Set for ultra-fast O(1) checks
  const selectedSet = useMemo(() => {
    const set = new Set<string>();
    if (selectedEntityIds && selectedEntityIds.length > 0) {
      selectedEntityIds.forEach(id => set.add(id));
    } else if (selectedEntityId) {
      set.add(selectedEntityId);
    }
    return set;
  }, [selectedEntityIds, selectedEntityId]);

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

  // Stable ref to entities so zoomExtents never causes view jumps on layer change
  const entitiesRef = useRef({ points, lines, polylines, polygons, texts });
  useEffect(() => {
    entitiesRef.current = { points, lines, polylines, polygons, texts };
  }, [points, lines, polylines, polygons, texts]);

  // Zoom to fit all entities or specific target points (Invoked on Z-E button, Z-E shortcut, or file import)
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
      const { points: curPoints, lines: curLines, polylines: curPls, polygons: curPgs, texts: curTexts } = entitiesRef.current;
      curPoints.forEach(consider);
      curLines.forEach(l => { consider(l.start); consider(l.end); });
      curPls.forEach(pl => pl.points.forEach(consider));
      curPgs.forEach(pg => pg.points.forEach(consider));
      curTexts.forEach(t => consider({ x: t.x, y: t.y }));
    }

    if (count === 0) return;

    const padding = 75; // pixels
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || (canvas.width / dpr) || window.innerWidth;
    const height = canvas.clientHeight || (canvas.height / dpr) || window.innerHeight;

    const worldWidth = maxX - minX;
    const worldHeight = maxY - minY;

    if (!isFinite(worldWidth) || !isFinite(worldHeight) || worldWidth <= 0 || worldHeight <= 0) {
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
  }, []);

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

  // High-performance Spatial Hash Index including texts
  const spatialIndex = useMemo(() => {
    const cellSize = 100; // 100m grid cell
    const cellMap = new Map<string, { 
      points: CADPoint[]; 
      lines: CADLine[]; 
      polylines: CADPolyline[]; 
      polygons: CADPolygon[]; 
      texts: CADText[] 
    }>();

    const getCell = (cx: number, cy: number) => {
      const key = `${cx}:${cy}`;
      let c = cellMap.get(key);
      if (!c) {
        c = { points: [], lines: [], polylines: [], polygons: [], texts: [] };
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

    // Index texts (as nodes)
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      const cx = Math.floor(t.x / cellSize);
      const cy = Math.floor(t.y / cellSize);
      getCell(cx, cy).texts.push(t);
    }

    return { cellMap, cellSize };
  }, [points, lines, polylines, polygons, texts]);

  // Evaluate Snap with Node & Text support
  const evaluateSnap = useCallback((rawWorld: Point2D): { effectiveWorld: Point2D; snap: SnapPoint | null } => {
    if (!snapEnabled) {
      return { effectiveWorld: rawWorld, snap: null };
    }

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
    const candTexts: CADText[] = [];
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
        for (let i = 0; i < c.texts.length; i++) {
          const t = c.texts[i];
          const l = layerMap.current.get(t.layerId);
          if (l?.visible !== false) candTexts.push(t);
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
      texts: candTexts,
      activePoints
    });

    if (snap) {
      if (!activeSnap || activeSnap.point.x !== snap.point.x || activeSnap.point.y !== snap.point.y) {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          try { navigator.vibrate(12); } catch { /* ignore */ }
        }
      }
      return { effectiveWorld: snap.point, snap };
    }

    return { effectiveWorld: rawWorld, snap: null };
  }, [snapEnabled, view.zoom, spatialIndex, activePoints, activeSnap]);

  // Pointer Move Handler
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (isPanning && panStartRef.current) {
      const panStart = panStartRef.current;
      const dx = e.clientX - panStart.clientX;
      const dy = e.clientY - panStart.clientY;
      setView(v => ({
        ...v,
        panX: panStart.panX - dx / v.zoom,
        panY: panStart.panY + dy / v.zoom
      }));
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    // Update selection box if drag-selecting
    const isDragSelecting = (tool === 'select' || (tool === 'pan' && e.shiftKey) || selectionBox !== null);
    if (isDragSelecting && pointerDownPosRef.current && pointerDownPosRef.current.button === 0) {
      const dist = Math.hypot(e.clientX - pointerDownPosRef.current.clientX, e.clientY - pointerDownPosRef.current.clientY);
      if (dist > 4) {
        setSelectionBox({
          startScreen: { x: pointerDownPosRef.current.screenX, y: pointerDownPosRef.current.screenY },
          currentScreen: { x: screenX, y: screenY }
        });
      }
      return;
    }

    // Auto-Pan Detection: If primary button is down and moved significantly, switch to pan
    if (pointerDownPosRef.current && pointerDownPosRef.current.button === 0 && !isPanning && !selectionBox) {
      const dist = Math.hypot(e.clientX - pointerDownPosRef.current.clientX, e.clientY - pointerDownPosRef.current.clientY);
      if (dist > 10) {
        setIsPanning(true);
        panStartRef.current = {
          clientX: pointerDownPosRef.current.clientX,
          clientY: pointerDownPosRef.current.clientY,
          panX: view.panX,
          panY: view.panY
        };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
        return;
      }
    }

    const rawWorld = screenToWorld(screenX, screenY, rect.width, rect.height);
    const snapRes = evaluateSnap(rawWorld);
    const effectiveWorld = snapRes.effectiveWorld;
    const snap = snapRes.snap;

    setCursorWorld(effectiveWorld);
    setActiveSnap(snap);
    onCursorMove(effectiveWorld, snap);
  };

  // Pointer Down Handler
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Pan with Middle Mouse Button, Pan Tool (without Shift), Spacebar, or secondary touch
    const isShiftBoxSelect = (tool === 'select') || (tool === 'pan' && e.shiftKey);
    const shouldPan = (e.button === 1 || (tool === 'pan' && !e.shiftKey) || isSpacePressed || (e.pointerType === 'touch' && e.isPrimary === false));

    if (shouldPan) {
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

    if (e.button !== 0) return; // Only primary button for drawing and selecting

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    pointerDownPosRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      screenX,
      screenY,
      time: Date.now(),
      button: e.button
    };

    if (isShiftBoxSelect) {
      setSelectionBox({
        startScreen: { x: screenX, y: screenY },
        currentScreen: { x: screenX, y: screenY }
      });
    }
  };

  // Pointer Up Handler - Commits points or selections safely without breaking on pan/zoom
  const handlePointerUp = (e?: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
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
      return;
    }

    if (!pointerDownPosRef.current || !e) {
      setSelectionBox(null);
      return;
    }

    const down = pointerDownPosRef.current;
    pointerDownPosRef.current = null;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const movedDist = Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY);

    // 1. SELECT TOOL or Marquee Box Selection
    if (tool === 'select' || (selectionBox && movedDist > 6)) {
      if (selectionBox && movedDist > 6) {
        // Marquee Area Box Selection
        const minSx = Math.min(selectionBox.startScreen.x, selectionBox.currentScreen.x);
        const maxSx = Math.max(selectionBox.startScreen.x, selectionBox.currentScreen.x);
        const minSy = Math.min(selectionBox.startScreen.y, selectionBox.currentScreen.y);
        const maxSy = Math.max(selectionBox.startScreen.y, selectionBox.currentScreen.y);

        const p1 = screenToWorld(minSx, minSy, rect.width, rect.height);
        const p2 = screenToWorld(maxSx, maxSy, rect.width, rect.height);
        const box: BoundingBox2D = {
          minX: Math.min(p1.x, p2.x),
          maxX: Math.max(p1.x, p2.x),
          minY: Math.min(p1.y, p2.y),
          maxY: Math.max(p1.y, p2.y)
        };

        const foundIds: string[] = [];
        points.forEach(p => {
          const l = layerMap.current.get(p.layerId);
          if (l?.visible !== false && isPointInBox(p, box)) foundIds.push(p.id);
        });
        lines.forEach(l => {
          const lay = layerMap.current.get(l.layerId);
          if (lay?.visible !== false && isLineInOrIntersectBox(l.start, l.end, box)) foundIds.push(l.id);
        });
        polylines.forEach(pl => {
          const lay = layerMap.current.get(pl.layerId);
          if (lay?.visible !== false && isPolylineInOrIntersectBox(pl.points, box)) foundIds.push(pl.id);
        });
        polygons.forEach(pg => {
          const lay = layerMap.current.get(pg.layerId);
          if (lay?.visible !== false && isPolylineInOrIntersectBox(pg.points, box)) foundIds.push(pg.id);
        });
        texts.forEach(t => {
          const lay = layerMap.current.get(t.layerId);
          if (lay?.visible !== false && isPointInBox({ x: t.x, y: t.y }, box)) foundIds.push(t.id);
        });

        if (e.shiftKey || multiSelectMode) {
          const combined = Array.from(new Set([...selectedEntityIds, ...foundIds]));
          onSelectEntities?.(combined);
        } else {
          onSelectEntities?.(foundIds);
        }
      } else {
        // Single Click / Tap Selection
        let targetWorld = screenToWorld(screenX, screenY, rect.width, rect.height);
        const hitRadius = 18 / view.zoom;
        let hitId: string | null = null;

        for (const pt of points) {
          const l = layerMap.current.get(pt.layerId);
          if (l?.visible === false) continue;
          if (distance2D(targetWorld, pt) < hitRadius) {
            hitId = pt.id;
            break;
          }
        }
        if (!hitId) {
          for (const txt of texts) {
            const l = layerMap.current.get(txt.layerId);
            if (l?.visible === false) continue;
            if (distance2D(targetWorld, { x: txt.x, y: txt.y }) < hitRadius) {
              hitId = txt.id;
              break;
            }
          }
        }
        if (!hitId) {
          for (const pl of polylines) {
            const l = layerMap.current.get(pl.layerId);
            if (l?.visible === false) continue;
            for (let i = 0; i < pl.points.length - 1; i++) {
              const { distance } = closestPointOnSegment(targetWorld, pl.points[i], pl.points[i + 1]);
              if (distance < hitRadius) {
                hitId = pl.id;
                break;
              }
            }
            if (hitId) break;
          }
        }
        if (!hitId) {
          for (const ln of lines) {
            const l = layerMap.current.get(ln.layerId);
            if (l?.visible === false) continue;
            const { distance } = closestPointOnSegment(targetWorld, ln.start, ln.end);
            if (distance < hitRadius) {
              hitId = ln.id;
              break;
            }
          }
        }
        if (!hitId) {
          for (const pg of polygons) {
            const l = layerMap.current.get(pg.layerId);
            if (l?.visible === false) continue;
            for (let i = 0; i < pg.points.length; i++) {
              const j = (i + 1) % pg.points.length;
              const { distance } = closestPointOnSegment(targetWorld, pg.points[i], pg.points[j]);
              if (distance < hitRadius) {
                hitId = pg.id;
                break;
              }
            }
            if (hitId) break;
          }
        }

        if (e.shiftKey || multiSelectMode) {
          if (hitId) {
            const nextList = selectedEntityIds.includes(hitId)
              ? selectedEntityIds.filter(id => id !== hitId)
              : [...selectedEntityIds, hitId];
            onSelectEntities?.(nextList);
          }
        } else {
          onSelectEntities?.(hitId ? [hitId] : []);
        }
      }
      setSelectionBox(null);
      return;
    }

    // If moved > 6px, it was a pan or drag gesture, cancel drawing click!
    if (movedDist > 6) {
      return;
    }

    let targetWorld = screenToWorld(screenX, screenY, rect.width, rect.height);
    const snapRes = evaluateSnap(targetWorld);

    // 2. POLYLINE TOOL: STRICT NODE REQUIREMENT
    // User request: "연속 그리기는 측점(노드)가 있는 곳에서만 적용되게 해줘... 우리 도면은 텍스트가 노드점이 돼..."
    if (tool === 'polyline') {
      if (!snapRes.snap || (snapRes.snap.type !== 'node' && snapRes.snap.type !== 'endpoint')) {
        showNodeHint('연속선은 측점(노드) 또는 텍스트 점을 클릭해서 연결해야 합니다.');
        return;
      }

      const ptToAdd = snapRes.snap.point;
      // Prevent consecutive identical points
      if (activePoints.length > 0) {
        const last = activePoints[activePoints.length - 1];
        if (distance2D(last, ptToAdd) < 0.0001) return;
      }
      setActivePoints(prev => [...prev, ptToAdd]);
      return;
    }

    // 3. MEASURE TOOL: MULTI-POINT ACCUMULATION
    if (tool === 'measure') {
      const ptToAdd = snapRes.snap ? snapRes.snap.point : snapRes.effectiveWorld;
      if (activePoints.length > 0) {
        const last = activePoints[activePoints.length - 1];
        if (distance2D(last, ptToAdd) < 0.0001) return;
      }
      setActivePoints(prev => [...prev, ptToAdd]);
      return;
    }

    // 4. POINT TOOL
    if (tool === 'point') {
      onAddPoint({
        id: `point-${Date.now()}`,
        name: `측점_${points.length + 1}`,
        x: snapRes.effectiveWorld.x,
        y: snapRes.effectiveWorld.y,
        layerId: activeLayerId,
        isSurveyNode: false
      });
      return;
    }

    // 5. LINE TOOL
    if (tool === 'line') {
      if (activePoints.length === 0) {
        setActivePoints([snapRes.effectiveWorld]);
      } else {
        const start = activePoints[0];
        onAddLine({
          id: `line-${Date.now()}`,
          start,
          end: snapRes.effectiveWorld,
          layerId: activeLayerId
        });
        setActivePoints([]);
      }
      return;
    }

    // 6. POLYGON TOOL
    if (tool === 'polygon') {
      setActivePoints(prev => [...prev, snapRes.effectiveWorld]);
      return;
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

  // Mobile Pinch-to-zoom & two-finger pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pointerDownPosRef.current = null; // Cancel single tap drawing
        setSelectionBox(null);
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

        setView({
          panX: touchStart.panX - dx / targetZoom,
          panY: touchStart.panY + dy / targetZoom,
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

  // Screen Resize Observer
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
    ctx.fillStyle = theme === 'dark' ? '#090d16' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // 2. Metric CAD Grid
    drawCADGrid(ctx, width, height, view, theme);

    const getScreen = (p: Point2D) => worldToScreen(p, width, height);

    // Viewport Culling Bounds
    const marginMeters = 30 / view.zoom;
    const visMinX = view.panX - (width / 2) / view.zoom - marginMeters;
    const visMaxX = view.panX + (width / 2) / view.zoom + marginMeters;
    const visMinY = view.panY - (height / 2) / view.zoom - marginMeters;
    const visMaxY = view.panY + (height / 2) / view.zoom + marginMeters;

    // 3. Render Polygons
    polygons.forEach(pg => {
      const layer = layerMap.current.get(pg.layerId);
      if (layer && !layer.visible) return;
      if (pg.points.length < 3) return;

      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
      for (let i = 0; i < pg.points.length; i++) {
        const pt = pg.points[i];
        pMinX = Math.min(pMinX, pt.x);
        pMinY = Math.min(pMinY, pt.y);
        pMaxX = Math.max(pMaxX, pt.x);
        pMaxY = Math.max(pMaxY, pt.y);
      }
      if (pMaxX < visMinX || pMinX > visMaxX || pMaxY < visMinY || pMinY > visMaxY) return;

      const isSelected = selectedSet.has(pg.id);
      const color = isSelected ? '#f59e0b' : (pg.color || layer?.color || '#38bdf8');

      ctx.beginPath();
      const first = getScreen(pg.points[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pg.points.length; i++) {
        const pt = getScreen(pg.points[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();

      ctx.fillStyle = isSelected ? '#f59e0b33' : (color + '22');
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3.5 : 2;
      ctx.stroke();

      // Area label
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

        ctx.fillStyle = isSelected ? '#fbbf24' : '#ffffff';
        ctx.font = '11px Pretendard, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${area.toFixed(3)}㎡ (${(area / 3.305785).toFixed(3)}평)`, screenC.x, screenC.y);
      }
    });

    // 4. Render Polylines
    polylines.forEach(pl => {
      const layer = layerMap.current.get(pl.layerId);
      if (layer && !layer.visible) return;
      if (pl.points.length < 2) return;

      let pMinX = Infinity, pMinY = Infinity, pMaxX = -Infinity, pMaxY = -Infinity;
      for (let i = 0; i < pl.points.length; i++) {
        const pt = pl.points[i];
        pMinX = Math.min(pMinX, pt.x);
        pMinY = Math.min(pMinY, pt.y);
        pMaxX = Math.max(pMaxX, pt.x);
        pMaxY = Math.max(pMaxY, pt.y);
      }
      if (pMaxX < visMinX || pMinX > visMaxX || pMaxY < visMinY || pMinY > visMaxY) return;

      const isSelected = selectedSet.has(pl.id);
      const color = isSelected ? '#f59e0b' : (pl.color || layer?.color || '#38bdf8');

      ctx.beginPath();
      const first = getScreen(pl.points[0]);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < pl.points.length; i++) {
        const pt = getScreen(pl.points[i]);
        ctx.lineTo(pt.x, pt.y);
      }
      if (pl.isClosed) ctx.closePath();

      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 4 : (layer?.lineWidth || 2);
      ctx.stroke();

      // If selected, highlight vertex nodes
      if (isSelected) {
        ctx.fillStyle = '#fbbf24';
        pl.points.forEach(p => {
          const sp = getScreen(p);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    });

    // 5. Render Lines
    const linesByLayer = new Map<string, CADLine[]>();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const minX = Math.min(l.start.x, l.end.x);
      const maxX = Math.max(l.start.x, l.end.x);
      const minY = Math.min(l.start.y, l.end.y);
      const maxY = Math.max(l.start.y, l.end.y);

      if (maxX < visMinX || minX > visMaxX || maxY < visMinY || minY > visMaxY) continue;

      let arr = linesByLayer.get(l.layerId);
      if (!arr) {
        arr = [];
        linesByLayer.set(l.layerId, arr);
      }
      arr.push(l);
    }

    linesByLayer.forEach((layerLines, layerId) => {
      const layer = layerMap.current.get(layerId);
      if (!layer || !layer.visible) return;

      for (let i = 0; i < layerLines.length; i++) {
        const l = layerLines[i];
        const isSelected = selectedSet.has(l.id);
        const sp1 = getScreen(l.start);
        const sp2 = getScreen(l.end);

        ctx.beginPath();
        ctx.moveTo(sp1.x, sp1.y);
        ctx.lineTo(sp2.x, sp2.y);
        ctx.strokeStyle = isSelected ? '#f59e0b' : (layer?.color || '#38bdf8');
        ctx.lineWidth = isSelected ? 4 : (layer?.lineWidth || 1.5);
        ctx.stroke();
      }
    });

    // 6. Render Survey Points & Nodes (with QGIS Dynamic Label Collision Avoidance)
    const visiblePoints: CADPoint[] = [];
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (pt.x < visMinX || pt.x > visMaxX || pt.y < visMinY || pt.y > visMaxY) continue;
      const layer = layerMap.current.get(pt.layerId);
      if (!layer || !layer.visible) continue;
      visiblePoints.push(pt);
    }

    // Step A: Draw point geometry accurately at exact real-world coordinates
    ctx.lineWidth = 1.5;
    const pointScreenCoords = new Map<string, { x: number; y: number }>();

    for (let i = 0; i < visiblePoints.length; i++) {
      const pt = visiblePoints[i];
      const sp = getScreen(pt);
      pointScreenCoords.set(pt.id, sp);
      const isSelected = selectedSet.has(pt.id);
      const layer = layerMap.current.get(pt.layerId);

      if (isSelected) {
        // Multi-select glow ring
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.strokeStyle = isSelected ? '#fbbf24' : (layer?.color || '#ef4444');
      ctx.fillStyle = isSelected ? '#fbbf24' : (layer?.color || '#ef4444');

      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(sp.x - 5, sp.y);
      ctx.lineTo(sp.x + 5, sp.y);
      ctx.moveTo(sp.x, sp.y - 5);
      ctx.lineTo(sp.x, sp.y + 5);
      ctx.stroke();
    }

    // Step B: QGIS-style Dynamic Label Placement Engine (PAL Collision Avoidance)
    const showPointLabels = (visiblePoints.length <= 2500 && view.zoom > 0.0001) || selectedSet.size > 0;
    if (showPointLabels) {
      ctx.font = '10px Pretendard, sans-serif';

      // Keep track of screen bounding boxes already occupied by points or labels
      interface LabelBox {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      }
      const occupiedBoxes: LabelBox[] = [];

      // Register point centers as small obstacles to prevent labels from completely masking adjacent nodes
      for (let i = 0; i < visiblePoints.length; i++) {
        const sp = pointScreenCoords.get(visiblePoints[i].id);
        if (sp) {
          occupiedBoxes.push({
            minX: sp.x - 4,
            minY: sp.y - 4,
            maxX: sp.x + 4,
            maxY: sp.y + 4
          });
        }
      }

      // Check AABB collision helper
      const checkCollision = (box: LabelBox): boolean => {
        for (let k = 0; k < occupiedBoxes.length; k++) {
          const occ = occupiedBoxes[k];
          if (box.minX < occ.maxX && box.maxX > occ.minX && box.minY < occ.maxY && box.maxY > occ.minY) {
            return true;
          }
        }
        return false;
      };

      // Prioritize selected points first so their labels are never dropped
      const prioritizedPoints = [
        ...visiblePoints.filter(p => selectedSet.has(p.id)),
        ...visiblePoints.filter(p => !selectedSet.has(p.id))
      ];

      for (let i = 0; i < prioritizedPoints.length; i++) {
        const pt = prioritizedPoints[i];
        const sp = pointScreenCoords.get(pt.id);
        if (!sp) continue;

        const isSelected = selectedSet.has(pt.id);
        const layerRef = layerMap.current.get(pt.layerId);
        const labelText = pt.name || '';
        if (!labelText.trim()) continue;

        const tw = ctx.measureText(labelText).width;
        const th = 11;

        // 8 standard QGIS compass candidate positions + 4 extended offset positions
        const candidates: { tx: number; ty: number; box: LabelBox; isExtended: boolean }[] = [
          { tx: sp.x + 6, ty: sp.y - 3, box: { minX: sp.x + 5, minY: sp.y - 14, maxX: sp.x + 7 + tw, maxY: sp.y + 1 }, isExtended: false },
          { tx: sp.x + 6, ty: sp.y + 12, box: { minX: sp.x + 5, minY: sp.y + 1, maxX: sp.x + 7 + tw, maxY: sp.y + 16 }, isExtended: false },
          { tx: sp.x - tw - 6, ty: sp.y - 3, box: { minX: sp.x - tw - 7, minY: sp.y - 14, maxX: sp.x - 5, maxY: sp.y + 1 }, isExtended: false },
          { tx: sp.x - tw - 6, ty: sp.y + 12, box: { minX: sp.x - tw - 7, minY: sp.y + 1, maxX: sp.x - 5, maxY: sp.y + 16 }, isExtended: false },
          { tx: sp.x - tw / 2, ty: sp.y - 8, box: { minX: sp.x - tw / 2 - 1, minY: sp.y - 19, maxX: sp.x + tw / 2 + 1, maxY: sp.y - 4 }, isExtended: false },
          { tx: sp.x - tw / 2, ty: sp.y + 16, box: { minX: sp.x - tw / 2 - 1, minY: sp.y + 5, maxX: sp.x + tw / 2 + 1, maxY: sp.y + 20 }, isExtended: false },
          { tx: sp.x + 8, ty: sp.y + 4, box: { minX: sp.x + 7, minY: sp.y - 7, maxX: sp.x + 9 + tw, maxY: sp.y + 8 }, isExtended: false },
          { tx: sp.x - tw - 8, ty: sp.y + 4, box: { minX: sp.x - tw - 9, minY: sp.y - 7, maxX: sp.x - 7, maxY: sp.y + 8 }, isExtended: false },
          { tx: sp.x + 16, ty: sp.y - 12, box: { minX: sp.x + 15, minY: sp.y - 23, maxX: sp.x + 17 + tw, maxY: sp.y - 8 }, isExtended: true },
          { tx: sp.x + 16, ty: sp.y + 20, box: { minX: sp.x + 15, minY: sp.y + 9, maxX: sp.x + 17 + tw, maxY: sp.y + 24 }, isExtended: true },
          { tx: sp.x - tw - 16, ty: sp.y - 12, box: { minX: sp.x - tw - 17, minY: sp.y - 23, maxX: sp.x - 15, maxY: sp.y - 8 }, isExtended: true },
          { tx: sp.x - tw - 16, ty: sp.y + 20, box: { minX: sp.x - tw - 17, minY: sp.y + 9, maxX: sp.x - 15, maxY: sp.y + 24 }, isExtended: true }
        ];

        let chosenCandidate = null;
        for (let c = 0; c < candidates.length; c++) {
          if (!checkCollision(candidates[c].box)) {
            chosenCandidate = candidates[c];
            break;
          }
        }

        if (!chosenCandidate && isSelected) {
          chosenCandidate = candidates[0];
        }

        if (chosenCandidate) {
          occupiedBoxes.push(chosenCandidate.box);

          if (chosenCandidate.isExtended) {
            ctx.save();
            ctx.strokeStyle = isSelected ? '#fbbf2477' : '#94a3b866';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(sp.x, sp.y);
            const leaderEndX = chosenCandidate.tx < sp.x ? chosenCandidate.tx + tw : chosenCandidate.tx;
            ctx.lineTo(leaderEndX, chosenCandidate.ty - 3);
            ctx.stroke();
            ctx.restore();
          }

          ctx.save();
          ctx.font = 'bold 12px Pretendard, sans-serif';
          ctx.textAlign = 'left';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = theme === 'dark' ? '#090d16' : '#ffffff';
          ctx.lineWidth = 2.5;
          ctx.strokeText(labelText, chosenCandidate.tx, chosenCandidate.ty);

          ctx.fillStyle = isSelected ? '#fbbf24' : (layerRef?.color || (theme === 'dark' ? '#e2e8f0' : '#334155'));
          ctx.fillText(labelText, chosenCandidate.tx, chosenCandidate.ty);
          ctx.restore();
        }
      }
    }

    // 7. Render Text Entities & Anchor Nodes
    for (let i = 0; i < texts.length; i++) {
      const txt = texts[i];
      if (txt.x < visMinX || txt.x > visMaxX || txt.y < visMinY || txt.y > visMaxY) continue;
      const tLayer = layerMap.current.get(txt.layerId);
      if (!tLayer || !tLayer.visible) continue;

      const pxHeight = txt.height * view.zoom;
      if (pxHeight < 0.2) continue; 
      const renderPxHeight = Math.max(12, pxHeight); 
      const sp = getScreen({ x: txt.x, y: txt.y });
      const isSelected = selectedSet.has(txt.id);

      ctx.fillStyle = isSelected ? '#f59e0b' : (txt.color || tLayer?.color || '#ffffff');
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, isSelected ? 3.5 : 2, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(sp.x, sp.y);
      if (txt.rotation) {
        ctx.rotate((-txt.rotation * Math.PI) / 180);
      }
      ctx.font = `${renderPxHeight}px Pretendard, sans-serif`;
      ctx.fillStyle = isSelected ? '#fbbf24' : (txt.color || tLayer?.color || (theme === 'dark' ? '#ffffff' : '#1e293b'));
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.fillText(txt.text, 4, 0);

      if (isSelected) {
        const tw = ctx.measureText(txt.text).width;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(2, -renderPxHeight, tw + 4, renderPxHeight + 2);
      }
      ctx.restore();
    }

    // 8. Render Active Drawing / Multi-Point Measuring Path
    if (activePoints.length > 0) {
      if (tool === 'measure') {
        // Distinct Multi-Point Measurement Path
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        const first = getScreen(activePoints[0]);
        ctx.moveTo(first.x, first.y);

        for (let i = 1; i < activePoints.length; i++) {
          const pt = getScreen(activePoints[i]);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();

        // Rubber-band to cursor
        if (cursorWorld) {
          const curSp = getScreen(cursorWorld);
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          const last = getScreen(activePoints[activePoints.length - 1]);
          ctx.moveTo(last.x, last.y);
          ctx.lineTo(curSp.x, curSp.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }

        // Draw measurement points with sequential numbers
        activePoints.forEach((p, idx) => {
          const sp = getScreen(p);
          ctx.fillStyle = '#0891b2';
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, 8, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = 'bold 9px Pretendard, sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${idx + 1}`, sp.x, sp.y);
        });

        // Draw distance badges along completed segments
        let cumDist = 0;
        for (let i = 0; i < activePoints.length - 1; i++) {
          const p1 = activePoints[i];
          const p2 = activePoints[i + 1];
          const seg = distance2D(p1, p2);
          cumDist += seg;
          const midW = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
          const midS = getScreen(midW);

          ctx.font = '10px JetBrains Mono, monospace';
          const badgeText = `${seg.toFixed(3)}m`;
          const tw = ctx.measureText(badgeText).width;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(midS.x - tw / 2 - 5, midS.y - 10, tw + 10, 18, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#67e8f9';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, midS.x, midS.y - 1);
        }

        // Live cursor distance callout with cumulative sum
        if (cursorWorld) {
          const last = activePoints[activePoints.length - 1];
          const segDist = distance2D(last, cursorWorld);
          const totalDist = cumDist + segDist;
          const curSp = getScreen(cursorWorld);

          ctx.font = '11px JetBrains Mono, monospace';
          const label = `+${segDist.toFixed(3)}m (누적: ${totalDist.toFixed(3)}m)`;
          const tw = ctx.measureText(label).width;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(curSp.x + 12, curSp.y - 28, tw + 14, 22, 6);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#22d3ee';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, curSp.x + 19, curSp.y - 17);
        }
      } else {
        // Standard Polyline / Polygon Drawing Preview
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

        if (cursorWorld) {
          const curSp = getScreen(cursorWorld);
          ctx.lineTo(curSp.x, curSp.y);

          if (tool === 'polygon' && activePoints.length >= 2) {
            ctx.lineTo(first.x, first.y);
          }
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Vertex markers
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
          const label = `${segDist.toFixed(3)}m`;
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
          ctx.textBaseline = 'middle';
          ctx.fillText(label, curSp.x + 19, curSp.y - 15);
        }
      }
    }

    // 9. Marquee Selection Box (AutoCAD Blue Window Style)
    if (selectionBox) {
      const bx = Math.min(selectionBox.startScreen.x, selectionBox.currentScreen.x);
      const by = Math.min(selectionBox.startScreen.y, selectionBox.currentScreen.y);
      const bw = Math.abs(selectionBox.currentScreen.x - selectionBox.startScreen.x);
      const bh = Math.abs(selectionBox.currentScreen.y - selectionBox.startScreen.y);

      if (bw > 2 || bh > 2) {
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
      }
    }

    // 10. Magnetic Snap Indicator
    if (activeSnap) {
      const snapSp = getScreen(activeSnap.point);
      drawSnapMarker(ctx, snapSp, activeSnap.type, activeSnap.label, theme);
    }

    // 11. Scale Bar
    drawScaleBar(ctx, width, height, view.zoom, theme);

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
    selectedSet,
    selectionBox,
    worldToScreen,
    viewportSize
  ]);

  return (
    <div className="relative w-full h-full overflow-hidden select-none touch-none">
      <canvas
        ref={canvasRef}
        className={`w-full h-full block ${
          tool === 'pan' || isSpacePressed ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair'
        }`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={handlePointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />

      {/* Floating AutoCAD Z-E (Zoom Extents) Button (icon only as requested) */}
      <div className="absolute right-3.5 bottom-7 z-10 pointer-events-none flex flex-col items-end gap-1.5">
        <button
          onClick={() => zoomExtents()}
          title="전체 맞춤"
          className="pointer-events-auto flex items-center justify-center p-2.5 bg-white/90 dark:bg-slate-900/90 hover:bg-sky-600 text-sky-600 dark:text-sky-400 hover:text-white border border-slate-200 dark:border-slate-700 hover:border-sky-500 rounded-2xl shadow-xl backdrop-blur-md transition group active:scale-95"
        >
          <Focus className="w-5 h-5 transition" />
        </button>
      </div>


      {/* Strict Node Requirement Visual Toast */}
      {nodeHintToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-30 bg-amber-500/95 text-slate-950 font-bold px-4 py-2 rounded-xl shadow-2xl flex items-center gap-2 text-xs border border-amber-300 animate-in fade-in slide-in-from-top-2 duration-150 backdrop-blur-sm pointer-events-none">
          <MapPin className="w-4 h-4 shrink-0 text-slate-950" />
          <span>{nodeHintToast}</span>
        </div>
      )}
    </div>
  );
};

// Helper: Draw Adaptive CAD Grid
function drawCADGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: { panX: number; panY: number; zoom: number },
  theme: 'light' | 'dark' = 'dark'
) {
  const minPixelsBetweenLines = 60;
  const rawSpacing = minPixelsBetweenLines / view.zoom;

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

  ctx.strokeStyle = theme === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.06)';
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = startX; x <= right; x += spacing) {
    const sx = width / 2 + (x - view.panX) * view.zoom;
    ctx.moveTo(sx, 0);
    ctx.lineTo(sx, height);
  }

  for (let y = startY; y <= top; y += spacing) {
    const sy = height / 2 - (y - view.panY) * view.zoom;
    ctx.moveTo(0, sy);
    ctx.lineTo(width, sy);
  }
  ctx.stroke();

  ctx.font = '9px JetBrains Mono, monospace';
  ctx.fillStyle = theme === 'dark' ? 'rgba(148, 163, 184, 0.45)' : 'rgba(71, 85, 105, 0.5)';
  ctx.textAlign = 'left';

  for (let x = startX; x <= right; x += spacing * 2) {
    const sx = width / 2 + (x - view.panX) * view.zoom;
    if (sx > 40 && sx < width - 40) {
      ctx.fillText(`${x.toFixed(3)}m`, sx + 4, height - 8);
    }
  }

  for (let y = startY; y <= top; y += spacing * 2) {
    const sy = height / 2 - (y - view.panY) * view.zoom;
    if (sy > 40 && sy < height - 40) {
      ctx.fillText(`${y.toFixed(3)}m`, 8, sy - 4);
    }
  }
}

// Helper: Draw Magnetic Snap Marker
function drawSnapMarker(
  ctx: CanvasRenderingContext2D,
  screenPt: { x: number; y: number },
  type: SnapType,
  label: string,
  theme: 'light' | 'dark' = 'dark'
) {
  const { x, y } = screenPt;
  ctx.lineWidth = 2;

  if (type === 'node') {
    ctx.strokeStyle = '#22c55e';
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (type === 'endpoint') {
    ctx.strokeStyle = '#22c55e';
    ctx.strokeRect(x - 6, y - 6, 12, 12);
  } else if (type === 'midpoint') {
    ctx.strokeStyle = '#06b6d4';
    ctx.beginPath();
    ctx.moveTo(x, y - 7);
    ctx.lineTo(x + 7, y + 6);
    ctx.lineTo(x - 7, y + 6);
    ctx.closePath();
    ctx.stroke();
  } else if (type === 'intersection') {
    ctx.strokeStyle = '#eab308';
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 6);
    ctx.lineTo(x + 6, y + 6);
    ctx.moveTo(x + 6, y - 6);
    ctx.lineTo(x - 6, y + 6);
    ctx.stroke();
  } else {
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
  ctx.fillStyle = theme === 'dark' ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = theme === 'dark' ? '#22c55e' : '#16a34a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 10, y + 10, textW + 12, 18, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = theme === 'dark' ? '#4ade80' : '#15803d';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x + 16, y + 23);
}

// Helper: Draw Real-world Scale Bar
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  zoom: number,
  theme: 'light' | 'dark' = 'dark'
) {
  const targetPixels = 100;
  const metersRaw = targetPixels / zoom;

  const power = Math.pow(10, Math.floor(Math.log10(metersRaw)));
  let barMeters = power;
  if (metersRaw / power > 5) barMeters = power * 5;
  else if (metersRaw / power > 2) barMeters = power * 2;
  else if (metersRaw / power > 1) barMeters = power;

  const barPixels = barMeters * zoom;
  const startX = 20;
  const startY = height - 20;

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

  ctx.font = '10px JetBrains Mono, monospace';
  ctx.fillStyle = theme === 'dark' ? '#f8fafc' : '#475569';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const label = barMeters >= 1000 ? `${(barMeters / 1000).toFixed(3)} km` : `${barMeters.toFixed(3)} m`;
  ctx.fillText(label, startX + barPixels / 2, startY - 6);
}
