/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Focus } from 'lucide-react';
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
import { PWAInstallButton } from './components/PWAInstallButton';
import { db } from './db/localDb.ts';
import { useLiveQuery } from 'dexie-react-hooks';

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
    id: 'layer-0',
    name: '기본도면 (0)',
    color: '#ffffff',
    visible: true,
    locked: false,
    lineWidth: 1.5
  }
];

export default function App() {
  // Local Project Persistence
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(() => {
    const saved = localStorage.getItem('last_project_id');
    return saved ? parseInt(saved) : null;
  });

  // Entities & Layers (Cached for fast rendering)
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

  const [zoomExtentsTrigger, setZoomExtentsTrigger] = useState<{ timestamp: number; targetPoints?: Point2D[] } | null>(null);
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

  // Load project data from IndexedDB on project change
  useEffect(() => {
    if (currentProjectId === null) return;
    
    localStorage.setItem('last_project_id', currentProjectId.toString());

    const loadData = async () => {
      const pLayers = await db.layers.where('projectId').equals(currentProjectId).toArray();
      const pPoints = await db.points.where('projectId').equals(currentProjectId).toArray();
      const pLines = await db.lines.where('projectId').equals(currentProjectId).toArray();
      const pPolylines = await db.polylines.where('projectId').equals(currentProjectId).toArray();
      const pPolygons = await db.polygons.where('projectId').equals(currentProjectId).toArray();
      const pTexts = await db.texts.where('projectId').equals(currentProjectId).toArray();

      if (pLayers.length > 0) setLayers(pLayers);
      setPoints(pPoints);
      setLines(pLines);
      setPolylines(pPolylines);
      setPolygons(pPolygons);
      setTexts(pTexts);
      handleZoomExtents();
    };

    loadData();
  }, [currentProjectId, handleZoomExtents]);

  const pushHistory = useCallback((desc: string) => {
    if (isUndoingOrRedoing.current) return;
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
      const slice = prev.slice(Math.max(0, historyIndex - 15 + 2), historyIndex + 1);
      return [...slice, step];
    });
    setHistoryIndex(prev => Math.min(prev + 1, 15));
  }, [layers, points, lines, polylines, polygons, texts, historyIndex]);

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

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (e.key === 'Escape') {
        setActivePoints([]);
        setSelectedEntityId(null);
      } else if (e.key === 'Enter') {
        handleFinishDrawing();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEntityId) handleDeleteSelected();
      } else if (e.key.toLowerCase() === 'z') {
        lastKeySequenceRef.current = { key: 'z', time: Date.now() };
      } else if (e.key.toLowerCase() === 'e') {
        if (lastKeySequenceRef.current?.key === 'z' && Date.now() - lastKeySequenceRef.current.time < 1500) {
          e.preventDefault();
          handleZoomExtents();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleZoomExtents, selectedEntityId, activePoints]);

  const saveEntityToDb = async (type: 'points'|'lines'|'polylines'|'polygons'|'texts', data: any) => {
    if (currentProjectId === null) {
      const pid = await db.projects.add({ name: '새 프로젝트', createdAt: Date.now(), updatedAt: Date.now() });
      setCurrentProjectId(pid);
      // Save layers first
      for (const l of layers) {
        await db.layers.add({ ...l, projectId: pid });
      }
      data.projectId = pid;
    } else {
      data.projectId = currentProjectId;
    }
    await (db as any)[type].add(data);
  };

  const handleFinishDrawing = async () => {
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
        await saveEntityToDb('polylines', newPl);
        pushHistory('연속선 생성');
      } else if (tool === 'polygon' && activePoints.length >= 3) {
        const newPoly: CADPolygon = {
          id: `poly-${Date.now()}`,
          name: `구역_${polygons.length + 1}`,
          points: activePoints,
          layerId: activeLayerId
        };
        setPolygons(prev => [...prev, newPoly]);
        await saveEntityToDb('polygons', newPoly);
        pushHistory('면적 폴리곤 생성');
      }
    }
    setActivePoints([]);
  };

  const handleAddPoint = async (point: CADPoint) => {
    setPoints(prev => [...prev, point]);
    await saveEntityToDb('points', point);
    pushHistory('측점 추가');
  };

  const handleAddLine = async (line: CADLine) => {
    setLines(prev => [...prev, line]);
    await saveEntityToDb('lines', line);
    pushHistory('단일선 추가');
  };

  const handleAddPolyline = async (polyline: CADPolyline) => {
    setPolylines(prev => [...prev, polyline]);
    await saveEntityToDb('polylines', polyline);
    pushHistory('연속선 추가');
  };

  const handleAddPolygon = async (polygon: CADPolygon) => {
    setPolygons(prev => [...prev, polygon]);
    await saveEntityToDb('polygons', polygon);
    pushHistory('폴리곤 추가');
  };

  const handleDeleteSelected = async () => {
    if (!selectedEntityId || currentProjectId === null) return;
    
    // UI state removal
    setPoints(pts => pts.filter(p => p.id !== selectedEntityId));
    setLines(ls => ls.filter(l => l.id !== selectedEntityId));
    setPolylines(pls => pls.filter(p => p.id !== selectedEntityId));
    setPolygons(pgs => pgs.filter(p => p.id !== selectedEntityId));
    setTexts(txts => txts.filter(t => t.id !== selectedEntityId));
    
    // DB removal
    await Promise.all([
      db.points.where('id').equals(selectedEntityId as any).delete(),
      db.lines.where('id').equals(selectedEntityId as any).delete(),
      db.polylines.where('id').equals(selectedEntityId as any).delete(),
      db.polygons.where('id').equals(selectedEntityId as any).delete(),
      db.texts.where('id').equals(selectedEntityId as any).delete(),
    ]);

    setSelectedEntityId(null);
    pushHistory('객체 삭제');
  };

  const handleDeletePoint = async (id: string) => {
    setPoints(pts => pts.filter(p => p.id !== id));
    await db.points.where('id').equals(id as any).delete();
    pushHistory('측점 삭제');
  };

  const handleClearAllPoints = async () => {
    if (currentProjectId === null) return;
    setPoints([]);
    await db.points.where('projectId').equals(currentProjectId).delete();
    pushHistory('모든 측점 삭제');
  };

  const handleImportCSVPoints = async (newPoints: CADPoint[], append: boolean) => {
    let pid = currentProjectId;
    if (pid === null) {
      pid = await db.projects.add({ name: '현장 측량 프로젝트', createdAt: Date.now(), updatedAt: Date.now() });
      setCurrentProjectId(pid);
      for (const l of DEFAULT_LAYERS) {
        await db.layers.add({ ...l, projectId: pid });
      }
    }

    if (append) {
      setPoints(prev => [...prev, ...newPoints]);
    } else {
      setPoints(newPoints);
      setLines([]); setPolylines([]); setPolygons([]); setTexts([]);
      await Promise.all([
        db.points.where('projectId').equals(pid).delete(),
        db.lines.where('projectId').equals(pid).delete(),
        db.polylines.where('projectId').equals(pid).delete(),
        db.polygons.where('projectId').equals(pid).delete(),
        db.texts.where('projectId').equals(pid).delete()
      ]);
    }
    
    await db.points.bulkAdd(newPoints.map(p => ({ ...p, projectId: pid! })));
    handleZoomExtents();
    pushHistory('CSV 측점 불러오기');
  };

  const handleImportDXF = async (data: any, append: boolean) => {
    let pid = currentProjectId;
    if (pid === null) {
      pid = await db.projects.add({ name: 'DXF 도면 프로젝트', createdAt: Date.now(), updatedAt: Date.now() });
      setCurrentProjectId(pid);
    }

    if (!append) {
      setLayers(data.layers);
      setPoints(data.points);
      setLines(data.lines);
      setPolylines(data.polylines);
      setPolygons(data.polygons);
      setTexts(data.texts);

      // Clean DB
      await Promise.all([
        db.layers.where('projectId').equals(pid).delete(),
        db.points.where('projectId').equals(pid).delete(),
        db.lines.where('projectId').equals(pid).delete(),
        db.polylines.where('projectId').equals(pid).delete(),
        db.polygons.where('projectId').equals(pid).delete(),
        db.texts.where('projectId').equals(pid).delete()
      ]);
    } else {
      const existingLayerNames = new Set(layers.map(l => l.name));
      const newLayersToAdd = data.layers.filter((l: any) => !existingLayerNames.has(l.name));
      setLayers(prev => [...prev, ...newLayersToAdd]);
      setPoints(prev => [...prev, ...data.points]);
      setLines(prev => [...prev, ...data.lines]);
      setPolylines(prev => [...prev, ...data.polylines]);
      setPolygons(prev => [...prev, ...data.polygons]);
      setTexts(prev => [...prev, ...data.texts]);
    }

    // Bulk Add to DB
    await Promise.all([
      db.layers.bulkAdd(data.layers.map((l: any) => ({ ...l, projectId: pid! }))),
      db.points.bulkAdd(data.points.map((p: any) => ({ ...p, projectId: pid! }))),
      db.lines.bulkAdd(data.lines.map((l: any) => ({ ...l, projectId: pid! }))),
      db.polylines.bulkAdd(data.polylines.map((pl: any) => ({ ...pl, projectId: pid! }))),
      db.polygons.bulkAdd(data.polygons.map((pg: any) => ({ ...pg, projectId: pid! }))),
      db.texts.bulkAdd(data.texts.map((t: any) => ({ ...t, projectId: pid! })))
    ]);

    handleZoomExtents();
    pushHistory('DXF 도면 불러오기');
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-slate-950 font-sans">
      <OfflineIndicator />
      
      <CoordinateBar
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

      <main className="relative flex-1 w-full h-full overflow-hidden">
        <CADCanvas
          tool={tool} ortho={ortho} snapEnabled={snapEnabled}
          layers={layers} points={points} lines={lines} polylines={polylines} polygons={polygons} texts={texts}
          activeLayerId={activeLayerId} selectedEntityId={selectedEntityId}
          onSelectEntity={setSelectedEntityId} onAddPoint={handleAddPoint}
          onAddLine={handleAddLine} onAddPolyline={handleAddPolyline} onAddPolygon={handleAddPolygon}
          onCursorMove={(world, snap) => { setCursorWorld(world); setActiveSnap(snap); }}
          onLiveMeasurementChange={setLiveMeasurement}
          activePoints={activePoints} setActivePoints={setActivePoints}
          zoomExtentsTrigger={zoomExtentsTrigger}
        />

        <Toolbar
          tool={tool} setTool={setTool} ortho={ortho} setOrtho={setOrtho}
          snapEnabled={snapEnabled} setSnapEnabled={setSnapEnabled}
          canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1}
          onUndo={handleUndo} onRedo={handleRedo}
          onZoomExtents={() => setZoomExtentsTrigger({ timestamp: Date.now() })}
          activePointsCount={activePoints.length}
          onFinishDrawing={handleFinishDrawing}
          onCancelDrawing={() => setActivePoints([])}
        />

        <div className="absolute left-4 bottom-18">
          <PWAInstallButton />
        </div>

        {showLayerPanel && (
          <LayerPanel
            layers={layers} activeLayerId={activeLayerId}
            onSetActiveLayerId={setActiveLayerId}
            onToggleVisible={handleToggleLayerVisible}
            onToggleLock={handleToggleLayerLock}
            onChangeColor={handleChangeLayerColor}
            onAddLayer={handleAddLayer}
            onClose={() => setShowLayerPanel(false)}
          />
        )}
      </main>

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
          layers={layers} points={points} lines={lines} polylines={polylines} polygons={polygons} texts={texts}
          onClose={() => setShowExportModal(false)}
        />
      )}

      {showTableModal && (
        <PointTableModal
          points={points} onDeletePoint={handleDeletePoint}
          onClearAllPoints={handleClearAllPoints}
          onFocusPoint={(pt) => setSelectedEntityId(pt.id)}
          onClose={() => setShowTableModal(false)}
        />
      )}

      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} />}
    </div>
  );

  async function handleLoadProject(state: ProjectState) {
    const pid = await db.projects.add({ 
      name: state.name || '가져온 프로젝트', 
      createdAt: Date.now(), 
      updatedAt: Date.now() 
    });
    setCurrentProjectId(pid);
    
    // Convert state arrays to DB entries
    if (state.layers) await db.layers.bulkAdd(state.layers.map((l: CADLayer) => ({ ...l, projectId: pid })));
    if (state.points) await db.points.bulkAdd(state.points.map((p: CADPoint) => ({ ...p, projectId: pid })));
    if (state.lines) await db.lines.bulkAdd(state.lines.map((l: CADLine) => ({ ...l, projectId: pid })));
    if (state.polylines) await db.polylines.bulkAdd(state.polylines.map((p: CADPolyline) => ({ ...p, projectId: pid })));
    if (state.polygons) await db.polygons.bulkAdd(state.polygons.map((p: CADPolygon) => ({ ...p, projectId: pid })));
    if (state.texts) await db.texts.bulkAdd(state.texts.map((t: CADText) => ({ ...t, projectId: pid })));

    setLayers(state.layers || DEFAULT_LAYERS);
    setPoints(state.points || []);
    setLines(state.lines || []);
    setPolylines(state.polylines || []);
    setPolygons(state.polygons || []);
    setTexts(state.texts || []);
    handleZoomExtents();
    pushHistory('프로젝트 가져오기');
  }

  function handleToggleLayerVisible(id: string) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, visible: !l.visible } : l));
  }
  function handleToggleLayerLock(id: string) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, locked: !l.locked } : l));
  }
  function handleChangeLayerColor(id: string, color: string) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, color } : l));
  }
  function handleAddLayer(name: string, color: string) {
    const newL = { id: `layer-${Date.now()}`, name, color, visible: true, locked: false, lineWidth: 2 };
    setLayers(prev => [...prev, newL]);
    setActiveLayerId(newL.id);
  }
}
