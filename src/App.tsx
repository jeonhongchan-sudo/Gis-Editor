/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Focus, Trash2, Ruler, X, Check, Layers, CheckSquare, Database } from 'lucide-react';
import { distance2D } from './utils/geometry';
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
  ToolMode,
  UnifiedCADData 
} from './types/cad';
import { CADCanvas } from './components/CADCanvas';
import { Toolbar } from './components/Toolbar';
import { CoordinateBar } from './components/CoordinateBar';
import { LayerPanel } from './components/LayerPanel';
import { PointTableModal } from './components/PointTableModal';
import { AttributeEditorModal, EntityType } from './components/AttributeEditorModal';
import { ImportModal } from './components/ImportModal';
import { ExportModal } from './components/ExportModal';
import { ManualPointModal } from './components/ManualPointModal';
import { HelpModal } from './components/HelpModal';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { db } from './db/localDb.ts';
import { useLiveQuery } from 'dexie-react-hooks';
import { SHPParseResult } from './utils/shpParser';

const DEFAULT_LAYERS: CADLayer[] = [
  {
    id: 'layer-0',
    name: '0',
    color: '#38bdf8',
    visible: true,
    locked: false,
    lineWidth: 1.5
  }
];

export default function App() {
  // Local Project Persistence (Disabled as per user request: Reset on startup)
  const [currentProjectId, setCurrentProjectId] = useState<number | null>(null);

  // Theme state
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (localStorage.getItem('theme') as 'light' | 'dark') || 'dark';
  });

  // On Mount: Load last project if exists
  useEffect(() => {
    const initApp = async () => {
      const lastId = localStorage.getItem('last_project_id');
      if (lastId) {
        setCurrentProjectId(parseInt(lastId));
      } else {
        const latest = await db.projects.orderBy('updatedAt').last();
        if (latest) {
          setCurrentProjectId(latest.id!);
        }
      }
    };
    initApp();
  }, []);

  useEffect(() => {
    if (currentProjectId !== null) {
      localStorage.setItem('last_project_id', currentProjectId.toString());
    }
  }, [currentProjectId]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  // Entities & Layers (Cached for fast rendering)
  const [layers, setLayers] = useState<CADLayer[]>(DEFAULT_LAYERS);
  const [activeLayerId, setActiveLayerId] = useState<string>('layer-0');
  const [points, setPoints] = useState<CADPoint[]>([]);
  const [lines, setLines] = useState<CADLine[]>([]);
  const [polylines, setPolylines] = useState<CADPolyline[]>([]);
  const [polygons, setPolygons] = useState<CADPolygon[]>([]);
  const [texts, setTexts] = useState<CADText[]>([]);

  // Selection & Tools
  const [tool, setTool] = useState<ToolMode>('pan');
  const [snapEnabled, setSnapEnabled] = useState<boolean>(true);
  const [selectedEntityIds, setSelectedEntityIds] = useState<string[]>([]);
  const [multiSelectMode, setMultiSelectMode] = useState<boolean>(false);
  const selectedEntityId = selectedEntityIds[0] || null;
  const setSelectedEntityId = useCallback((id: string | null) => {
    setSelectedEntityIds(id ? [id] : []);
  }, []);

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
  const [showAttributeModal, setShowAttributeModal] = useState(false);
  const [attributeTargetIds, setAttributeTargetIds] = useState<string[] | undefined>(undefined);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showManualPointModal, setShowManualPointModal] = useState(false);

  // History for Undo / Redo
  const [history, setHistory] = useState<HistoryStep[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const isUndoingOrRedoing = useRef(false);

  // Load project data from IndexedDB on project change
  useEffect(() => {
    if (currentProjectId === null) return;
    
    const loadData = async () => {
      const pLayers = await db.layers.where('projectId').equals(currentProjectId).toArray();
      const pPoints = await db.points.where('projectId').equals(currentProjectId).toArray();
      const pLines = await db.lines.where('projectId').equals(currentProjectId).toArray();
      const pPolylines = await db.polylines.where('projectId').equals(currentProjectId).toArray();
      const pPolygons = await db.polygons.where('projectId').equals(currentProjectId).toArray();
      const pTexts = await db.texts.where('projectId').equals(currentProjectId).toArray();

      if (pLayers.length > 0) {
        setLayers(pLayers);
        setActiveLayerId(prev => pLayers.some(l => l.id === prev) ? prev : pLayers[0].id);
      }
      setPoints(pPoints);
      setLines(pLines);
      setPolylines(pPolylines);
      setPolygons(pPolygons);
      setTexts(pTexts);
      
      // Delay zoom slightly to ensure state is committed
      setTimeout(() => handleZoomExtents(), 50);
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
        setSelectedEntityIds([]);
      } else if (e.key === 'Enter') {
        handleFinishDrawing();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const allIds = [
          ...points.map(p => p.id),
          ...lines.map(l => l.id),
          ...polylines.map(pl => pl.id),
          ...polygons.map(pg => pg.id),
          ...texts.map(t => t.id)
        ];
        setSelectedEntityIds(allIds);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedEntityIds.length > 0) handleDeleteSelected();
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
  }, [handleUndo, handleRedo, handleZoomExtents, selectedEntityIds, activePoints, points, lines, polylines, polygons, texts]);

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
    if (selectedEntityIds.length === 0 || currentProjectId === null) return;
    const idSet = new Set(selectedEntityIds);
    
    // UI state removal
    setPoints(pts => pts.filter(p => !idSet.has(p.id)));
    setLines(ls => ls.filter(l => !idSet.has(l.id)));
    setPolylines(pls => pls.filter(p => !idSet.has(p.id)));
    setPolygons(pgs => pgs.filter(p => !idSet.has(p.id)));
    setTexts(txts => txts.filter(t => !idSet.has(t.id)));
    
    // DB removal
    await Promise.all([
      db.points.where('id').anyOf(selectedEntityIds as any).delete(),
      db.lines.where('id').anyOf(selectedEntityIds as any).delete(),
      db.polylines.where('id').anyOf(selectedEntityIds as any).delete(),
      db.polygons.where('id').anyOf(selectedEntityIds as any).delete(),
      db.texts.where('id').anyOf(selectedEntityIds as any).delete(),
    ]);

    setSelectedEntityIds([]);
    pushHistory(`선택 객체 ${selectedEntityIds.length}개 삭제`);
  };

  const handleBatchChangeLayer = async (targetLayerId: string) => {
    if (!targetLayerId || selectedEntityIds.length === 0 || currentProjectId === null) return;
    const idSet = new Set(selectedEntityIds);

    setPoints(prev => prev.map(p => idSet.has(p.id) ? { ...p, layerId: targetLayerId } : p));
    setLines(prev => prev.map(l => idSet.has(l.id) ? { ...l, layerId: targetLayerId } : l));
    setPolylines(prev => prev.map(pl => idSet.has(pl.id) ? { ...pl, layerId: targetLayerId } : pl));
    setPolygons(prev => prev.map(pg => idSet.has(pg.id) ? { ...pg, layerId: targetLayerId } : pg));
    setTexts(prev => prev.map(t => idSet.has(t.id) ? { ...t, layerId: targetLayerId } : t));

    const ptsToUpdate = points.filter(p => idSet.has(p.id)).map(p => ({ ...p, layerId: targetLayerId, projectId: currentProjectId }));
    const linesToUpdate = lines.filter(l => idSet.has(l.id)).map(l => ({ ...l, layerId: targetLayerId, projectId: currentProjectId }));
    const plsToUpdate = polylines.filter(pl => idSet.has(pl.id)).map(pl => ({ ...pl, layerId: targetLayerId, projectId: currentProjectId }));
    const pgsToUpdate = polygons.filter(pg => idSet.has(pg.id)).map(pg => ({ ...pg, layerId: targetLayerId, projectId: currentProjectId }));
    const txtsToUpdate = texts.filter(t => idSet.has(t.id)).map(t => ({ ...t, layerId: targetLayerId, projectId: currentProjectId }));

    await Promise.all([
      ptsToUpdate.length > 0 ? db.points.bulkPut(ptsToUpdate) : Promise.resolve(),
      linesToUpdate.length > 0 ? db.lines.bulkPut(linesToUpdate) : Promise.resolve(),
      plsToUpdate.length > 0 ? db.polylines.bulkPut(plsToUpdate) : Promise.resolve(),
      pgsToUpdate.length > 0 ? db.polygons.bulkPut(pgsToUpdate) : Promise.resolve(),
      txtsToUpdate.length > 0 ? db.texts.bulkPut(txtsToUpdate) : Promise.resolve(),
    ]);

    pushHistory(`선택 객체 ${selectedEntityIds.length}개 레이어 일괄 변경`);
  };

  const handleUpdateEntityAttributes = async (updates: { id: string; type: EntityType; name?: string; attributes: Record<string, string | number> }[]) => {
    if (updates.length === 0) return;
    const updateMap = new Map(updates.map(u => [u.id, u]));

    // 1. Update UI State
    setPoints(prev => prev.map(p => {
      const u = updateMap.get(p.id);
      return (u && u.type === 'point') ? { ...p, name: u.name || p.name, attributes: u.attributes } : p;
    }));
    setLines(prev => prev.map(l => {
      const u = updateMap.get(l.id);
      return (u && u.type === 'line') ? { ...l, name: u.name || l.name, attributes: u.attributes } : l;
    }));
    setPolylines(prev => prev.map(pl => {
      const u = updateMap.get(pl.id);
      return (u && u.type === 'polyline') ? { ...pl, name: u.name || pl.name, attributes: u.attributes } : pl;
    }));
    setPolygons(prev => prev.map(pg => {
      const u = updateMap.get(pg.id);
      return (u && u.type === 'polygon') ? { ...pg, name: u.name || pg.name, attributes: u.attributes } : pg;
    }));
    setTexts(prev => prev.map(t => {
      const u = updateMap.get(t.id);
      return (u && u.type === 'text') ? { ...t, text: u.name || t.text, attributes: u.attributes } : t;
    }));

    // 2. Persist to DB
    if (currentProjectId !== null) {
      const dbUpdates: Promise<any>[] = [];
      
      updates.forEach(u => {
        let collection: any;
        switch (u.type) {
          case 'point': collection = db.points; break;
          case 'line': collection = db.lines; break;
          case 'polyline': collection = db.polylines; break;
          case 'polygon': collection = db.polygons; break;
          case 'text': collection = db.texts; break;
        }
        
        if (collection) {
          const updateObj: any = { attributes: u.attributes, projectId: currentProjectId };
          if (u.name) {
            if (u.type === 'text') updateObj.text = u.name;
            else updateObj.name = u.name;
          }
          dbUpdates.push(collection.where('id').equals(u.id).modify(updateObj));
        }
      });

      await Promise.all(dbUpdates);
    }

    pushHistory(`객체 속성(OD) ${updates.length}개 수정`);
  };

  const handleCreateSampleData = async () => {
    // 1. Ensure project exists
    let pid = currentProjectId;
    if (pid === null) {
      pid = await db.projects.add({ name: '샘플 현장 데이터', createdAt: Date.now(), updatedAt: Date.now() });
      setCurrentProjectId(pid);
      for (const l of layers) {
        await db.layers.add({ ...l, projectId: pid });
      }
    }

    // 2. Sample Manhole (Point)
    const manhole: CADPoint = {
      id: `sample-pt-${Date.now()}-1`,
      name: '맨홀_MH01',
      x: 100, y: 100, z: 15.5,
      layerId: activeLayerId,
      isSurveyNode: true,
      attributes: {
        '시설종류': '맨홀',
        '규격': 'D600',
        '재질': '철근콘크리트',
        '심도': '1.5',
        '상태': '양호',
        '비고': '샘플 데이터'
      }
    };

    // 3. Sample Utility Pole (Point)
    const pole: CADPoint = {
      id: `sample-pt-${Date.now()}-2`,
      name: '전주_P12',
      x: 120, y: 110,
      layerId: activeLayerId,
      isSurveyNode: true,
      attributes: {
        '시설종류': '전주',
        '규격': '12m',
        '재질': '콘크리트',
        '상태': '보통',
        '비고': '샘플 전주'
      }
    };

    // 4. Sample Pipeline (Line)
    const pipeline: CADLine = {
      id: `sample-ln-${Date.now()}`,
      name: '상수관로_L01',
      start: { x: 100, y: 100 },
      end: { x: 120, y: 110 },
      layerId: activeLayerId,
      attributes: {
        '시설구분': '상수관',
        '규격': 'D100',
        '재질': 'PE',
        '매설심도': '1.2',
        '상태': '양호'
      }
    };

    setPoints(prev => [...prev, manhole, pole]);
    setLines(prev => [...prev, pipeline]);

    await Promise.all([
      db.points.bulkPut([{ ...manhole, projectId: pid! }, { ...pole, projectId: pid! }]),
      db.lines.add({ ...pipeline, projectId: pid! })
    ]);

    handleZoomExtents([manhole, pole]);
    pushHistory('샘플 데이터 생성');
    alert('맨홀, 전주, 관로 샘플 데이터가 생성되었습니다.');
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

  /**
   * Centralized Import Logic: Unified Data Management for DXF, SHP, CSV, GeoJSON
   * This ensures all sources are stored in the same IndexedDB schema and state.
   */
  const handleImportUnifiedData = async (data: UnifiedCADData, append: boolean) => {
    let pid = currentProjectId;
    const isNewProject = pid === null;
    if (isNewProject) {
      pid = await db.projects.add({ 
        name: data.layerName || '현장 프로젝트', 
        createdAt: Date.now(), 
        updatedAt: Date.now() 
      });
    }

    const incomingLayers = data.layers && data.layers.length > 0 ? data.layers : [
      {
        id: `layer-0`,
        name: '0',
        color: '#38bdf8',
        visible: true,
        locked: false,
        lineWidth: 2
      }
    ];

    let finalPoints = data.points;
    let finalLines = data.lines;
    let finalPolylines = data.polylines;
    let finalPolygons = data.polygons;
    let finalTexts = data.texts || [];
    let finalLayers = incomingLayers;

    if (!append) {
      // 1. Clean DB for current project BEFORE state update
      if (!isNewProject) {
        await Promise.all([
          db.layers.where('projectId').equals(pid!).delete(),
          db.points.where('projectId').equals(pid!).delete(),
          db.lines.where('projectId').equals(pid!).delete(),
          db.polylines.where('projectId').equals(pid!).delete(),
          db.polygons.where('projectId').equals(pid!).delete(),
          db.texts.where('projectId').equals(pid!).delete()
        ]);
      }

      // 2. Clear current UI state
      setSelectedEntityIds([]); 
      setMultiSelectMode(false);
      setActivePoints([]); 
      
      setLayers(incomingLayers);
      setActiveLayerId(incomingLayers[0].id);
      setPoints(data.points);
      setLines(data.lines);
      setPolylines(data.polylines);
      setPolygons(data.polygons);
      setTexts(data.texts || []);
    } else {
      // 3. Robust Append/Merge Logic
      const idMap = new Map<string, string>();
      const existingLayersByName = new Map(layers.map(l => [l.name.trim(), l]));
      const layersToAppend: CADLayer[] = [];

      incomingLayers.forEach((newLayer: CADLayer) => {
        const nameKey = newLayer.name.trim();
        const existing = existingLayersByName.get(nameKey);
        if (existing) {
          idMap.set(newLayer.id, existing.id);
        } else {
          layersToAppend.push(newLayer);
          idMap.set(newLayer.id, newLayer.id);
        }
      });

      const remap = <T extends { layerId: string }>(items: T[]): T[] => 
        items.map(item => ({ ...item, layerId: idMap.get(item.layerId) || item.layerId }));

      finalPoints = remap(data.points);
      finalLines = remap(data.lines);
      finalPolylines = remap(data.polylines);
      finalPolygons = remap(data.polygons);
      finalTexts = remap(data.texts || []);
      finalLayers = layersToAppend;

      setLayers(prev => {
        const existingIds = new Set(prev.map(l => l.id));
        return [...prev, ...layersToAppend.filter(l => !existingIds.has(l.id))];
      });

      const dedupe = <T extends { id: string }>(prev: T[], next: T[]): T[] => {
        const idSet = new Set(prev.map(i => i.id));
        return [...prev, ...next.filter(i => !idSet.has(i.id))];
      };

      setPoints(prev => dedupe(prev, finalPoints));
      setLines(prev => dedupe(prev, finalLines));
      setPolylines(prev => dedupe(prev, finalPolylines));
      setPolygons(prev => dedupe(prev, finalPolygons));
      setTexts(prev => dedupe(prev, finalTexts));
    }

    // 4. Atomic Database Transaction
    await Promise.all([
      finalLayers.length > 0 ? db.layers.bulkPut(finalLayers.map((l: CADLayer) => ({ ...l, projectId: pid! }))) : Promise.resolve(),
      db.points.bulkPut(finalPoints.map((p: CADPoint) => ({ ...p, projectId: pid! }))),
      db.lines.bulkPut(finalLines.map((l: CADLine) => ({ ...l, projectId: pid! }))),
      db.polylines.bulkPut(finalPolylines.map((pl: CADPolyline) => ({ ...pl, projectId: pid! }))),
      db.polygons.bulkPut(finalPolygons.map((pg: CADPolygon) => ({ ...pg, projectId: pid! }))),
      finalTexts.length > 0 ? db.texts.bulkPut(finalTexts.map((t: CADText) => ({ ...t, projectId: pid! }))) : Promise.resolve()
    ]);

    if (isNewProject) {
      setCurrentProjectId(pid!);
    }

    handleZoomExtents(finalPoints);
    pushHistory(`${data.layerName || '데이터'} 불러오기`);
  };

  const handleImportCSVPoints = async (newPoints: CADPoint[], append: boolean) => {
    await handleImportUnifiedData({
      points: newPoints,
      lines: [],
      polylines: [],
      polygons: [],
      texts: [],
      layers: [],
      layerName: 'CSV 데이터'
    }, append);
  };

  const handleImportSHP = async (data: UnifiedCADData, append: boolean) => {
    await handleImportUnifiedData(data, append);
  };

  const selPointsCount = points.filter(p => selectedEntityIds.includes(p.id)).length;
  const selLinesCount = lines.filter(l => selectedEntityIds.includes(l.id)).length + polylines.filter(pl => selectedEntityIds.includes(pl.id)).length;
  const selPolygonsCount = polygons.filter(pg => selectedEntityIds.includes(pg.id)).length;
  const selTextsCount = texts.filter(t => selectedEntityIds.includes(t.id)).length;

  const measureSegments = useMemo(() => {
    if (tool !== 'measure' || activePoints.length < 2) return [];
    const segs: { index: number; dist: number }[] = [];
    for (let i = 0; i < activePoints.length - 1; i++) {
      segs.push({
        index: i + 1,
        dist: distance2D(activePoints[i], activePoints[i + 1])
      });
    }
    return segs;
  }, [tool, activePoints]);

  const measureCumulative = useMemo(() => {
    return measureSegments.reduce((sum: number, s: { index: number; dist: number }) => sum + s.dist, 0);
  }, [measureSegments]);

  return (
    <div className="relative w-screen h-screen overflow-hidden flex flex-col bg-slate-950 font-sans">
      <OfflineIndicator />
      
      <CoordinateBar
        theme={theme}
        setTheme={setTheme}
        cursorWorld={cursorWorld}
        activeSnap={activeSnap}
        pointsCount={points.length}
        linesCount={lines.length + polylines.length}
        liveMeasurement={liveMeasurement}
        onOpenImport={() => setShowImportModal(true)}
        onOpenExport={() => setShowExportModal(true)}
        onOpenTable={() => setShowTableModal(true)}
        onOpenAttributeEditor={() => { setAttributeTargetIds(undefined); setShowAttributeModal(true); }}
        onToggleLayerPanel={() => setShowLayerPanel(prev => !prev)}
        onOpenHelp={() => setShowHelpModal(true)}
        onOpenManualPoint={() => setShowManualPointModal(true)}
      />

      <main className="relative flex-1 w-full h-full overflow-hidden bg-slate-50 dark:bg-slate-950">
        <CADCanvas
          theme={theme}
          tool={tool} snapEnabled={snapEnabled}
          layers={layers} points={points} lines={lines} polylines={polylines} polygons={polygons} texts={texts}
          activeLayerId={activeLayerId} 
          selectedEntityId={selectedEntityId}
          selectedEntityIds={selectedEntityIds}
          multiSelectMode={multiSelectMode}
          onSelectEntity={setSelectedEntityId}
          onSelectEntities={setSelectedEntityIds}
          onAddPoint={handleAddPoint}
          onAddLine={handleAddLine} onAddPolyline={handleAddPolyline} onAddPolygon={handleAddPolygon}
          onCursorMove={(world, snap) => { setCursorWorld(world); setActiveSnap(snap); }}
          onLiveMeasurementChange={setLiveMeasurement}
          activePoints={activePoints} setActivePoints={setActivePoints}
          zoomExtentsTrigger={zoomExtentsTrigger}
        />

        {/* Floating Multi-Select Action Bar (레이어 일괄 변경 & 일괄 삭제) */}
        {selectedEntityIds.length > 0 && (
          <div className="fixed top-16 sm:top-20 left-1/2 -translate-x-1/2 z-30 flex flex-wrap items-center justify-center gap-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-amber-400 dark:border-amber-500/80 px-3.5 py-2 sm:px-4 sm:py-2 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-top-3 duration-150 max-w-[95vw]">
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400 font-semibold shrink-0">
              <span className="w-2 h-2 rounded-full bg-amber-500 dark:bg-amber-400 animate-ping" />
              <span>선택 {selectedEntityIds.length}개</span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 font-normal hidden sm:inline">
                (점 {selPointsCount}, 선 {selLinesCount}, 면 {selPolygonsCount}, 텍스트 {selTextsCount})
              </span>
            </div>

            {/* Mobile / Desktop Multi-Select Append Mode Toggle */}
            <button
              onClick={() => setMultiSelectMode(prev => !prev)}
              title="누적 선택 모드"
              className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium transition ${
                multiSelectMode
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-amber-500/30'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              <span>{multiSelectMode ? '누적추가 ON' : '+ 추가선택'}</span>
            </button>

            {/* Generic Attribute Editor button when any entity is selected */}
            <button
              onClick={() => {
                setAttributeTargetIds(selectedEntityIds);
                setShowAttributeModal(true);
              }}
              title="선택된 객체의 데이터(OD) 속성 입력 및 편집"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-sky-50 dark:bg-sky-950/80 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-600 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-xs font-semibold transition"
            >
              <Database className="w-3.5 h-3.5 text-sky-500" />
              <span>객체 속성 (OD)</span>
            </button>

            {/* Layer batch change selector */}
            <div className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950/80 border border-slate-200 dark:border-slate-700/80 rounded-xl px-2 py-1">
              <Layers className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <select
                onChange={(e) => {
                  if (e.target.value) {
                    handleBatchChangeLayer(e.target.value);
                    e.target.value = '';
                  }
                }}
                defaultValue=""
                className="bg-transparent text-sky-400 text-xs outline-none cursor-pointer pr-1 font-medium"
              >
                <option value="" disabled className="bg-white dark:bg-slate-900 text-slate-400">레이어 일괄 변경...</option>
                {layers.map(l => (
                  <option key={l.id} value={l.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-200">
                    {l.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Delete button */}
            <button
              onClick={handleDeleteSelected}
              title="선택된 객체 일괄 삭제"
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-red-50 dark:bg-red-950/80 hover:bg-red-100 dark:hover:bg-red-900 text-red-600 dark:text-red-300 border border-red-200 dark:border-red-800 hover:border-red-300 dark:hover:border-red-700 text-xs font-medium transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>삭제</span>
            </button>

            {/* Select all button */}
            <button
              onClick={() => {
                const allIds = [
                  ...points.map(p => p.id),
                  ...lines.map(l => l.id),
                  ...polylines.map(pl => pl.id),
                  ...polygons.map(pg => pg.id),
                  ...texts.map(t => t.id)
                ];
                setSelectedEntityIds(allIds);
              }}
              title="모든 객체 전체 선택 (Ctrl+A)"
              className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition"
            >
              전체선택
            </button>

            {/* Deselect button */}
            <button
              onClick={() => setSelectedEntityIds([])}
              title="선택 해제 (Esc)"
              className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Single Entity Property Inspector Overlay (NEW: Quick visibility for OD attributes) */}
        {selectedEntityIds.length === 1 && (
          <div className="fixed bottom-24 right-4 z-30 w-72 max-h-[50vh] bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-sky-400 dark:border-sky-500/60 rounded-2xl shadow-2xl p-4 flex flex-col gap-3 animate-in fade-in slide-in-from-right-4 duration-300 overflow-hidden">
            {(() => {
              const sid = selectedEntityIds[0];
              const ent = points.find(p => p.id === sid) || lines.find(l => l.id === sid) || polylines.find(pl => pl.id === sid) || polygons.find(pg => pg.id === sid) || texts.find(t => t.id === sid);
              if (!ent) return null;

              const attrs = ent.attributes || {};
              const attrKeys = Object.keys(attrs);

              return (
                <>
                  <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600 dark:text-sky-400">
                        <Focus className="w-4 h-4" />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[13px] font-bold text-slate-900 dark:text-white truncate max-w-[160px]">
                          {(ent as any).name || (ent as any).text || '선택된 객체'}
                        </span>
                        <span className="text-[10px] text-slate-400 font-medium">레이어: {layers.find(l => l.id === ent.layerId)?.name || '-'}</span>
                      </div>
                    </div>
                    <button 
                      onClick={() => setSelectedEntityIds([])}
                      className="p-1 text-slate-300 hover:text-slate-600 dark:hover:text-white transition"
                    ><X className="w-4 h-4" /></button>
                  </div>

                  <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2.5">
                    {attrKeys.length === 0 ? (
                      <div className="py-4 text-center">
                        <p className="text-[11px] text-slate-400 italic">설정된 속성이 없습니다.</p>
                        <button 
                          onClick={() => setShowAttributeModal(true)}
                          className="mt-2 text-[10px] font-bold text-sky-600 dark:text-sky-400 hover:underline"
                        >속성 추가하기</button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {attrKeys.map(k => (
                          <div key={k} className="flex flex-col gap-0.5 bg-slate-50 dark:bg-slate-950/50 p-2 rounded-xl border border-slate-100 dark:border-slate-800/80">
                            <span className="text-[9px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-tighter">{k}</span>
                            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">{String(attrs[k])}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => {
                      setAttributeTargetIds([ent.id]);
                      setShowAttributeModal(true);
                    }}
                    className="w-full py-2 bg-sky-50 dark:bg-sky-900/40 hover:bg-sky-100 dark:hover:bg-sky-900 text-sky-600 dark:text-sky-300 border border-sky-200 dark:border-sky-800 text-[11px] font-bold rounded-xl transition flex items-center justify-center gap-1.5"
                  >
                    <Database className="w-3.5 h-3.5" />
                    <span>속성 편집 (OD Edit)</span>
                  </button>
                </>
              );
            })()}
          </div>
        )}



        {/* Floating Multi-Point Distance Measurement Panel (여러 점간 누적 거리 합산) */}
        {tool === 'measure' && activePoints.length >= 1 && (
          <div className="fixed top-16 right-2 sm:top-20 sm:right-4 z-30 w-72 sm:w-80 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-cyan-400 dark:border-cyan-500/80 rounded-2xl shadow-2xl p-3 sm:p-3.5 flex flex-col gap-2 animate-in fade-in slide-in-from-right-3 duration-200">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
              <div className="flex items-center gap-1.5">
                <Ruler className="w-4 h-4 text-cyan-600 dark:text-cyan-400" />
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">거리 및 점간 누적 측정</h3>
              </div>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-50 dark:bg-cyan-950 text-cyan-700 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800 font-mono">
                {activePoints.length}개 지점
              </span>
            </div>

            {/* Total Cumulative Sum Card */}
            <div className="bg-slate-50 dark:bg-slate-950/90 rounded-xl p-2.5 border border-slate-200 dark:border-slate-800/90 flex flex-col">
              <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">총 누적 거리 합계 (Total)</span>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-2xl font-bold font-mono text-cyan-600 dark:text-cyan-400">
                  {measureCumulative.toFixed(3)}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 font-sans">m</span>
                {liveMeasurement.currentSegment > 0 && (
                  <span className="ml-auto text-[11px] font-mono text-cyan-600/80 dark:text-cyan-300/80">
                    (+{liveMeasurement.currentSegment.toFixed(3)}m)
                  </span>
                )}
              </div>
            </div>

            {/* Segments List */}
            {measureSegments.length > 0 && (
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto pr-1">
                <span className="text-[10px] text-slate-500 font-medium">구간별 거리 상세</span>
                {measureSegments.map((seg: { index: number; dist: number }) => (
                  <div key={seg.index} className="flex items-center justify-between py-1 px-2 rounded-lg bg-white dark:bg-slate-800/50 border border-slate-100 dark:border-transparent text-[11px]">
                    <span className="text-slate-500 dark:text-slate-400">P{seg.index} → P{seg.index + 1}</span>
                    <span className="font-mono text-slate-900 dark:text-slate-200 font-semibold">{seg.dist.toFixed(3)} m</span>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => setActivePoints(prev => prev.slice(0, -1))}
                disabled={activePoints.length === 0}
                className="flex-1 py-1.5 px-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium transition text-center border border-slate-200 dark:border-transparent"
              >
                마지막 점 취소
              </button>
              <button
                onClick={() => setActivePoints([])}
                className="py-1.5 px-3 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-300 text-xs font-medium transition border border-slate-200 dark:border-transparent"
              >
                초기화
              </button>
            </div>
          </div>
        )}

        <Toolbar
          tool={tool} setTool={setTool}
          snapEnabled={snapEnabled} setSnapEnabled={setSnapEnabled}
          canUndo={historyIndex > 0} canRedo={historyIndex < history.length - 1}
          onUndo={handleUndo} onRedo={handleRedo}
          onZoomExtents={() => setZoomExtentsTrigger({ timestamp: Date.now() })}
          activePointsCount={activePoints.length}
          onFinishDrawing={handleFinishDrawing}
          onCancelDrawing={() => setActivePoints([])}
          multiSelectMode={multiSelectMode}
          setMultiSelectMode={setMultiSelectMode}
          onOpenManualPoint={() => setShowManualPointModal(true)}
        />

        <div className="absolute left-4 bottom-18">
          <PWAInstallButton />
        </div>

        {showLayerPanel && (
          <LayerPanel
            layers={layers} activeLayerId={activeLayerId}
            points={points} lines={lines} polylines={polylines}
            onSetActiveLayerId={setActiveLayerId}
            onToggleVisible={handleToggleLayerVisible}
            onToggleLock={handleToggleLayerLock}
            onChangeColor={handleChangeLayerColor}
            onRenameLayer={handleRenameLayer}
            onAddLayer={handleAddLayer}
            onDeleteLayer={handleDeleteLayer}
            onClose={() => setShowLayerPanel(false)}
          />
        )}
      </main>

      {showImportModal && (
        <ImportModal
          onImportCSVPoints={handleImportCSVPoints}
          onImportSHP={handleImportSHP}
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
          onUpdatePoint={handleUpdatePoint}
          onClearAllPoints={handleClearAllPoints}
          onFocusPoint={(pt) => setSelectedEntityId(pt.id)}
          onClose={() => setShowTableModal(false)}
        />
      )}

      {showHelpModal && <HelpModal onClose={() => setShowHelpModal(false)} onCreateSampleData={handleCreateSampleData} />}
      
      {showManualPointModal && (
        <ManualPointModal
          onAdd={(pt) => {
            handleAddPoint(pt);
            setSelectedEntityId(pt.id);
            // Optionally zoom to the new point
            handleZoomExtents([{ x: pt.x, y: pt.y }]);
          }}
          onClose={() => setShowManualPointModal(false)}
          activeLayerId={activeLayerId}
          nextPointNumber={points.length + 1}
        />
      )}

      {showAttributeModal && (
        <AttributeEditorModal
          layers={layers}
          points={points}
          lines={lines}
          polylines={polylines}
          polygons={polygons}
          texts={texts}
          targetIds={attributeTargetIds}
          activeLayerId={activeLayerId}
          onUpdateAttributes={handleUpdateEntityAttributes}
          onFocusEntity={(pts) => handleZoomExtents(pts)}
          onClose={() => setShowAttributeModal(false)}
        />
      )}
    </div>
  );

  async function handleLoadProject(state: ProjectState) {
    // 1. Create a new project entry first
    const pid = await db.projects.add({ 
      name: state.name || '가져온 프로젝트', 
      createdAt: Date.now(), 
      updatedAt: Date.now() 
    });
    
    // 2. Perform all bulk DB writes BEFORE updating state/project ID
    // This ensures that when currentProjectId changes and the useEffect triggers,
    // the data is already physically present in IndexedDB.
    const layers = state.layers || DEFAULT_LAYERS;
    const points = state.points || [];
    const lines = state.lines || [];
    const polylines = state.polylines || [];
    const polygons = state.polygons || [];
    const texts = state.texts || [];

    await Promise.all([
      db.layers.bulkPut(layers.map(l => ({ ...l, projectId: pid }))),
      db.points.bulkPut(points.map(p => ({ ...p, projectId: pid }))),
      db.lines.bulkPut(lines.map(l => ({ ...l, projectId: pid }))),
      db.polylines.bulkPut(polylines.map(p => ({ ...p, projectId: pid }))),
      db.polygons.bulkPut(polygons.map(p => ({ ...p, projectId: pid }))),
      db.texts.bulkPut(texts.map(t => ({ ...t, projectId: pid })))
    ]);

    // 3. Perform atomic UI state cleanup
    setSelectedEntityIds([]);
    setMultiSelectMode(false);
    setActivePoints([]);
    
    // Explicitly set to empty first to force React re-render of clean state
    setPoints([]);
    setLines([]);
    setPolylines([]);
    setPolygons([]);
    setTexts([]);
    setLayers(DEFAULT_LAYERS);

    // 4. Update current project ID and state with a tiny delay
    setTimeout(() => {
      setCurrentProjectId(pid);
      setLayers(layers);
      setPoints(points);
      setLines(lines);
      setPolylines(polylines);
      setPolygons(polygons);
      setTexts(texts);
      
      setTimeout(() => handleZoomExtents(points), 100);
    }, 0);

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
  async function handleDeleteLayer(id: string) {
    if (layers.length <= 1) return;
    const targetLayer = layers.find(l => l.id === id);
    const remainingLayers = layers.filter(l => l.id !== id);
    const fallbackId = remainingLayers[0].id;

    if (activeLayerId === id) {
      setActiveLayerId(fallbackId);
    }

    // Safely reassign entities on the deleted layer to the fallback layer
    setPoints(prev => prev.map(p => p.layerId === id ? { ...p, layerId: fallbackId } : p));
    setLines(prev => prev.map(l => l.layerId === id ? { ...l, layerId: fallbackId } : l));
    setPolylines(prev => prev.map(pl => pl.layerId === id ? { ...pl, layerId: fallbackId } : pl));
    setPolygons(prev => prev.map(pg => pg.layerId === id ? { ...pg, layerId: fallbackId } : pg));
    setTexts(prev => prev.map(t => t.layerId === id ? { ...t, layerId: fallbackId } : t));

    setLayers(remainingLayers);

    // Persist to IndexedDB
    try {
      await db.layers.where('id').equals(id).delete();
      if (currentProjectId !== null) {
        await Promise.all([
          db.points.where('layerId').equals(id).modify({ layerId: fallbackId }),
          db.lines.where('layerId').equals(id).modify({ layerId: fallbackId }),
          db.polylines.where('layerId').equals(id).modify({ layerId: fallbackId }),
          db.polygons.where('layerId').equals(id).modify({ layerId: fallbackId }),
          db.texts.where('layerId').equals(id).modify({ layerId: fallbackId }),
        ]);
      }
    } catch (err) {
      console.warn('DB layer delete sync:', err);
    }

    pushHistory(`레이어 삭제: ${targetLayer?.name || id}`);
  }

  async function handleRenameLayer(id: string, newName: string) {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, name: newName } : l));
    if (currentProjectId !== null) {
      await db.layers.where('id').equals(id).modify({ name: newName });
    }
  }

  async function handleUpdatePoint(id: string, updates: Partial<CADPoint>) {
    setPoints(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    if (currentProjectId !== null) {
      await db.points.where('id').equals(id).modify(updates);
    }
  }
}
