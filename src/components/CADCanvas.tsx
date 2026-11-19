/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Focus, MapPin, Map as MapIcon, X, EyeOff, LocateFixed } from 'lucide-react';
import { COORDINATE_SYSTEMS } from '../utils/projections';
import {
  VWorldMapLayer,
  VWorldMapSnapshot,
  VWorldOverlayConfig,
  VWORLD_LAYERS,
  drawVWorldOverlay,
  getDefaultKoreaCenterWorld,
  lonLatToWorld
} from '../utils/vworldTiles';
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
import {
  CADGeometryMutation,
  LinearTargetHit,
  OffsetTargetHit,
  breakEntityAtPoint,
  breakEntityBetweenPoints,
  computeBreakGapPreview,
  computeExtendByDistanceOperation,
  computeExtendToBoundaryOperation,
  computeOffsetOperation,
  computeTrimOperation,
  createCirclePolyline,
  createRectangleByDimensions,
  createRectanglePolyline,
  findClosestLinearTarget,
  findClosestOffsetTarget,
  moveEntitiesByDelta
} from '../utils/cadOperations';

const CANVAS_SANS_FONT = 'system-ui, -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", "Segoe UI", Roboto, sans-serif';
const CANVAS_MONO_FONT = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';

interface CADCanvasProps {
  theme?: 'light' | 'dark';
  tool: ToolMode;
  breakMode?: 'split' | 'gap';
  extendMode?: 'distance' | 'boundary';
  extendDistance?: number | null;
  offsetDistance?: number | null;
  offsetTarget?: OffsetTargetHit | null;
  onChangeOffsetTarget?: (target: OffsetTargetHit | null) => void;
  rectDimSpec?: { width: number; height: number; anchor: 'corner' | 'center'; locked: boolean } | null;
  circleDimSpec?: { radius: number; locked: boolean } | null;
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
  onSelectEntities?: (ids: string[]) => void;
  onAddPoint: (point: CADPoint) => void;
  onAddLine: (line: CADLine) => void;
  onAddPolyline: (polyline: CADPolyline) => void;
  onAddPolygon: (polygon: CADPolygon) => void;
  onApplyGeometryMutation?: (description: string, mutation: CADGeometryMutation) => void;
  onCursorMove: (world: Point2D | null, snap: SnapPoint | null) => void;
  onLiveMeasurementChange?: (data: { currentSegment: number; totalLength: number; area?: number; pointCount: number }) => void;
  activePoints: Point2D[];
  setActivePoints: React.Dispatch<React.SetStateAction<Point2D[]>>;
  zoomExtentsTrigger?: number | { timestamp: number; targetPoints?: Point2D[] } | null;
  mapConfig: VWorldOverlayConfig;
  onChangeMapConfig: React.Dispatch<React.SetStateAction<VWorldOverlayConfig>>;
}

export const CADCanvas: React.FC<CADCanvasProps> = ({
  theme = 'dark',
  tool,
  breakMode = 'split',
  extendMode = 'distance',
  extendDistance = null,
  offsetDistance = null,
  offsetTarget = null,
  onChangeOffsetTarget,
  rectDimSpec = null,
  circleDimSpec = null,
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
  onSelectEntities,
  onAddPoint,
  onAddLine,
  onAddPolyline,
  onAddPolygon,
  onApplyGeometryMutation,
  onCursorMove,
  onLiveMeasurementChange,
  activePoints,
  setActivePoints,
  zoomExtentsTrigger,
  mapConfig,
  onChangeMapConfig
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenMapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mapSnapshotRef = useRef<VWorldMapSnapshot | null>(null);
  const [tileRenderTick, setTileRenderTick] = useState(0);
  const tileRafRef = useRef<number | null>(null);
  const [mapMenuOpen, setMapMenuOpen] = useState(false);
  const [mapTileError, setMapTileError] = useState(false);
  const mapLoadSuccessCountRef = useRef(0);

  // Pure display-only live GPS tracking (never persisted to IndexedDB)
  const [gpsEnabled, setGpsEnabled] = useState(false);
  const [gpsFollow, setGpsFollow] = useState(false);
  const [gpsRaw, setGpsRaw] = useState<{
    lon: number;
    lat: number;
    accuracy: number;
    heading: number | null;
  } | null>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const gpsFollowRef = useRef(false);
  gpsFollowRef.current = gpsFollow;

  // Viewport state: CAD world coordinate at canvas center
  const [view, setView] = useState<{ panX: number; panY: number; zoom: number }>({
    panX: 0,
    panY: 0,
    zoom: 2.0 // pixels per meter
  });

  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapPoint | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  const wheelSettleTimerRef = useRef<number | null>(null);
  const isMapInteracting = isPanning || isPinching || isWheelZooming;
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

  // First picked point for 2-point CAD Break (gap mode)
  const [breakFirstHit, setBreakFirstHit] = useState<LinearTargetHit | null>(null);

  useEffect(() => {
    setBreakFirstHit(null);
  }, [tool, breakMode]);

  useEffect(() => {
    return () => {
      if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
      if (tileRafRef.current !== null) cancelAnimationFrame(tileRafRef.current);
      if (wheelSettleTimerRef.current !== null) window.clearTimeout(wheelSettleTimerRef.current);
      if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(gpsWatchIdRef.current);
        gpsWatchIdRef.current = null;
      }
    };
  }, []);

  const showNodeHint = useCallback((msg: string) => {
    if (hintTimeoutRef.current) clearTimeout(hintTimeoutRef.current);
    setNodeHintToast(msg);
    hintTimeoutRef.current = setTimeout(() => {
      setNodeHintToast(null);
    }, 2400);
  }, []);

  const scheduleTileRedraw = useCallback(() => {
    mapLoadSuccessCountRef.current += 1;
    setMapTileError(false);
    if (tileRafRef.current !== null) return;
    tileRafRef.current = requestAnimationFrame(() => {
      tileRafRef.current = null;
      setTileRenderTick(t => t + 1);
    });
  }, []);

  const handleTileError = useCallback(() => {
    if (mapLoadSuccessCountRef.current === 0) {
      setMapTileError(true);
    }
  }, []);

  const selectMapLayer = useCallback((nextLayer: VWorldMapLayer) => {
    if (nextLayer !== 'off') {
      mapLoadSuccessCountRef.current = 0;
      setMapTileError(false);

      const hasEntities =
        points.length > 0 ||
        lines.length > 0 ||
        polylines.length > 0 ||
        polygons.length > 0 ||
        texts.length > 0;

      if (!hasEntities && Math.abs(view.panX) < 5000 && Math.abs(view.panY) < 5000) {
        const center = getDefaultKoreaCenterWorld(mapConfig.sourceCrs);
        setView({ panX: center.x, panY: center.y, zoom: 0.7 });
        showNodeHint('원점(0,0) 상태여서 서울 중심으로 지도를 표시합니다.');
      } else if (hasEntities && Math.abs(view.panX) < 5000 && Math.abs(view.panY) < 5000) {
        showNodeHint('로컬 상대좌표 도면은 실제 한국 TM 좌표와 위치가 다를 수 있습니다.');
      }
    } else {
      setMapTileError(false);
    }

    onChangeMapConfig(prev => ({ ...prev, layer: nextLayer }));
  }, [points.length, lines.length, polylines.length, polygons.length, texts.length, view.panX, view.panY, mapConfig.sourceCrs, onChangeMapConfig, showNodeHint]);

  const gpsWorldPos = useMemo(() => {
    if (!gpsEnabled || !gpsRaw) return null;
    const pt = lonLatToWorld(gpsRaw.lon, gpsRaw.lat, mapConfig.sourceCrs);
    if (!pt) return null;
    return {
      ...pt,
      accuracy: gpsRaw.accuracy,
      heading: gpsRaw.heading
    };
  }, [gpsEnabled, gpsRaw, mapConfig.sourceCrs]);

  const sourceCrsRef = useRef(mapConfig.sourceCrs);
  sourceCrsRef.current = mapConfig.sourceCrs;

  const stopGpsWatch = useCallback(() => {
    if (gpsWatchIdRef.current !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
    }
    setGpsEnabled(false);
    setGpsFollow(false);
    setGpsRaw(null);
  }, []);

  const handleGpsButtonClick = useCallback(() => {
    if (!gpsEnabled) {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        showNodeHint('이 기기/브라우저에서는 GPS 위치 기능을 지원하지 않습니다.');
        return;
      }
      setGpsEnabled(true);
      setGpsFollow(true);
      gpsFollowRef.current = true;
      showNodeHint('내 위치를 찾는 중... (이동 시 파란 점이 따라 움직입니다)');

      gpsWatchIdRef.current = navigator.geolocation.watchPosition(
        pos => {
          const { longitude, latitude, accuracy, heading } = pos.coords;
          const validHeading = typeof heading === 'number' && Number.isFinite(heading) ? heading : null;
          setGpsRaw({
            lon: longitude,
            lat: latitude,
            accuracy: Number.isFinite(accuracy) ? accuracy : 20,
            heading: validHeading
          });

          if (gpsFollowRef.current) {
            const wp = lonLatToWorld(longitude, latitude, sourceCrsRef.current);
            if (wp) {
              setView(prev => ({
                panX: wp.x,
                panY: wp.y,
                zoom: prev.zoom < 0.25 ? 1.5 : prev.zoom
              }));
            }
          }
        },
        err => {
          if (err.code === err.PERMISSION_DENIED) {
            showNodeHint('위치 권한이 거부되었습니다. 브라우저 설정에서 위치 권한을 허용해 주세요.');
            stopGpsWatch();
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            showNodeHint('GPS 신호를 수신할 수 없습니다.');
          } else {
            showNodeHint('위치 수신이 지연되고 있습니다. 실외에서 다시 시도해 주세요.');
          }
        },
        {
          enableHighAccuracy: true,
          maximumAge: 2500,
          timeout: 15000
        }
      );
      return;
    }

    if (!gpsFollow) {
      setGpsFollow(true);
      gpsFollowRef.current = true;
      if (gpsWorldPos) {
        setView(prev => ({
          panX: gpsWorldPos.x,
          panY: gpsWorldPos.y,
          zoom: prev.zoom < 0.25 ? 1.5 : prev.zoom
        }));
      }
      showNodeHint('내 위치 따라가기 켜짐 (한 번 더 누르면 종료)');
      return;
    }

    stopGpsWatch();
    showNodeHint('내 위치 표시를 종료했습니다.');
  }, [gpsEnabled, gpsFollow, gpsWorldPos, showNodeHint, stopGpsWatch]);

  // Listen for Spacebar key to enable pan freely while drawing
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'SELECT') return;
      if (e.code === 'Space' && !e.repeat) {
        setIsSpacePressed(true);
      } else if (e.key === 'Escape') {
        setBreakFirstHit(null);
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

  // Update live measurements to parent (only emit when values actually change)
  const onLiveMeasurementChangeRef = useRef(onLiveMeasurementChange);
  onLiveMeasurementChangeRef.current = onLiveMeasurementChange;
  const lastLiveMeasurementRef = useRef<{
    currentSegment: number;
    totalLength: number;
    area?: number;
    pointCount: number;
  } | null>(null);

  useEffect(() => {
    const emit = onLiveMeasurementChangeRef.current;
    if (!emit) return;

    const targetPoint = cursorWorld ? (activeSnap ? activeSnap.point : cursorWorld) : null;

    let nextMeasurement: {
      currentSegment: number;
      totalLength: number;
      area?: number;
      pointCount: number;
    };

    if (tool === 'rectangle' && activePoints.length === 1 && targetPoint) {
      const p1 = activePoints[0];
      const w = Math.abs(targetPoint.x - p1.x);
      const h = Math.abs(targetPoint.y - p1.y);
      nextMeasurement = {
        currentSegment: distance2D(p1, targetPoint),
        totalLength: 2 * (w + h),
        area: w * h,
        pointCount: 1
      };
    } else if (tool === 'circle' && activePoints.length === 1 && targetPoint) {
      const r = distance2D(activePoints[0], targetPoint);
      nextMeasurement = {
        currentSegment: r,
        totalLength: 2 * Math.PI * r,
        area: Math.PI * r * r,
        pointCount: 1
      };
    } else {
      let totalLength = 0;
      for (let i = 0; i < activePoints.length - 1; i++) {
        totalLength += distance2D(activePoints[i], activePoints[i + 1]);
      }

      let currentSegment = 0;
      if (activePoints.length > 0 && targetPoint) {
        const activeLast = activePoints[activePoints.length - 1];
        currentSegment = distance2D(activeLast, targetPoint);
      }

      let area = 0;
      if (tool === 'polygon' && activePoints.length >= 2 && targetPoint) {
        const pts = [...activePoints, targetPoint];
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          area += pts[i].x * pts[j].y;
          area -= pts[j].x * pts[i].y;
        }
        area = Math.abs(area) / 2.0;
      }

      nextMeasurement = {
        currentSegment,
        totalLength: totalLength + (tool !== 'polygon' ? currentSegment : 0),
        area: tool === 'polygon' ? area : undefined,
        pointCount: activePoints.length
      };
    }

    const prev = lastLiveMeasurementRef.current;
    if (
      prev &&
      prev.currentSegment === nextMeasurement.currentSegment &&
      prev.totalLength === nextMeasurement.totalLength &&
      prev.area === nextMeasurement.area &&
      prev.pointCount === nextMeasurement.pointCount
    ) {
      return;
    }

    lastLiveMeasurementRef.current = nextMeasurement;
    emit(nextMeasurement);
  }, [activePoints, cursorWorld, activeSnap, tool]);

  // Live hover previews for Break and Trim CAD tools
  const resolveBreakHit = useCallback((worldPt: Point2D, snapPt?: Point2D | null, onlyId?: string): LinearTargetHit | null => {
    const hitRadius = 24 / view.zoom;
    const baseHit = findClosestLinearTarget(worldPt, hitRadius, lines, polylines, layers, onlyId);
    if (snapPt) {
      const snapTolerance = Math.max(0.05, 10 / view.zoom);
      if (baseHit) {
        const snapOnBase = findClosestLinearTarget(snapPt, snapTolerance, lines, polylines, layers, baseHit.id);
        if (snapOnBase) return snapOnBase;
      } else {
        const snapHit = findClosestLinearTarget(snapPt, snapTolerance, lines, polylines, layers, onlyId);
        if (snapHit) return snapHit;
      }
    }
    return baseHit;
  }, [view.zoom, lines, polylines, layers]);

  const resolveBreakPair = useCallback((
    firstHit: LinearTargetHit,
    worldPt: Point2D,
    snapPt?: Point2D | null
  ): { first: LinearTargetHit; second: LinearTargetHit } | null => {
    const sameEntityHit = resolveBreakHit(worldPt, snapPt, firstHit.id);
    if (sameEntityHit) {
      return { first: firstHit, second: sameEntityHit };
    }
    const anyHit = resolveBreakHit(worldPt, snapPt);
    if (anyHit && anyHit.id !== firstHit.id) {
      const junctionTol = Math.max(0.05, 14 / view.zoom);
      const firstOnSame = findClosestLinearTarget(firstHit.point, junctionTol, lines, polylines, layers, anyHit.id);
      if (firstOnSame) {
        return { first: firstOnSame, second: anyHit };
      }
    }
    return null;
  }, [resolveBreakHit, view.zoom, lines, polylines, layers]);

  const hoveredBreakPair = useMemo(() => {
    if (tool !== 'break' || !cursorWorld) return null;
    if (breakMode === 'gap' && breakFirstHit) {
      return resolveBreakPair(breakFirstHit, cursorWorld, activeSnap?.point);
    }
    const hit = resolveBreakHit(cursorWorld, activeSnap?.point);
    return hit ? { first: hit, second: null as LinearTargetHit | null } : null;
  }, [tool, cursorWorld, activeSnap, breakMode, breakFirstHit, resolveBreakHit, resolveBreakPair]);

  const hoveredBreakHit = hoveredBreakPair?.second || hoveredBreakPair?.first || null;

  const hoveredTrimPreview = useMemo(() => {
    if (tool !== 'trim' || !cursorWorld) return null;
    const hitRadius = 18 / view.zoom;
    const hit = findClosestLinearTarget(cursorWorld, hitRadius, lines, polylines, layers);
    if (!hit) return null;
    return computeTrimOperation(hit, lines, polylines, polygons, layers).preview;
  }, [tool, cursorWorld, view.zoom, lines, polylines, polygons, layers]);

  const hoveredExtendPreview = useMemo(() => {
    if (tool !== 'extend' || !cursorWorld) return null;
    const hitRadius = 18 / view.zoom;
    const hit = findClosestLinearTarget(cursorWorld, hitRadius, lines, polylines, layers);
    if (!hit) return null;
    if (extendMode === 'boundary') {
      return computeExtendToBoundaryOperation(hit, lines, polylines, polygons, layers).preview;
    }
    if (!extendDistance || !isFinite(extendDistance) || extendDistance <= 0) return null;
    return computeExtendByDistanceOperation(hit, extendDistance, lines, polylines, layers).preview;
  }, [tool, cursorWorld, view.zoom, lines, polylines, polygons, layers, extendMode, extendDistance]);

  const hoveredOffsetCandidate = useMemo(() => {
    if (tool !== 'offset' || offsetTarget || !cursorWorld) return null;
    return findClosestOffsetTarget(cursorWorld, 18 / view.zoom, lines, polylines, polygons, layers);
  }, [tool, offsetTarget, cursorWorld, view.zoom, lines, polylines, polygons, layers]);

  const hoveredOffsetPreview = useMemo(() => {
    if (tool !== 'offset' || !offsetTarget || !offsetDistance || !isFinite(offsetDistance) || offsetDistance <= 0) return null;
    const sidePt = activeSnap ? activeSnap.point : cursorWorld;
    if (!sidePt) return null;
    return computeOffsetOperation(offsetTarget, sidePt, offsetDistance, lines, polylines, polygons, layers, activeLayerId).preview;
  }, [tool, offsetTarget, offsetDistance, activeSnap, cursorWorld, lines, polylines, polygons, layers, activeLayerId]);

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
      if (gpsFollowRef.current) setGpsFollow(false);
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

  const findSingleHitEntityId = useCallback((targetWorld: Point2D, hitRadius: number): string | null => {
    for (const pt of points) {
      const l = layerMap.current.get(pt.layerId);
      if (l?.visible === false) continue;
      if (distance2D(targetWorld, pt) < hitRadius) return pt.id;
    }
    for (const txt of texts) {
      const l = layerMap.current.get(txt.layerId);
      if (l?.visible === false) continue;
      if (distance2D(targetWorld, { x: txt.x, y: txt.y }) < hitRadius) return txt.id;
    }
    for (const pl of polylines) {
      const l = layerMap.current.get(pl.layerId);
      if (l?.visible === false) continue;
      for (let i = 0; i < pl.points.length - 1; i++) {
        const { distance } = closestPointOnSegment(targetWorld, pl.points[i], pl.points[i + 1]);
        if (distance < hitRadius) return pl.id;
      }
      if (pl.isClosed && pl.points.length >= 2) {
        const { distance } = closestPointOnSegment(targetWorld, pl.points[pl.points.length - 1], pl.points[0]);
        if (distance < hitRadius) return pl.id;
      }
    }
    for (const ln of lines) {
      const l = layerMap.current.get(ln.layerId);
      if (l?.visible === false) continue;
      const { distance } = closestPointOnSegment(targetWorld, ln.start, ln.end);
      if (distance < hitRadius) return ln.id;
    }
    for (const pg of polygons) {
      const l = layerMap.current.get(pg.layerId);
      if (l?.visible === false) continue;
      for (let i = 0; i < pg.points.length; i++) {
        const j = (i + 1) % pg.points.length;
        const { distance } = closestPointOnSegment(targetWorld, pg.points[i], pg.points[j]);
        if (distance < hitRadius) return pg.id;
      }
    }
    return null;
  }, [points, texts, polylines, lines, polygons]);

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
          if (lay?.visible !== false && isPolylineInOrIntersectBox(pl.points, box, pl.isClosed)) foundIds.push(pl.id);
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
        const targetWorld = screenToWorld(screenX, screenY, rect.width, rect.height);
        const hitId = findSingleHitEntityId(targetWorld, 18 / view.zoom);

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

    // If moved > 10px (matches pan threshold), it was a pan or drag gesture, cancel drawing click!
    if (movedDist > 10) {
      return;
    }

    let targetWorld = screenToWorld(screenX, screenY, rect.width, rect.height);
    const snapRes = evaluateSnap(targetWorld);
    const to2D = (pt: Point2D): Point2D => ({ x: pt.x, y: pt.y });

    // 2. POLYLINE TOOL: STRICT NODE REQUIREMENT
    // User request: "연속 그리기는 측점(노드)가 있는 곳에서만 적용되게 해줘... 우리 도면은 텍스트가 노드점이 돼..."
    if (tool === 'polyline') {
      if (!snapRes.snap || (snapRes.snap.type !== 'node' && snapRes.snap.type !== 'endpoint')) {
        showNodeHint('연속선은 측점(노드) 또는 텍스트 점을 클릭해서 연결해야 합니다.');
        return;
      }

      const ptToAdd = to2D(snapRes.snap.point);
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
      const ptToAdd = to2D(snapRes.snap ? snapRes.snap.point : snapRes.effectiveWorld);
      if (activePoints.length > 0) {
        const last = activePoints[activePoints.length - 1];
        if (distance2D(last, ptToAdd) < 0.0001) return;
      }
      setActivePoints(prev => [...prev, ptToAdd]);
      return;
    }

    // 4. POINT TOOL
    if (tool === 'point') {
      const ptName = `측점_${points.length + 1}`;
      onAddPoint({
        id: `point-${Date.now()}`,
        name: ptName,
        x: snapRes.effectiveWorld.x,
        y: snapRes.effectiveWorld.y,
        layerId: activeLayerId,
        isSurveyNode: false,
        attributes: {
          TEXTSTRING: ptName,
          TEXTHEIGHT: 1,
          'marker-symbol': 'circle',
          'marker-size': 'medium'
        }
      });
      return;
    }

    // 5. LINE TOOL
    if (tool === 'line') {
      const click2D = to2D(snapRes.effectiveWorld);
      if (activePoints.length === 0) {
        setActivePoints([click2D]);
      } else {
        const start = to2D(activePoints[0]);
        onAddLine({
          id: `line-${Date.now()}`,
          start,
          end: click2D,
          layerId: activeLayerId
        });
        setActivePoints([]);
      }
      return;
    }

    // 6. RECTANGLE TOOL (2-click corner-to-corner or 1-click locked dimension stamp)
    if (tool === 'rectangle') {
      const click2D = to2D(snapRes.effectiveWorld);
      if (rectDimSpec?.locked && Math.abs(rectDimSpec.width) > 1e-4 && Math.abs(rectDimSpec.height) > 1e-4) {
        onAddPolyline(
          createRectangleByDimensions(
            click2D,
            rectDimSpec.width,
            rectDimSpec.height,
            rectDimSpec.anchor,
            activeLayerId,
            `사각형_${polylines.length + 1}`
          )
        );
        setActivePoints([]);
        return;
      }
      if (activePoints.length === 0) {
        setActivePoints([click2D]);
      } else {
        const p1 = to2D(activePoints[0]);
        const p2 = click2D;
        if (Math.abs(p2.x - p1.x) > 1e-4 && Math.abs(p2.y - p1.y) > 1e-4) {
          onAddPolyline(createRectanglePolyline(p1, p2, activeLayerId, `사각형_${polylines.length + 1}`));
        }
        setActivePoints([]);
      }
      return;
    }

    // 7. CIRCLE TOOL (2-click center-to-radius or 1-click locked dimension stamp)
    if (tool === 'circle') {
      const click2D = to2D(snapRes.effectiveWorld);
      if (circleDimSpec?.locked && circleDimSpec.radius > 1e-4) {
        onAddPolyline(
          createCirclePolyline(
            click2D,
            circleDimSpec.radius,
            activeLayerId,
            64,
            `원_${polylines.length + 1}`
          )
        );
        setActivePoints([]);
        return;
      }
      if (activePoints.length === 0) {
        setActivePoints([click2D]);
      } else {
        const center = to2D(activePoints[0]);
        const radius = distance2D(center, click2D);
        if (radius > 1e-4) {
          onAddPolyline(createCirclePolyline(center, radius, activeLayerId, 64, `원_${polylines.length + 1}`));
        }
        setActivePoints([]);
      }
      return;
    }

    // 8. POLYGON TOOL
    if (tool === 'polygon') {
      setActivePoints(prev => [...prev, to2D(snapRes.effectiveWorld)]);
      return;
    }

    // 9. BREAK TOOL (1-point split or 2-point gap)
    if (tool === 'break') {
      if (breakMode === 'split') {
        const hit =
          resolveBreakHit(snapRes.effectiveWorld, snapRes.snap?.point) ??
          resolveBreakHit(targetWorld, snapRes.snap?.point);
        if (!hit) {
          showNodeHint('끊을 선(단일선/연속선) 위를 클릭하세요.');
          return;
        }
        if (layerMap.current.get(hit.layerId)?.locked) {
          showNodeHint('잠긴 레이어의 객체는 수정할 수 없습니다.');
          return;
        }
        const { mutation, error } = breakEntityAtPoint(hit, lines, polylines);
        if (error || !mutation) {
          showNodeHint(error || '이 위치에서는 선을 끊을 수 없습니다.');
          return;
        }
        onApplyGeometryMutation?.('선 끊기 (Break)', mutation);
        if (mutation.message) showNodeHint(mutation.message);
      } else {
        if (!breakFirstHit) {
          const hit =
            resolveBreakHit(snapRes.effectiveWorld, snapRes.snap?.point) ??
            resolveBreakHit(targetWorld, snapRes.snap?.point);
          if (!hit) {
            showNodeHint('끊을 선(단일선/연속선) 위를 클릭하세요.');
            return;
          }
          if (layerMap.current.get(hit.layerId)?.locked) {
            showNodeHint('잠긴 레이어의 객체는 수정할 수 없습니다.');
            return;
          }
          setBreakFirstHit(hit);
          showNodeHint('같은 선 위에서 두 번째 지점을 클릭하세요.');
        } else {
          const pair =
            resolveBreakPair(breakFirstHit, snapRes.effectiveWorld, snapRes.snap?.point) ??
            resolveBreakPair(breakFirstHit, targetWorld, snapRes.snap?.point);
          if (!pair) {
            showNodeHint('첫 번째 점과 같은 선 위를 클릭하세요. (취소: ESC)');
            return;
          }
          if (layerMap.current.get(pair.second.layerId)?.locked) {
            showNodeHint('잠긴 레이어의 객체는 수정할 수 없습니다.');
            return;
          }
          const { mutation, error } = breakEntityBetweenPoints(pair.first, pair.second, lines, polylines);
          if (error || !mutation) {
            showNodeHint(error || '구간 끊기에 실패했습니다.');
            return;
          }
          setBreakFirstHit(null);
          onApplyGeometryMutation?.('구간 끊기 (Break)', mutation);
          if (mutation.message) showNodeHint(mutation.message);
        }
      }
      return;
    }

    // 10. TRIM TOOL (Quick Trim against all visible cutting edges)
    if (tool === 'trim') {
      const hit = findClosestLinearTarget(targetWorld, 18 / view.zoom, lines, polylines, layers);
      if (!hit) {
        showNodeHint('자르기(Trim)할 선 구간을 클릭하세요.');
        return;
      }
      const { preview, error } = computeTrimOperation(hit, lines, polylines, polygons, layers);
      if (error || !preview) {
        showNodeHint(error || '교차하는 기준 선이 없어 자르기(Trim)할 수 없습니다.');
        return;
      }
      onApplyGeometryMutation?.('선 자르기 (Trim)', preview.mutation);
      return;
    }

    // 10.5 EXTEND TOOL (Extend by typed distance or to boundary edge)
    if (tool === 'extend') {
      const hit = findClosestLinearTarget(targetWorld, 18 / view.zoom, lines, polylines, layers);
      if (!hit) {
        showNodeHint('연장(Extend)할 선의 끝쪽을 클릭하세요.');
        return;
      }
      if (extendMode === 'distance') {
        if (!extendDistance || !isFinite(extendDistance) || extendDistance <= 0) {
          showNodeHint('상단 입력창에 연장할 치수(m)를 0보다 크게 입력해 주세요.');
          return;
        }
        const { preview, error } = computeExtendByDistanceOperation(hit, extendDistance, lines, polylines, layers);
        if (error || !preview) {
          showNodeHint(error || '선을 연장할 수 없습니다.');
          return;
        }
        onApplyGeometryMutation?.('선 치수 연장 (Extend)', preview.mutation);
      } else {
        const { preview, error } = computeExtendToBoundaryOperation(hit, lines, polylines, polygons, layers);
        if (error || !preview) {
          showNodeHint(error || '연장 방향에 닿는 경계 선이 없습니다.');
          return;
        }
        onApplyGeometryMutation?.('선 경계 연장 (Extend)', preview.mutation);
      }
      return;
    }

    // 11. JOIN TOOL (Click lines/polylines to toggle selection for joining)
    if (tool === 'join') {
      const hit = findClosestLinearTarget(targetWorld, 18 / view.zoom, lines, polylines, layers);
      if (!hit) return;
      if (layerMap.current.get(hit.layerId)?.locked) {
        showNodeHint('잠긴 레이어의 객체는 결합할 수 없습니다.');
        return;
      }
      if (hit.kind === 'polyline' && hit.isClosed) {
        showNodeHint('이미 폐합된 도형은 결합할 수 없습니다.');
        return;
      }
      const nextList = selectedEntityIds.includes(hit.id)
        ? selectedEntityIds.filter(id => id !== hit.id)
        : [...selectedEntityIds, hit.id];
      onSelectEntities?.(nextList);
      return;
    }

    // 12. MOVE TOOL (Select entity -> Base point -> Destination point)
    if (tool === 'move') {
      if (selectedEntityIds.length === 0) {
        const hitId = findSingleHitEntityId(targetWorld, 18 / view.zoom);
        if (!hitId) {
          showNodeHint('먼저 이동할 객체를 클릭하거나 영역 선택으로 지정하세요.');
          return;
        }
        onSelectEntities?.([hitId]);
        showNodeHint('기준점(시작 위치)을 클릭하거나 상단에 ΔX/ΔY를 입력하세요.');
        return;
      }

      if (activePoints.length === 0) {
        setActivePoints([snapRes.effectiveWorld]);
        showNodeHint('이동할 목표 지점을 클릭하세요.');
        return;
      }

      const base = activePoints[0];
      const dest = snapRes.effectiveWorld;
      const dx = dest.x - base.x;
      const dy = dest.y - base.y;
      const { mutation, error } = moveEntitiesByDelta(selectedEntityIds, dx, dy, {
        points,
        lines,
        polylines,
        polygons,
        texts,
        layers
      });
      if (error || !mutation) {
        showNodeHint(error || '객체를 이동할 수 없습니다.');
        return;
      }
      onApplyGeometryMutation?.('객체 이동 (Move)', mutation);
      setActivePoints([]);
      if (mutation.message) showNodeHint(mutation.message);
      return;
    }

    // 13. OFFSET TOOL (Pick line/polyline/polygon -> Pick side to create parallel copy)
    if (tool === 'offset') {
      if (!offsetDistance || !isFinite(offsetDistance) || offsetDistance <= 0) {
        showNodeHint('상단 입력창에 띄울 간격(m)을 0보다 크게 입력해 주세요.');
        return;
      }

      if (!offsetTarget) {
        const hit = findClosestOffsetTarget(targetWorld, 18 / view.zoom, lines, polylines, polygons, layers);
        if (!hit) {
          showNodeHint('간격띄우기할 선, 연속선 또는 폴리곤을 클릭하세요.');
          return;
        }
        onChangeOffsetTarget?.(hit);
        showNodeHint('띄울 방향(좌/우 또는 안/밖)을 화면에서 클릭하세요.');
        return;
      }

      const sidePt = snapRes.snap ? snapRes.snap.point : targetWorld;
      const { preview, error } = computeOffsetOperation(
        offsetTarget,
        sidePt,
        offsetDistance,
        lines,
        polylines,
        polygons,
        layers,
        activeLayerId
      );
      if (error || !preview) {
        showNodeHint(error || '간격띄우기 결과를 생성할 수 없습니다.');
        return;
      }
      onApplyGeometryMutation?.('간격띄우기 (Offset)', preview.mutation);
      onChangeOffsetTarget?.(null);
      if (preview.mutation.message) showNodeHint(preview.mutation.message);
      return;
    }
  };

  // Pointer Cancel / Leave Handler - cleanly resets pan/selection drag without committing a click
  const handlePointerCancelOrLeave = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isPanning) {
      setIsPanning(false);
      panStartRef.current = null;
      try {
        if (e.currentTarget && 'hasPointerCapture' in e.currentTarget && e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // ignore
      }
    }
    pointerDownPosRef.current = null;
    setSelectionBox(null);
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

    if (!isWheelZooming) setIsWheelZooming(true);
    if (wheelSettleTimerRef.current !== null) {
      window.clearTimeout(wheelSettleTimerRef.current);
    }
    wheelSettleTimerRef.current = window.setTimeout(() => {
      wheelSettleTimerRef.current = null;
      setIsWheelZooming(false);
    }, 100);

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
        points: activePoints.map(p => ({ x: p.x, y: p.y })),
        isClosed: false,
        layerId: activeLayerId
      });
      setActivePoints([]);
    } else if (tool === 'polygon' && activePoints.length >= 3) {
      onAddPolygon({
        id: `poly-${Date.now()}`,
        points: activePoints.map(p => ({ x: p.x, y: p.y })),
        layerId: activeLayerId
      });
      setActivePoints([]);
    } else if (tool === 'measure') {
      setActivePoints([]);
    }
  };

  const viewRef = useRef(view);
  viewRef.current = view;

  // Mobile Pinch-to-zoom & two-finger pan
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        pointerDownPosRef.current = null; // Cancel single tap drawing
        setSelectionBox(null);
        setIsPinching(true);
        const t1 = e.touches[0];
        const t2 = e.touches[1];
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const midX = (t1.clientX + t2.clientX) / 2;
        const midY = (t1.clientY + t2.clientY) / 2;
        const curView = viewRef.current;
        touchStartRef.current = {
          dist,
          midX,
          midY,
          panX: curView.panX,
          panY: curView.panY,
          zoom: curView.zoom
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
        if (gpsFollowRef.current && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
          setGpsFollow(false);
        }

        setView({
          panX: touchStart.panX - dx / targetZoom,
          panY: touchStart.panY + dy / targetZoom,
          zoom: targetZoom
        });
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) {
        touchStartRef.current = null;
        setIsPinching(false);
      }
    };

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd);
    canvas.addEventListener('touchcancel', onTouchEnd);

    return () => {
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', onTouchEnd);
      canvas.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // Screen Resize Observer
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      setViewportSize(prev => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
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

    // 1. Dark/Light CAD Background
    ctx.fillStyle = theme === 'dark' ? '#090d16' : '#f8fafc';
    ctx.fillRect(0, 0, width, height);

    // 1.5 VWorld WMTS Background Map Overlay (EPSG:3857 -> Korean TM Affine)
    const mapActive = mapConfig.layer !== 'off';
    if (mapActive) {
      if (!offscreenMapCanvasRef.current) {
        offscreenMapCanvasRef.current = document.createElement('canvas');
      }
      drawVWorldOverlay({
        ctx,
        offscreenCanvas: offscreenMapCanvasRef.current,
        snapshotRef: mapSnapshotRef,
        width,
        height,
        dpr,
        view,
        config: mapConfig,
        tileRenderTick,
        isInteracting: isMapInteracting,
        onTileLoaded: scheduleTileRedraw,
        onTileError: handleTileError
      });
    } else {
      mapSnapshotRef.current = null;
    }

    // 2. Metric CAD Grid
    drawCADGrid(ctx, width, height, view, theme, mapActive);

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

        ctx.font = `600 9.5px ${CANVAS_SANS_FONT}`;
        ctx.textAlign = 'center';
        const areaText = `${area.toFixed(3)}㎡ (${(area / 3.305785).toFixed(3)}평)`;
        if (mapActive) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = theme === 'dark' ? '#090d16' : '#ffffff';
          ctx.strokeText(areaText, screenC.x, screenC.y);
        }
        ctx.fillStyle = isSelected ? '#fbbf24' : (theme === 'dark' ? '#ffffff' : '#0f172a');
        ctx.fillText(areaText, screenC.x, screenC.y);
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
      const attrs = pt.attributes || {};
      const sizeStr = String(attrs['marker-size'] ?? attrs['marker-siz'] ?? 'medium').trim().toLowerCase();
      const symbolStr = String(attrs['marker-symbol'] ?? attrs['marker-sym'] ?? 'circle').trim().toLowerCase();
      const r = (sizeStr === 'minimum' || sizeStr === 'min' || sizeStr === 'small')
        ? 2.5
        : (sizeStr === 'max' || sizeStr === 'maximum' || sizeStr === 'large')
          ? 6.5
          : 4;

      if (isSelected) {
        // Multi-select glow ring
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      const ptColor = isSelected ? '#fbbf24' : (layer?.color || '#ef4444');
      ctx.strokeStyle = ptColor;
      ctx.fillStyle = ptColor;
      ctx.lineWidth = 1.5;

      if (symbolStr === 'circle') {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else if (symbolStr === 'square') {
        ctx.fillRect(sp.x - r, sp.y - r, r * 2, r * 2);
      } else if (symbolStr === 'triangle') {
        const h = r * 1.25;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - h);
        ctx.lineTo(sp.x + h * 0.9, sp.y + h * 0.75);
        ctx.lineTo(sp.x - h * 0.9, sp.y + h * 0.75);
        ctx.closePath();
        ctx.fill();
      } else if (symbolStr === 'diamond') {
        const d = r * 1.25;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y - d);
        ctx.lineTo(sp.x + d, sp.y);
        ctx.lineTo(sp.x, sp.y + d);
        ctx.lineTo(sp.x - d, sp.y);
        ctx.closePath();
        ctx.fill();
      } else if (symbolStr === 'cross') {
        const c = r * 1.35;
        ctx.lineWidth = isSelected ? 2.5 : 2;
        ctx.beginPath();
        ctx.moveTo(sp.x - c, sp.y);
        ctx.lineTo(sp.x + c, sp.y);
        ctx.moveTo(sp.x, sp.y - c);
        ctx.lineTo(sp.x, sp.y + c);
        ctx.stroke();
      } else if (symbolStr === 'star') {
        const outerR = r * 1.35;
        const innerR = r * 0.58;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const rad = k % 2 === 0 ? outerR : innerR;
          const angle = (Math.PI / 5) * k - Math.PI / 2;
          const px = sp.x + Math.cos(angle) * rad;
          const py = sp.y + Math.sin(angle) * rad;
          if (k === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        // Default 'marker': circle + crosshair
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.stroke();

        const c = r * 1.45;
        ctx.beginPath();
        ctx.moveTo(sp.x - c, sp.y);
        ctx.lineTo(sp.x + c, sp.y);
        ctx.moveTo(sp.x, sp.y - c);
        ctx.lineTo(sp.x, sp.y + c);
        ctx.stroke();
      }
    }

    // Step B: QGIS-style Dynamic Label Placement Engine (PAL Collision Avoidance)
    const showPointLabels = (visiblePoints.length <= 2500 && view.zoom > 0.0001) || selectedSet.size > 0;
    if (showPointLabels) {
      // Keep track of screen bounding boxes already occupied by points or labels
      interface LabelBox {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
      }
      const occupiedBoxes: LabelBox[] = [];

      const getPointRadius = (pt: CADPoint): number => {
        const sizeStr = String(pt.attributes?.['marker-size'] ?? pt.attributes?.['marker-siz'] ?? 'medium').trim().toLowerCase();
        if (sizeStr === 'minimum' || sizeStr === 'min' || sizeStr === 'small') return 2.5;
        if (sizeStr === 'max' || sizeStr === 'maximum' || sizeStr === 'large') return 6.5;
        return 4;
      };

      // Register point centers as small obstacles sized by marker radius to prevent labels from masking nodes
      for (let i = 0; i < visiblePoints.length; i++) {
        const pt = visiblePoints[i];
        const sp = pointScreenCoords.get(pt.id);
        if (sp) {
          const pad = getPointRadius(pt) + 1;
          occupiedBoxes.push({
            minX: sp.x - pad,
            minY: sp.y - pad,
            maxX: sp.x + pad,
            maxY: sp.y + pad
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
      const prioritizedPoints = selectedSet.size === 0
        ? visiblePoints
        : [
            ...visiblePoints.filter(p => selectedSet.has(p.id)),
            ...visiblePoints.filter(p => !selectedSet.has(p.id))
          ];

      // Deduplication Map: prevents drawing identical labels at the same spot (common in DXF/SHP with overlapping point/text entities)
      const drawnLabels = new Set<string>();

      for (let i = 0; i < prioritizedPoints.length; i++) {
        const pt = prioritizedPoints[i];
        const sp = pointScreenCoords.get(pt.id);
        if (!sp) continue;

        const isSelected = selectedSet.has(pt.id);
        const layerRef = layerMap.current.get(pt.layerId);
        const labelText = String(pt.attributes?.TEXTSTRING ?? pt.name ?? '');
        if (!labelText.trim()) continue;

        // Create a unique key for this label at this location (with 2px screen tolerance)
        const labelKey = `${labelText}_${Math.round(sp.x / 2)}_${Math.round(sp.y / 2)}`;
        if (drawnLabels.has(labelKey) && !isSelected) continue;
        drawnLabels.add(labelKey);

        const rawHeight = Number(pt.attributes?.TEXTHEIGHT ?? pt.attributes?.textheight ?? pt.attributes?.HEIGHT ?? pt.attributes?.height);
        const textHeightVal = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : 1;
        const r = getPointRadius(pt);

        // Reflect TEXTHEIGHT compactly on screen (9.5px baseline at default 1.0) and scale further when zoomed in
        const screenFallbackPx = Math.min(24, Math.max(8, 9.5 * textHeightVal));
        const fontPx = Math.round(Math.min(48, Math.max(screenFallbackPx, textHeightVal * view.zoom)));
        const fontSpec = `500 ${fontPx}px ${CANVAS_SANS_FONT}`;
        ctx.font = fontSpec;

        const tw = ctx.measureText(labelText).width;
        const lh = fontPx;
        const offset = Math.round(r + 3);
        const extOffset = Math.round(r + 11);

        const makeBox = (tx: number, ty: number): LabelBox => ({
          minX: tx - 1,
          minY: ty - lh,
          maxX: tx + tw + 1,
          maxY: ty + 3
        });

        // 8 standard QGIS compass candidate positions + 4 extended offset positions
        const candidates: { tx: number; ty: number; box: LabelBox; isExtended: boolean }[] = [
          { tx: sp.x + offset, ty: sp.y - 3, box: makeBox(sp.x + offset, sp.y - 3), isExtended: false },
          { tx: sp.x + offset, ty: sp.y + lh, box: makeBox(sp.x + offset, sp.y + lh), isExtended: false },
          { tx: sp.x - tw - offset, ty: sp.y - 3, box: makeBox(sp.x - tw - offset, sp.y - 3), isExtended: false },
          { tx: sp.x - tw - offset, ty: sp.y + lh, box: makeBox(sp.x - tw - offset, sp.y + lh), isExtended: false },
          { tx: sp.x - tw / 2, ty: sp.y - offset - 2, box: makeBox(sp.x - tw / 2, sp.y - offset - 2), isExtended: false },
          { tx: sp.x - tw / 2, ty: sp.y + offset + lh, box: makeBox(sp.x - tw / 2, sp.y + offset + lh), isExtended: false },
          { tx: sp.x + offset + 2, ty: sp.y + Math.round(lh * 0.35), box: makeBox(sp.x + offset + 2, sp.y + Math.round(lh * 0.35)), isExtended: false },
          { tx: sp.x - tw - offset - 2, ty: sp.y + Math.round(lh * 0.35), box: makeBox(sp.x - tw - offset - 2, sp.y + Math.round(lh * 0.35)), isExtended: false },
          { tx: sp.x + extOffset, ty: sp.y - Math.max(10, Math.round(lh * 0.8)), box: makeBox(sp.x + extOffset, sp.y - Math.max(10, Math.round(lh * 0.8))), isExtended: true },
          { tx: sp.x + extOffset, ty: sp.y + lh + 8, box: makeBox(sp.x + extOffset, sp.y + lh + 8), isExtended: true },
          { tx: sp.x - tw - extOffset, ty: sp.y - Math.max(10, Math.round(lh * 0.8)), box: makeBox(sp.x - tw - extOffset, sp.y - Math.max(10, Math.round(lh * 0.8))), isExtended: true },
          { tx: sp.x - tw - extOffset, ty: sp.y + lh + 8, box: makeBox(sp.x - tw - extOffset, sp.y + lh + 8), isExtended: true }
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
            ctx.lineTo(leaderEndX, chosenCandidate.ty - Math.round(lh * 0.3));
            ctx.stroke();
            ctx.restore();
          }

          ctx.save();
          ctx.font = fontSpec;
          ctx.textAlign = 'left';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = theme === 'dark' ? '#090d16' : '#ffffff';
          ctx.lineWidth = Math.max(1.5, Math.min(3.5, fontPx * 0.18));
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
      const renderPxHeight = Math.max(9.5, pxHeight); 
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
      ctx.font = `${renderPxHeight}px ${CANVAS_SANS_FONT}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      if (mapActive) {
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1.5, Math.min(3.5, renderPxHeight * 0.18));
        ctx.strokeStyle = theme === 'dark' ? '#090d16' : '#ffffff';
        ctx.strokeText(txt.text, 4, 0);
      }
      ctx.fillStyle = isSelected ? '#fbbf24' : (txt.color || tLayer?.color || (theme === 'dark' ? '#ffffff' : '#1e293b'));
      ctx.fillText(txt.text, 4, 0);

      if (isSelected) {
        const tw = ctx.measureText(txt.text).width;
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(2, -renderPxHeight, tw + 4, renderPxHeight + 2);
      }
      ctx.restore();
    }

    // 7.5 Locked-Dimension Shape Stamp Previews (before 1st click)
    const effectivePreviewCursor = activeSnap ? activeSnap.point : cursorWorld;
    if (activePoints.length === 0 && effectivePreviewCursor) {
      if (tool === 'rectangle' && rectDimSpec?.locked && Math.abs(rectDimSpec.width) > 1e-4 && Math.abs(rectDimSpec.height) > 1e-4) {
        const previewPoly = createRectangleByDimensions(
          effectivePreviewCursor,
          rectDimSpec.width,
          rectDimSpec.height,
          rectDimSpec.anchor,
          activeLayerId
        );
        const sPts = previewPoly.points.map(getScreen);
        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(sPts[0].x, sPts[0].y);
        for (let i = 1; i < sPts.length; i++) ctx.lineTo(sPts[i].x, sPts[i].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        const sc = getScreen(effectivePreviewCursor);
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, 4.5, 0, Math.PI * 2);
        ctx.fill();

        const label = `${Math.abs(rectDimSpec.width).toFixed(2)}m × ${Math.abs(rectDimSpec.height).toFixed(2)}m (치수고정)`;
        ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(sc.x + 12, sc.y - 24, tw + 12, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, sc.x + 18, sc.y - 14);
        ctx.restore();
      } else if (tool === 'circle' && circleDimSpec?.locked && circleDimSpec.radius > 1e-4) {
        const sc = getScreen(effectivePreviewCursor);
        const radiusPx = circleDimSpec.radius * view.zoom;
        ctx.save();
        ctx.fillStyle = 'rgba(56, 189, 248, 0.14)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, 4.5, 0, Math.PI * 2);
        ctx.fill();

        const label = `R = ${circleDimSpec.radius.toFixed(3)}m (D = ${(circleDimSpec.radius * 2).toFixed(3)}m · 고정)`;
        ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(sc.x + 12, sc.y - 24, tw + 12, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, sc.x + 18, sc.y - 14);
        ctx.restore();
      }
    }

    // 8. Render Active Drawing / Multi-Point Measuring Path / Move Ghost Preview
    if (activePoints.length > 0) {
      if (tool === 'move') {
        const base = activePoints[0];
        const sBase = getScreen(base);
        const target = effectivePreviewCursor;
        ctx.save();

        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sBase.x, sBase.y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (target && selectedSet.size > 0) {
          const dx = target.x - base.x;
          const dy = target.y - base.y;
          const sDest = getScreen(target);

          // Ghost preview of translated selected entities
          ctx.strokeStyle = '#38bdf8';
          ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
          ctx.lineWidth = 1.8;
          ctx.setLineDash([5, 4]);

          for (const pt of points) {
            if (!selectedSet.has(pt.id)) continue;
            const sp = getScreen({ x: pt.x + dx, y: pt.y + dy });
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 4.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          for (const ln of lines) {
            if (!selectedSet.has(ln.id)) continue;
            const sp1 = getScreen({ x: ln.start.x + dx, y: ln.start.y + dy });
            const sp2 = getScreen({ x: ln.end.x + dx, y: ln.end.y + dy });
            ctx.beginPath();
            ctx.moveTo(sp1.x, sp1.y);
            ctx.lineTo(sp2.x, sp2.y);
            ctx.stroke();
          }
          for (const pl of polylines) {
            if (!selectedSet.has(pl.id) || pl.points.length < 2) continue;
            ctx.beginPath();
            const p0 = getScreen({ x: pl.points[0].x + dx, y: pl.points[0].y + dy });
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pl.points.length; i++) {
              const pi = getScreen({ x: pl.points[i].x + dx, y: pl.points[i].y + dy });
              ctx.lineTo(pi.x, pi.y);
            }
            if (pl.isClosed) ctx.closePath();
            ctx.stroke();
          }
          for (const pg of polygons) {
            if (!selectedSet.has(pg.id) || pg.points.length < 3) continue;
            ctx.beginPath();
            const p0 = getScreen({ x: pg.points[0].x + dx, y: pg.points[0].y + dy });
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pg.points.length; i++) {
              const pi = getScreen({ x: pg.points[i].x + dx, y: pg.points[i].y + dy });
              ctx.lineTo(pi.x, pi.y);
            }
            ctx.closePath();
            ctx.stroke();
          }
          for (const t of texts) {
            if (!selectedSet.has(t.id)) continue;
            const sp = getScreen({ x: t.x + dx, y: t.y + dy });
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, 3.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }

          // Vector guide line from base to target
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(sBase.x, sBase.y);
          ctx.lineTo(sDest.x, sDest.y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = '#38bdf8';
          ctx.beginPath();
          ctx.arc(sDest.x, sDest.y, 4.5, 0, Math.PI * 2);
          ctx.fill();

          const distM = Math.hypot(dx, dy);
          const label = `ΔX ${dx >= 0 ? '+' : ''}${dx.toFixed(3)}m · ΔY ${dy >= 0 ? '+' : ''}${dy.toFixed(3)}m (${distM.toFixed(3)}m)`;
          ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
          ctx.strokeStyle = '#f59e0b';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(sDest.x + 12, sDest.y - 24, tw + 12, 20, 5);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#fbbf24';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, sDest.x + 18, sDest.y - 14);
        }
        ctx.restore();
      } else if (tool === 'measure') {
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
          ctx.arc(sp.x, sp.y, 7.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1.5;
          ctx.stroke();

          ctx.font = `bold 8.5px ${CANVAS_SANS_FONT}`;
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

          ctx.font = `9.5px ${CANVAS_MONO_FONT}`;
          const badgeText = `${seg.toFixed(3)}m`;
          const tw = ctx.measureText(badgeText).width;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(midS.x - tw / 2 - 5, midS.y - 9, tw + 10, 17, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#67e8f9';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(badgeText, midS.x, midS.y - 0.5);
        }

        // Live cursor distance callout with cumulative sum
        if (cursorWorld) {
          const last = activePoints[activePoints.length - 1];
          const segDist = distance2D(last, cursorWorld);
          const totalDist = cumDist + segDist;
          const curSp = getScreen(cursorWorld);

          ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
          const label = `+${segDist.toFixed(3)}m (누적: ${totalDist.toFixed(3)}m)`;
          const tw = ctx.measureText(label).width;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.95)';
          ctx.strokeStyle = '#06b6d4';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.roundRect(curSp.x + 12, curSp.y - 24, tw + 12, 20, 5);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#22d3ee';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, curSp.x + 18, curSp.y - 14);
        }
      } else if (tool === 'rectangle' && activePoints.length === 1 && cursorWorld) {
        const p1 = activePoints[0];
        const p2 = cursorWorld;
        const s1 = getScreen(p1);
        const s2 = getScreen(p2);
        const rx = Math.min(s1.x, s2.x);
        const ry = Math.min(s1.y, s2.y);
        const rw = Math.abs(s2.x - s1.x);
        const rh = Math.abs(s2.y - s1.y);

        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(s1.x, s1.y, 4.5, 0, Math.PI * 2);
        ctx.fill();

        const wM = Math.abs(p2.x - p1.x);
        const hM = Math.abs(p2.y - p1.y);
        const label = `${wM.toFixed(3)}m × ${hM.toFixed(3)}m (${(wM * hM).toFixed(2)}㎡)`;
        ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(s2.x + 12, s2.y - 24, tw + 12, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, s2.x + 18, s2.y - 14);
      } else if (tool === 'circle' && activePoints.length === 1 && cursorWorld) {
        const center = activePoints[0];
        const sc = getScreen(center);
        const sp = getScreen(cursorWorld);
        const radiusM = distance2D(center, cursorWorld);
        const radiusPx = radiusM * view.zoom;

        ctx.fillStyle = 'rgba(56, 189, 248, 0.12)';
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, radiusPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Radius guide line
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sc.x, sc.y);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(sc.x, sc.y, 4.5, 0, Math.PI * 2);
        ctx.fill();

        const label = `R = ${radiusM.toFixed(3)}m (D = ${(radiusM * 2).toFixed(3)}m)`;
        ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = '#0284c7';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(sp.x + 12, sp.y - 24, tw + 12, 20, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#38bdf8';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, sp.x + 18, sp.y - 14);
      } else {
        // Standard Polyline / Polygon / Line Drawing Preview
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

          ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
          const label = `${segDist.toFixed(3)}m`;
          const tw = ctx.measureText(label).width;

          ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
          ctx.strokeStyle = '#0284c7';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(curSp.x + 12, curSp.y - 23, tw + 12, 19, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = '#38bdf8';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(label, curSp.x + 18, curSp.y - 13.5);
        }
      }
    }

    // 8.5 CAD Trim & Break Live Overlays
    if (tool === 'trim' && hoveredTrimPreview) {
      ctx.save();
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 5;
      ctx.setLineDash([6, 4]);
      hoveredTrimPreview.trimSegments.forEach(segPts => {
        if (segPts.length < 2) return;
        ctx.beginPath();
        const p0 = getScreen(segPts[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < segPts.length; i++) {
          const ps = getScreen(segPts[i]);
          ctx.lineTo(ps.x, ps.y);
        }
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Draw cut X markers at intersection boundaries
      hoveredTrimPreview.cutPoints.forEach(cp => {
        const sp = getScreen(cp);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(sp.x - 5, sp.y - 5);
        ctx.lineTo(sp.x + 5, sp.y + 5);
        ctx.moveTo(sp.x + 5, sp.y - 5);
        ctx.lineTo(sp.x - 5, sp.y + 5);
        ctx.stroke();

        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x - 5, sp.y - 5);
        ctx.lineTo(sp.x + 5, sp.y + 5);
        ctx.moveTo(sp.x + 5, sp.y - 5);
        ctx.lineTo(sp.x - 5, sp.y + 5);
        ctx.stroke();
      });
      ctx.restore();
    }

    if (tool === 'break') {
      ctx.save();
      if (breakFirstHit) {
        const sp1 = getScreen(breakFirstHit.point);
        ctx.fillStyle = '#f59e0b';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sp1.x, sp1.y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      if (breakMode === 'gap' && hoveredBreakPair?.second) {
        const gapPreview = computeBreakGapPreview(hoveredBreakPair.first, hoveredBreakPair.second, lines, polylines);
        if (gapPreview && gapPreview.points.length >= 2) {
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 5;
          ctx.setLineDash([6, 4]);
          ctx.beginPath();
          const p0 = getScreen(gapPreview.points[0]);
          ctx.moveTo(p0.x, p0.y);
          for (let i = 1; i < gapPreview.points.length; i++) {
            const ps = getScreen(gapPreview.points[i]);
            ctx.lineTo(ps.x, ps.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      if (hoveredBreakHit) {
        const sp = getScreen(hoveredBreakHit.point);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(sp.x - 6, sp.y - 6);
        ctx.lineTo(sp.x + 6, sp.y + 6);
        ctx.moveTo(sp.x + 6, sp.y - 6);
        ctx.lineTo(sp.x - 6, sp.y + 6);
        ctx.stroke();

        ctx.strokeStyle = '#ec4899';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sp.x - 6, sp.y - 6);
        ctx.lineTo(sp.x + 6, sp.y + 6);
        ctx.moveTo(sp.x + 6, sp.y - 6);
        ctx.lineTo(sp.x - 6, sp.y + 6);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (tool === 'extend' && hoveredExtendPreview) {
      const sFrom = getScreen(hoveredExtendPreview.fromPoint);
      const sTo = getScreen(hoveredExtendPreview.toPoint);
      ctx.save();
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 4;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(sFrom.x, sFrom.y);
      ctx.lineTo(sTo.x, sTo.y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#f59e0b';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sFrom.x, sFrom.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.arc(sTo.x, sTo.y, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      const label = `+${hoveredExtendPreview.addedLength.toFixed(3)}m`;
      ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(sTo.x + 12, sTo.y - 23, tw + 12, 19, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#34d399';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, sTo.x + 18, sTo.y - 13.5);
      ctx.restore();
    }

    if (tool === 'offset') {
      const highlightTarget = offsetTarget || hoveredOffsetCandidate;
      if (highlightTarget) {
        ctx.save();
        ctx.strokeStyle = offsetTarget ? '#f59e0b' : 'rgba(245, 158, 11, 0.75)';
        ctx.lineWidth = offsetTarget ? 3.5 : 2.5;
        if (highlightTarget.kind === 'line') {
          const ln = lines.find(l => l.id === highlightTarget.id);
          if (ln) {
            const p1 = getScreen(ln.start);
            const p2 = getScreen(ln.end);
            ctx.beginPath();
            ctx.moveTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        } else if (highlightTarget.kind === 'polyline') {
          const pl = polylines.find(p => p.id === highlightTarget.id);
          if (pl && pl.points.length >= 2) {
            ctx.beginPath();
            const p0 = getScreen(pl.points[0]);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pl.points.length; i++) {
              const pi = getScreen(pl.points[i]);
              ctx.lineTo(pi.x, pi.y);
            }
            if (pl.isClosed) ctx.closePath();
            ctx.stroke();
          }
        } else {
          const pg = polygons.find(p => p.id === highlightTarget.id);
          if (pg && pg.points.length >= 3) {
            ctx.beginPath();
            const p0 = getScreen(pg.points[0]);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < pg.points.length; i++) {
              const pi = getScreen(pg.points[i]);
              ctx.lineTo(pi.x, pi.y);
            }
            ctx.closePath();
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      if (hoveredOffsetPreview && hoveredOffsetPreview.previewPoints.length >= 2) {
        ctx.save();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.8;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        const p0 = getScreen(hoveredOffsetPreview.previewPoints[0]);
        ctx.moveTo(p0.x, p0.y);
        for (let i = 1; i < hoveredOffsetPreview.previewPoints.length; i++) {
          const pi = getScreen(hoveredOffsetPreview.previewPoints[i]);
          ctx.lineTo(pi.x, pi.y);
        }
        if (hoveredOffsetPreview.isClosed) ctx.closePath();
        ctx.stroke();

        const gFrom = getScreen(hoveredOffsetPreview.guideFrom);
        const gTo = getScreen(hoveredOffsetPreview.guideTo);
        ctx.strokeStyle = '#34d399';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(gFrom.x, gFrom.y);
        ctx.lineTo(gTo.x, gTo.y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = '#10b981';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(gTo.x, gTo.y, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        const label = `간격 ${Math.abs(hoveredOffsetPreview.signedDistance).toFixed(3)}m`;
        ctx.font = `10.5px ${CANVAS_MONO_FONT}`;
        const tw = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(gTo.x + 12, gTo.y - 23, tw + 12, 19, 5);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#34d399';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, gTo.x + 18, gTo.y - 13.5);
        ctx.restore();
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

    // 9.5 Live GPS Location Dot (Pure Display Only)
    if (gpsWorldPos) {
      const sp = getScreen(gpsWorldPos);
      ctx.save();

      // Accuracy radius circle (skip huge low-precision IP radius > 500m)
      if (gpsWorldPos.accuracy > 0 && gpsWorldPos.accuracy <= 500) {
        const accPx = Math.max(10, gpsWorldPos.accuracy * view.zoom);
        ctx.fillStyle = 'rgba(59, 130, 246, 0.14)';
        ctx.strokeStyle = 'rgba(59, 130, 246, 0.48)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, accPx, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      // Heading direction cone when moving
      if (gpsWorldPos.heading !== null) {
        const headingRad = ((gpsWorldPos.heading - 90) * Math.PI) / 180;
        const coneR = 26;
        const spread = Math.PI / 6;
        const grad = ctx.createRadialGradient(sp.x, sp.y, 4, sp.x, sp.y, coneR);
        grad.addColorStop(0, 'rgba(37, 99, 235, 0.55)');
        grad.addColorStop(1, 'rgba(37, 99, 235, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.arc(sp.x, sp.y, coneR, headingRad - spread, headingRad + spread);
        ctx.closePath();
        ctx.fill();
      }

      // White halo + vivid blue core dot
      ctx.shadowColor = 'rgba(15, 23, 42, 0.45)';
      ctx.shadowBlur = 6;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#2563eb';
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 5.2, 0, Math.PI * 2);
      ctx.fill();

      // Compact accuracy badge
      const accLabel = `내 위치 ±${Math.round(gpsWorldPos.accuracy)}m`;
      ctx.font = `600 9.5px ${CANVAS_SANS_FONT}`;
      const tw = ctx.measureText(accLabel).width;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = 'rgba(96, 165, 250, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(sp.x - tw / 2 - 5, sp.y + 12, tw + 10, 17, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#e0f2fe';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(accLabel, sp.x, sp.y + 20.5);

      ctx.restore();
    }

    // 10. Magnetic Snap Indicator
    if (activeSnap) {
      const snapSp = getScreen(activeSnap.point);
      drawSnapMarker(ctx, snapSp, activeSnap.type, activeSnap.label, theme);
    }

    // 11. Scale Bar
    drawScaleBar(ctx, height, view.zoom, theme, mapActive);

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
    viewportSize,
    hoveredTrimPreview,
    hoveredExtendPreview,
    hoveredOffsetCandidate,
    hoveredOffsetPreview,
    offsetTarget,
    hoveredBreakHit,
    hoveredBreakPair,
    breakFirstHit,
    breakMode,
    extendMode,
    extendDistance,
    rectDimSpec,
    circleDimSpec,
    activeLayerId,
    theme,
    mapConfig,
    tileRenderTick,
    isMapInteracting,
    scheduleTileRedraw,
    handleTileError,
    gpsWorldPos
  ]);

  const activeMapSpec = VWORLD_LAYERS.find(l => l.id === mapConfig.layer);

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
        onPointerCancel={handlePointerCancelOrLeave}
        onPointerLeave={handlePointerCancelOrLeave}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
      />

      {/* VWorld Attribution Watermark when Map is Active */}
      {mapConfig.layer !== 'off' && (
        <div className="pointer-events-none absolute left-3 bottom-1 sm:bottom-2 z-10 px-2 py-0.5 rounded-md bg-slate-950/60 text-slate-200 text-[9px] font-sans backdrop-blur-sm border border-white/10">
          © VWorld (국토교통부) · {mapConfig.sourceCrs}
        </div>
      )}

      {/* Floating Map Overlay Selector + AutoCAD Z-E (Zoom Extents) Button */}
      <div className="absolute right-3.5 bottom-20 sm:bottom-7 z-20 pointer-events-none flex flex-col items-end gap-2">
        {mapMenuOpen && (
          <div className="pointer-events-auto w-72 max-w-[calc(100vw-28px)] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700/90 rounded-2xl shadow-2xl p-3 space-y-2.5 animate-in fade-in slide-in-from-bottom-2 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
              <div className="flex items-center gap-1.5">
                <MapIcon className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span className="text-xs font-bold text-slate-900 dark:text-white">VWorld 배경지도</span>
              </div>
              <button
                onClick={() => setMapMenuOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                title="닫기"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => selectMapLayer('off')}
                className={`px-2 py-1.5 rounded-xl text-[11px] font-semibold flex items-center justify-center gap-1 border transition ${
                  mapConfig.layer === 'off'
                    ? 'bg-slate-800 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-800 dark:border-slate-100 shadow-sm'
                    : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <EyeOff className="w-3 h-3" />
                <span>끄기</span>
              </button>
              {VWORLD_LAYERS.map(layerSpec => {
                const isSelected = mapConfig.layer === layerSpec.id;
                return (
                  <button
                    key={layerSpec.id}
                    onClick={() => selectMapLayer(isSelected ? 'off' : layerSpec.id)}
                    className={`px-2 py-1.5 rounded-xl text-[11px] font-semibold border transition truncate ${
                      isSelected
                        ? 'bg-sky-600 text-white border-sky-500 shadow-md shadow-sky-600/25'
                        : 'bg-slate-50 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-sky-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {layerSpec.shortLabel}
                  </button>
                );
              })}
            </div>

            {mapConfig.layer !== 'off' && (
              <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-600 dark:text-slate-300">지도 투명도</span>
                    <span className="font-mono font-bold text-sky-600 dark:text-sky-400">
                      {Math.round(mapConfig.opacity * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={100}
                    step={5}
                    value={Math.round(mapConfig.opacity * 100)}
                    onChange={e => {
                      const pct = Number(e.target.value);
                      onChangeMapConfig(prev => ({ ...prev, opacity: pct / 100 }));
                    }}
                    className="w-full accent-sky-500 cursor-pointer h-1.5 bg-slate-200 dark:bg-slate-700 rounded-lg"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    도면 좌표계 (TM)
                  </label>
                  <select
                    value={mapConfig.sourceCrs}
                    onChange={e => onChangeMapConfig(prev => ({ ...prev, sourceCrs: e.target.value }))}
                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-sky-300 text-[11px] rounded-xl px-2 py-1.5 outline-none font-semibold"
                  >
                    {Object.values(COORDINATE_SYSTEMS)
                      .filter(cs => cs.isTM)
                      .map(cs => (
                        <option key={cs.code} value={cs.code}>
                          {cs.code} · {cs.name}
                        </option>
                      ))}
                  </select>
                </div>

                {mapTileError && (
                  <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-700/70 text-[10px] text-amber-800 dark:text-amber-300 leading-relaxed">
                    지도 타일을 불러오지 못했습니다. 네트워크 상태 또는 VWorld API 키 허용 도메인을 확인해 주세요.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleGpsButtonClick}
          title={
            !gpsEnabled
              ? '현재 내 위치 표시 (실시간 이동)'
              : gpsFollow
                ? '내 위치 추적 중 (누르면 끄기)'
                : '내 위치로 화면 이동'
          }
          className={`pointer-events-auto relative flex items-center justify-center p-2.5 rounded-2xl shadow-xl backdrop-blur-md border transition active:scale-95 ${
            gpsEnabled && gpsFollow
              ? 'bg-blue-600 hover:bg-blue-500 text-white border-blue-400 shadow-blue-600/35'
              : gpsEnabled
                ? 'bg-blue-50 dark:bg-slate-900 text-blue-600 dark:text-blue-400 border-blue-400 dark:border-blue-500 shadow-blue-500/20'
                : 'bg-white/90 dark:bg-slate-900/90 hover:bg-blue-600 text-slate-700 dark:text-slate-200 hover:text-white border-slate-200 dark:border-slate-700 hover:border-blue-500'
          }`}
        >
          <LocateFixed className={`w-5 h-5 ${gpsEnabled && !gpsRaw ? 'animate-pulse' : ''}`} />
          {gpsEnabled && (
            <span
              className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white dark:border-slate-900 ${
                gpsFollow ? 'bg-emerald-400 animate-ping' : 'bg-blue-500'
              }`}
            />
          )}
        </button>

        <button
          onClick={() => setMapMenuOpen(prev => !prev)}
          title="VWorld 배경지도 설정"
          className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-2.5 rounded-2xl shadow-xl backdrop-blur-md border transition active:scale-95 ${
            mapConfig.layer !== 'off'
              ? 'bg-sky-600 hover:bg-sky-500 text-white border-sky-400 shadow-sky-600/30'
              : 'bg-white/90 dark:bg-slate-900/90 hover:bg-sky-600 text-slate-700 dark:text-slate-200 hover:text-white border-slate-200 dark:border-slate-700 hover:border-sky-500'
          }`}
        >
          <MapIcon className="w-5 h-5" />
          {activeMapSpec && (
            <span className="text-[11px] font-bold pr-0.5">{activeMapSpec.shortLabel}</span>
          )}
        </button>

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
  theme: 'light' | 'dark' = 'dark',
  mapActive: boolean = false
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

  ctx.strokeStyle = mapActive
    ? (theme === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(15, 23, 42, 0.05)')
    : (theme === 'dark' ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.06)');
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

  ctx.font = `8.5px ${CANVAS_MONO_FONT}`;
  ctx.fillStyle = mapActive
    ? (theme === 'dark' ? 'rgba(226, 232, 240, 0.8)' : 'rgba(15, 23, 42, 0.75)')
    : (theme === 'dark' ? 'rgba(148, 163, 184, 0.45)' : 'rgba(71, 85, 105, 0.5)');
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
  ctx.font = `10px ${CANVAS_SANS_FONT}`;
  const textW = ctx.measureText(label).width;
  ctx.fillStyle = theme === 'dark' ? 'rgba(15, 23, 42, 0.9)' : 'rgba(255, 255, 255, 0.95)';
  ctx.strokeStyle = theme === 'dark' ? '#22c55e' : '#16a34a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x + 10, y + 10, textW + 10, 17, 4);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = theme === 'dark' ? '#4ade80' : '#15803d';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(label, x + 15, y + 22);
}

// Helper: Draw Real-world Scale Bar
function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  height: number,
  zoom: number,
  theme: 'light' | 'dark' = 'dark',
  mapActive: boolean = false
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
  const startY = mapActive ? height - 30 : height - 20;

  if (mapActive) {
    ctx.strokeStyle = theme === 'dark' ? 'rgba(9, 13, 22, 0.85)' : 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + barPixels, startY);
    ctx.moveTo(startX, startY - 4);
    ctx.lineTo(startX, startY + 4);
    ctx.moveTo(startX + barPixels, startY - 4);
    ctx.lineTo(startX + barPixels, startY + 4);
    ctx.stroke();
  }

  ctx.strokeStyle = theme === 'dark' ? '#f8fafc' : '#0f172a';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(startX + barPixels, startY);
  ctx.moveTo(startX, startY - 4);
  ctx.lineTo(startX, startY + 4);
  ctx.moveTo(startX + barPixels, startY - 4);
  ctx.lineTo(startX + barPixels, startY + 4);
  ctx.stroke();

  ctx.font = `600 9.5px ${CANVAS_MONO_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  const label = barMeters >= 1000 ? `${(barMeters / 1000).toFixed(3)} km` : `${barMeters.toFixed(3)} m`;
  if (mapActive) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme === 'dark' ? '#090d16' : '#ffffff';
    ctx.strokeText(label, startX + barPixels / 2, startY - 6);
  }
  ctx.fillStyle = theme === 'dark' ? '#f8fafc' : '#0f172a';
  ctx.fillText(label, startX + barPixels / 2, startY - 6);
}

