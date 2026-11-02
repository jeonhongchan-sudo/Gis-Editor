/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, CheckCircle2, Focus } from 'lucide-react';
import { 
  CADLayer, 
  CADLine, 
  CADPoint, 
  CADPolygon, 
  CADPolyline, 
  CADText, 
  HistoryStep, 
  Point2D, 
  ProjectState, 
  SnapPoint, 
  ToolMode 
} from './types/cad';
import { CADCanvas } from './components/CADCanvas';
import { Toolbar } from './components/Toolbar';
import { CoordinateBar } from './components/CoordinateBar';
import { LayerPanel } from './components/LayerPanel';
import { PointTableModal } from './components/PointTableModal';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { HelpModal } from './components/HelpModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { SAMPLE_SURVEY_CSV_EPSG5186, buildCADPointsFromCSV, parseCSVPreview } from './utils/csvParser';

const DEFAULT_LAYERS: CADLayer[] = [
  {
    id: 'layer-survey-points',
    name: '현황측점 (Points)',
    color: '#ef4444',
    visible: true,
    locked: false,
    lineWidth: 2,
    isSurveyPointsLayer: true
  },
  {
    id: 'layer-boundary',
    name: '부지경계선 (Boundary)',
    color: '#38bdf8',
    visible: true,
    locked: false,
    lineWidth: 2.5
  },
  {
    id: 'layer-road',
    name: '도로현황 (Road)',
    color: '#eab308',
    visible: true,
    locked: false,
    lineWidth: 2
  },
  {
    id: 'layer-structure',
    name: '구조물 (Structure)',
    color: '#a855f7',
    visible: true,
    locked: false,
    lineWidth: 2
  },
  {
    id: 'layer-0',
    name: '기본도면 (0)',
    color: '#ffffff',
    visible: true,
    locked: false,
    lineWidth: 1.5
  }
];

export default function App() {
  // Coordinate System and X/Y Orientation
  const [crs, setCrs] = useState<string>('EPSG:5186');
  const [isSwappedXY, setIsSwappedXY] = useState<boolean>(true);

  // Entities & Layers
  const [layers, setLayers] = useState<CADLayer[]>(DEFAULT_LAYERS);
  const [activeLayerId, setActiveLayerId] = useState<string>('layer-boundary');
  const [points, setPoints] = useState<CADPoint[]>([]);
  const [lines, setLines] = useState<CADLine[]>([]);
  const [polylines, setPolylines] = useState<CADPolyline[]>([]);
  const [polygons, setPolygons] = useState<CADPolygon[]>([]);
  const [texts, setTexts] = useState<CADText[]>([]);

  // Selection & Tools
  const [tool, setTool] = useState<ToolMode>('polyline');
  const [ortho, setOrtho] = useState<boolean>(false);
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  // Active Drawing State
  const [activePoints, setActivePoints] = useState<Point2D[]>([]);
  const [cursorWorld, setCursorWorld] = useState<Point2D | null>(null);
  const [activeSnap, setActiveSnap] = useState<SnapPoint | null>(null);
  const [liveMeasurement, setLiveMeasurement] = useState<{
    currentSegment: number;
    totalLength: number;
    area?: number;
    pointCount: number;
  }>({ currentSegment: 0, totalLength: 0, pointCount: 0 });

  // View triggers: Supports auto-centering on specific target points (e.g. newly imported survey points)
  const [zoomExtentsTrigger, setZoomExtentsTrigger] = useState<{ timestamp: number; targetPoints?: Point2D[] } | null>(null);
  const [importToast, setImportToast] = useState<{ message: string; count: number } | null>(null);
  const lastKeySequenceRef = useRef<{ key: string; time: number } | null>(null);

  const handleZoomExtents = useCallback((targetPoints?: Point2D[]) => {
    setZoomExtentsTrigger({ timestamp: Date.now(), targetPoints });
  }, []);

  // Modals & Panels
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [showTableModal, setShowTableModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);

  // History for Undo / Redo
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const isUndoingOrRedoing = useRef(false);

  // Push new state to history
  const pushHistory = useCallback((desc: string) => {
    if (isUndoingOrRedoing.current) return;
    const totalEntities = points.length + lines.length + polylines.length + polygons.length;
    const maxSteps = totalEntities > 5000 ? 5 : 15;
    const step: HistoryStep = {
      layers: [...layers],
      points: [...points],
      lines: [...lines],
      polylines: [...polylines],
      polygons: [...polygons],
      texts: [...texts],
      description: desc
    };
    setHistory(prev => {
      const slice = prev.slice(Math.max(0, historyIndex - maxSteps + 2), historyIndex + 1);
      return [...slice, step];
    });
    setHistoryIndex(prev => Math.min(prev + 1, maxSteps));
  }, [layers, points, lines, polylines, polygons, texts, historyIndex]);

  // Undo / Redo handlers
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      isUndoingOrRedoing.current = true;
      const targetStep = history[historyIndex - 1];
      setLayers(targetStep.layers);
      setPoints(targetStep.points);
      setLines(targetStep.lines);
      setPolylines(targetStep.polylines);
      setPolygons(targetStep.polygons);
      setTexts(targetStep.texts);
      setHistoryIndex(prev => prev - 1);
      setTimeout(() => { isUndoingOrRedoing.current = false; }, 50);
    }
  }, [history, historyIndex]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      isUndoingOrRedoing.current = true;
      const targetStep = history[historyIndex + 1];
      setLayers(targetStep.layers);
      setPoints(targetStep.points);
      setLines(targetStep.lines);
      setPolylines(targetStep.polylines);
      setPolygons(targetStep.polygons);
      setTexts(targetStep.texts);
      setHistoryIndex(prev => prev + 1);
      setTimeout(() => { isUndoingOrRedoing.current = false; }, 50);
    }
  }, [history, historyIndex]);

  // Keyboard Shortcuts: Ctrl+Z (Undo), Ctrl+Y (Redo), Escape (Cancel Drawing), Enter (Finish Drawing), Z-E (Zoom Extents)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') {
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Escape') {
        setActivePoints([]);
        setSelectedEntityId(null);
      } else if (e.key === 'Enter') {
        handleFinishDrawing();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEntityId) {
          handleDeleteSelected();
        }
      } else if (e.key.toLowerCase() === 'z' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // AutoCAD classic shortcut: Z then E sequence
        lastKeySequenceRef.current = { key: 'z', time: Date.now() };
      } else if (e.key.toLowerCase() === 'e' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (lastKeySequenceRef.current && lastKeySequenceRef.current.key === 'z' && Date.now() - lastKeySequenceRef.current.time < 1500) {
          e.preventDefault();
          handleZoomExtents();
          lastKeySequenceRef.current = null;
        }
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleZoomExtents();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleZoomExtents, selectedEntityId, activePoints]);

  // Load initial demo data on fresh start if empty
  useEffect(() => {
    const saved = localStorage.getItem('webcad_project_state');
    if (saved) {
      try {
        const parsed: ProjectState = JSON.parse(saved);
        setCrs(parsed.crs || 'EPSG:5186');
        setIsSwappedXY(parsed.isSwappedXY !== undefined ? parsed.isSwappedXY : true);
        if (parsed.layers) setLayers(parsed.layers);
        if (parsed.points) setPoints(parsed.points);
        if (parsed.lines) setLines(parsed.lines);
        if (parsed.polylines) setPolylines(parsed.polylines);
        if (parsed.polygons) setPolygons(parsed.polygons);
        if (parsed.texts) setTexts(parsed.texts);
        return;
      } catch (e) {
        console.warn('Failed to restore local project:', e);
      }
    }

    // Initialize with standard sample data (EPSG:5186)
    try {
      const preview = parseCSVPreview(SAMPLE_SURVEY_CSV_EPSG5186);
      const initialPts = buildCADPointsFromCSV(preview.allRows, preview.detectedMapping, 'layer-survey-points');
      setPoints(initialPts);

      // Pre-connect sample boundary polyline for road/boundary demonstration
      if (initialPts.length >= 6) {
        const sampleBoundary: CADPolyline = {
          id: 'sample-pl-1',
          name: '경계_01-05',
          points: initialPts.slice(0, 5).map(p => ({ x: p.x, y: p.y })),
          isClosed: false,
          layerId: 'layer-boundary',
          color: '#38bdf8'
        };
        setPolylines([sampleBoundary]);
      }
    } catch {
      // Ignored
    }
  }, []);

  // Auto-save to LocalStorage so mobile/tablet refresh never loses work
  useEffect(() => {
    const totalEntities = points.length + lines.length + polylines.length + polygons.length + texts.length;
    // Skip saving massive imported datasets to browser localStorage (5MB browser limit)
    if (totalEntities > 4000) return;

    const timeout = setTimeout(() => {
      const state: ProjectState = {
        version: '1.0.0',
        name: 'AutoSaved',
        crs,
        isSwappedXY,
        layers,
        points,
        lines,
        polylines,
        polygons,
        texts
      };
      try {
        localStorage.setItem('webcad_project_state', JSON.stringify(state));
      } catch (err) {
        console.warn('LocalStorage save error:', err);
      }
    }, 1500);
    return () => clearTimeout(timeout);
  }, [crs, isSwappedXY, layers, points, lines, polylines, polygons, texts]);

  // Finish active drawing
  const handleFinishDrawing = () => {
    if (activePoints.length >= 2) {
      if (tool === 'polyline') {
        const newPl: CADPolyline = {
          id: `pl-${Date.now()}`,
          name: `연속선_${polylines.length + 1}`,
          points: activePoints,
          isClosed: false,
          layerId: activeLayerId
        };
        setPolylines(prev => [...prev, newPl]);
        pushHistory('연속선 생성');
      } else if (tool === 'polygon' && activePoints.length >= 3) {
        const newPoly: CADPolygon = {
          id: `poly-${Date.now()}`,
          name: `구역_${polygons.length + 1}`,
          points: activePoints,
          layerId: activeLayerId
        };
        setPolygons(prev => [...prev, newPoly]);
        pushHistory('면적 폴리곤 생성');
      }
    }
    setActivePoints([]);
  };

  const handleCancelDrawing = () => {
    setActivePoints([]);
  };

  // Add Point
  const handleAddPoint = (point: CADPoint) => {
    setPoints(prev => [...prev, point]);
    pushHistory('측점 추가');
  };

  // Add Line
  const handleAddLine = (line: CADLine) => {
    setLines(prev => [...prev, line]);
    pushHistory('단일선 추가');
  };

  // Add Polyline
  const handleAddPolyline = (polyline: CADPolyline) => {
    setPolylines(prev => [...prev, polyline]);
    pushHistory('연속선 추가');
  };

  // Add Polygon
  const handleAddPolygon = (polygon: CADPolygon) => {
    setPolygons(prev => [...prev, polygon]);
    pushHistory('폴리곤 추가');
  };

  // Delete selected entity
  const handleDeleteSelected = () => {
    if (!selectedEntityId) return;
    setPoints(pts => pts.filter(p => p.id !== selectedEntityId));
    setLines(ls => ls.filter(l => l.id !== selectedEntityId));
    setPolylines(pls => pls.filter(p => p.id !== selectedEntityId));
    setPolygons(pgs => pgs.filter(p => p.id !== selectedEntityId));
    setTexts(txts => txts.filter(t => t.id !== selectedEntityId));
    setSelectedEntityId(null);
    pushHistory('객체 삭제');
  };

  // Delete specific point
  const handleDeletePoint = (id: string) => {
    setPoints(pts => pts.filter(p => p.id !== id));
    pushHistory('측점 삭제');
  };

  // Clear all points
  const handleClearAllPoints = () => {
    setPoints([]);
    pushHistory('모든 측점 삭제');
  };

  // Focus on specific point
  const handleFocusPoint = (pt: CADPoint) => {
    setSelectedEntityId(pt.id);
  };

  // Toggle X/Y Coordinate Swap across entire project
  const handleToggleSwapXY = () => {
    // Invert X and Y coordinates for all entities
    setPoints(pts => pts.map(p => ({ ...p, x: p.y, y: p.x })));
    setLines(ls => ls.map(l => ({
      ...l,
      start: { ...l.start, x: l.start.y, y: l.start.x },
      end: { ...l.end, x: l.end.y, y: l.end.x }
    })));
    setPolylines(pls => pls.map(pl => ({
      ...pl,
      points: pl.points.map(p => ({ ...p, x: p.y, y: p.x }))
    })));
    setPolygons(pgs => pgs.map(pg => ({
      ...pg,
      points: pg.points.map(p => ({ ...p, x: p.y, y: p.x }))
    })));
    setTexts(txts => txts.map(t => ({ ...t, x: t.y, y: t.x })));

    setIsSwappedXY(prev => !prev);
    setZoomExtentsTrigger(Date.now());
    pushHistory('X/Y 좌표축 반전');
  };

  // Import CSV Points
  const handleImportCSVPoints = (newPoints: CADPoint[], append: boolean) => {
    if (append) {
      setPoints(prev => [...prev, ...newPoints]);
    } else {
      setPoints(newPoints);
      setLines([]);
      setPolylines([]);
      setPolygons([]);
      setTexts([]);
    }
    setZoomExtentsTrigger(Date.now());
    pushHistory('CSV 측점 불러오기');
  };

  // Import DXF Data
  const handleImportDXF = (data: {
    layers: CADLayer[];
    points: CADPoint[];
    lines: CADLine[];
    polylines: CADPolyline[];
    polygons: CADPolygon[];
    texts: CADText[];
  }, append: boolean) => {
    if (append) {
      // Merge unique layers
      const existingLayerNames = new Set(layers.map(l => l.name));
      const newLayersToAdd = data.layers.filter(l => !existingLayerNames.has(l.name));
      setLayers(prev => [...prev, ...newLayersToAdd]);

      setPoints(prev => [...prev, ...data.points]);
      setLines(prev => [...prev, ...data.lines]);
      setPolylines(prev => [...prev, ...data.polylines]);
      setPolygons(prev => [...prev, ...data.polygons]);
      setTexts(prev => [...prev, ...data.texts]);
    } else {
      setLayers(data.layers.length > 0 ? data.layers : DEFAULT_LAYERS);
      setPoints(data.points);
      setLines(data.lines);
      setPolylines(data.polylines);
      setPolygons(data.polygons);
      setTexts(data.texts);
    }
    setZoomExtentsTrigger(Date.now());
    pushHistory('DXF 도면 불러오기');
  };

  // Load Saved Project State
  const handleLoadProject = (state: ProjectState) => {
    setCrs(state.crs || 'EPSG:5186');
    setIsSwappedXY(state.isSwappedXY !== undefined ? state.isSwappedXY : true);
    setLayers(state.layers || DEFAULT_LAYERS);
    setPoints(state.points || []);
    setLines(state.lines || []);
    setPolylines(state.polylines || []);
    setPolygons(state.polygons || []);
    setTexts(state.texts || []);
    setZoomExtentsTrigger(Date.now());
    pushHistory('프로젝트 복원');
  };

  // Layer Operations
  const handleToggleLayerVisible = (id: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  };

  const handleToggleLayerLock = (id: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, locked: !l.locked } : l));
  };

  const handleChangeLayerColor = (id: string, color: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, color } : l));
  };

  const handleAddLayer = (name: string, color: string) => {
    const newL: CADLayer = {
      id: `layer-${Date.now()}`,
      name,
      color,
      visible: true,
      locked: false,
      lineWidth: 2
    };
    setLayers(prev => [...prev, newL]);
    setActiveLayerId(newL.id);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-slate-950 font-sans">
      {/* Offline Status Field Banner */}
      <OfflineIndicator />

      {/* Top Header & Coordinate Bar */}
      <CoordinateBar
        crs={crs}
        onChangeCRS={setCrs}
        isSwappedXY={isSwappedXY}
        onToggleSwapXY={handleToggleSwapXY}
        cursorWorld={cursorWorld}
        activeSnap={activeSnap}
        pointsCount={points.length}
        linesCount={lines.length + polylines.length}
        liveMeasurement={liveMeasurement}
        onOpenImport={() => setShowImportModal(true)}
        onOpenExport={() => setShowExportModal(true)}
        onOpenTable={() => setShowTableModal(true)}
        onToggleLayerPanel={() => setShowLayerPanel(prev => !prev)}
        onOpenHelp={() => setShowHelpModal(true)}
      />

      {/* Main Interactive CAD Viewport */}
      <main className="relative flex-1 w-full h-full overflow-hidden">
        <CADCanvas
          tool={tool}
          ortho={ortho}
          snapEnabled={snapEnabled}
          layers={layers}
          points={points}
          lines={lines}
          polylines={polylines}
          polygons={polygons}
          texts={texts}
          activeLayerId={activeLayerId}
          selectedEntityId={selectedEntityId}
          onSelectEntity={setSelectedEntityId}
          onAddPoint={handleAddPoint}
          onAddLine={handleAddLine}
          onAddPolyline={handleAddPolyline}
          onAddPolygon={handleAddPolygon}
          onCursorMove={(world, snap) => {
            setCursorWorld(world);
            setActiveSnap(snap);
          }}
          onLiveMeasurementChange={setLiveMeasurement}
          activePoints={activePoints}
          setActivePoints={setActivePoints}
          zoomExtentsTrigger={zoomExtentsTrigger}
        />

        {/* Floating Toolbar & Drawing Action Controls */}
        <Toolbar
          tool={tool}
          setTool={setTool}
          ortho={ortho}
          setOrtho={setOrtho}
          snapEnabled={snapEnabled}
          setSnapEnabled={setSnapEnabled}
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onZoomExtents={() => setZoomExtentsTrigger(Date.now())}
          activePointsCount={activePoints.length}
          onFinishDrawing={handleFinishDrawing}
          onCancelDrawing={handleCancelDrawing}
        />

        {/* Layer Management Drawer / Panel */}
        {showLayerPanel && (
          <LayerPanel
            layers={layers}
            activeLayerId={activeLayerId}
            onSetActiveLayerId={setActiveLayerId}
            onToggleVisible={handleToggleLayerVisible}
            onToggleLock={handleToggleLayerLock}
            onChangeColor={handleChangeLayerColor}
            onAddLayer={handleAddLayer}
            onClose={() => setShowLayerPanel(false)}
          />
        )}
      </main>

      {/* Modals */}
      {showImportModal && (
        <ImportModal
          onImportCSVPoints={handleImportCSVPoints}
          onImportDXF={handleImportDXF}
          onLoadProject={handleLoadProject}
          onClose={() => setShowImportModal(false)}
        />
      )}

      {showExportModal && (
        <ExportModal
          layers={layers}
          points={points}
          lines={lines}
          polylines={polylines}
          polygons={polygons}
          texts={texts}
          crs={crs}
          isSwappedXY={isSwappedXY}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showTableModal && (
        <PointTableModal
          points={points}
          onDeletePoint={handleDeletePoint}
          onClearAllPoints={handleClearAllPoints}
          onFocusPoint={handleFocusPoint}
          onClose={() => setShowTableModal(false)}
        />
      )}

      {showHelpModal && (
        <HelpModal onClose={() => setShowHelpModal(false)} />
      )}
    </div>
  );
}
