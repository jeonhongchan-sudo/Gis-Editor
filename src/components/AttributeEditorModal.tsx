/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  X, 
  Database, 
  Layers, 
  Check, 
  Plus, 
  Trash2, 
  Search, 
  Download, 
  Crosshair, 
  Info, 
  Edit3,
  FileSpreadsheet,
  Tag,
  MapPin,
  Spline,
  Minus,
  Pentagon,
  Type
} from 'lucide-react';
import { CADLine, CADPolyline, CADPoint, CADPolygon, CADText, Point2D, CADLayer } from '../types/cad';
import { distance2D } from '../utils/geometry';
import { downloadTextFile } from '../utils/downloadHelper';

export type EntityType = 'point' | 'line' | 'polyline' | 'polygon' | 'text';

interface AttributeEditorModalProps {
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  targetIds?: string[];
  activeLayerId: string;
  onUpdateAttributes: (updates: { id: string; type: EntityType; name?: string; attributes: Record<string, string | number> }[]) => void;
  onFocusEntity?: (points: Point2D[]) => void;
  onClose: () => void;
}

const CATEGORY_PRESETS = [
  '맨홀', '집수정', '상수관', '하수관', '가스관', '통신관', '전력선',
  '전주', '가로등', '도로경계', '지적경계', '건물', '기타시설'
];

export const AttributeEditorModal: React.FC<AttributeEditorModalProps> = ({
  layers,
  points,
  lines,
  polylines,
  polygons,
  texts,
  targetIds,
  activeLayerId,
  onUpdateAttributes,
  onFocusEntity,
  onClose
}) => {
  // Combine all entities into a single searchable list
  const allEntitiesList = useMemo(() => {
    const list: Array<{
      id: string;
      type: EntityType;
      name: string;
      layerId: string;
      layerName: string;
      info: string; // e.g. "Length: 5.0m" or "Coord: X, Y"
      points: Point2D[];
      attributes: Record<string, string | number>;
    }> = [];

    const getLayerName = (lid: string) => layers.find(l => l.id === lid)?.name || lid.replace(/^layer-/, '');

    points.forEach(p => {
      list.push({
        id: p.id,
        type: 'point',
        name: p.name || '측점',
        layerId: p.layerId,
        layerName: getLayerName(p.layerId),
        info: `좌표: ${p.x.toFixed(3)}, ${p.y.toFixed(3)}`,
        points: [{ x: p.x, y: p.y }],
        attributes: { ...(p.attributes || {}) }
      });
    });

    lines.forEach(l => {
      const len = distance2D(l.start, l.end);
      list.push({
        id: l.id,
        type: 'line',
        name: l.name || '단일선',
        layerId: l.layerId,
        layerName: getLayerName(l.layerId),
        info: `연장: ${len.toFixed(3)}m`,
        points: [l.start, l.end],
        attributes: { ...(l.attributes || {}) }
      });
    });

    polylines.forEach(pl => {
      let len = 0;
      for (let i = 0; i < pl.points.length - 1; i++) {
        len += distance2D(pl.points[i], pl.points[i + 1]);
      }
      list.push({
        id: pl.id,
        type: 'polyline',
        name: pl.name || '연속선',
        layerId: pl.layerId,
        layerName: getLayerName(pl.layerId),
        info: `연장: ${len.toFixed(3)}m`,
        points: pl.points,
        attributes: { ...(pl.attributes || {}) }
      });
    });

    polygons.forEach(pg => {
      let area = 0;
      for (let i = 0; i < pg.points.length; i++) {
        const j = (i + 1) % pg.points.length;
        area += pg.points[i].x * pg.points[j].y - pg.points[j].x * pg.points[i].y;
      }
      area = Math.abs(area) / 2.0;
      list.push({
        id: pg.id,
        type: 'polygon',
        name: pg.name || '구역',
        layerId: pg.layerId,
        layerName: getLayerName(pg.layerId),
        info: `면적: ${area.toFixed(3)}㎡`,
        points: pg.points,
        attributes: { ...(pg.attributes || {}) }
      });
    });

    texts.forEach(t => {
      list.push({
        id: t.id,
        type: 'text',
        name: t.text || '텍스트',
        layerId: t.layerId,
        layerName: getLayerName(t.layerId),
        info: `텍스트: "${t.text}"`,
        points: [{ x: t.x, y: t.y }],
        attributes: { ...(t.attributes || {}) }
      });
    });

    return list;
  }, [points, lines, polylines, polygons, texts, layers]);

  const initialMode = targetIds && targetIds.length > 0 ? 'inspect' : 'table';
  const [activeTab, setActiveTab] = useState<'inspect' | 'table'>(initialMode);

  const [selectedIds, setSelectedIds] = useState<string[]>(targetIds || []);

  // Sync selection when targetIds prop changes
  React.useEffect(() => {
    if (targetIds) {
      setSelectedIds(targetIds);
      setActiveTab('inspect');
    }
  }, [targetIds]);

  const targetEntities = useMemo(() => {
    return allEntitiesList.filter(e => selectedIds.includes(e.id));
  }, [allEntitiesList, selectedIds]);

  const firstEntity = targetEntities[0] || null;

  // Form Fields
  const [entityName, setEntityName] = useState<string>('');
  
  // Skeletons for different types
  const getSkeletonKeys = (type: EntityType): string[] => {
    switch (type) {
      case 'point':
        return ['시설종류', '규격', '재질', '심도', '상태', '조사일자', '조사자', '비고'];
      case 'line':
      case 'polyline':
        return ['시설구분', '규격', '재질', '매설심도', '상태', '조사일자', '조사자', '비고'];
      case 'polygon':
        return ['구역구분', '용도', '상태', '조사일자', '비고'];
      case 'text':
        return ['분류', '비고'];
      default:
        return ['비고'];
    }
  };

  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([]);

  // Update form fields when selection changes
  React.useEffect(() => {
    if (targetEntities.length === 1 && firstEntity) {
      setEntityName(firstEntity.name || '');
      
      const existing = firstEntity.attributes || {};
      const skeletonKeys = getSkeletonKeys(firstEntity.type);
      
      // Merge existing attributes with skeleton keys to ensure "골격" (skeleton) is visible
      const mergedFields: Array<{ key: string; value: string }> = [];
      const seenKeys = new Set<string>();

      // 1. Add existing data
      Object.entries(existing).forEach(([k, v]) => {
        mergedFields.push({ key: k, value: String(v) });
        seenKeys.add(k);
      });

      // 2. Add missing skeleton keys as empty fields
      skeletonKeys.forEach(sk => {
        if (!seenKeys.has(sk)) {
          mergedFields.push({ key: sk, value: '' });
        }
      });

      setCustomFields(mergedFields);
    } else if (targetEntities.length > 1) {
      setEntityName(`${targetEntities.length}개 객체 선택됨`);
      // For multi-select, start with a common skeleton based on the first selected item's type
      const skeletonKeys = getSkeletonKeys(firstEntity?.type || 'point');
      setCustomFields(skeletonKeys.map(k => ({ key: k, value: '' })));
    } else {
      setEntityName('');
      setCustomFields([]);
    }
  }, [selectedIds, allEntitiesList]); // Re-run when selection or data changes

  // Table search
  const [tableSearch, setTableSearch] = useState('');
  const filteredEntities = useMemo(() => {
    if (!tableSearch.trim()) return allEntitiesList;
    const q = tableSearch.toLowerCase();
    return allEntitiesList.filter(e => {
      const matchName = e.name.toLowerCase().includes(q);
      const matchLayer = e.layerName.toLowerCase().includes(q);
      const attrStr = Object.entries(e.attributes).map(([k,v]) => `${k}:${v}`).join(' ').toLowerCase();
      return matchName || matchLayer || attrStr.includes(q);
    });
  }, [allEntitiesList, tableSearch]);

  // Extract unique attribute keys for table columns
  const tableAttributeKeys = useMemo(() => {
    const keys = new Set<string>();
    filteredEntities.forEach(e => {
      Object.keys(e.attributes).forEach(k => {
        if (e.attributes[k] !== undefined && e.attributes[k] !== '') {
          keys.add(k);
        }
      });
    });
    return Array.from(keys);
  }, [filteredEntities]);

  const handleAddCustomField = () => {
    setCustomFields(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveCustomField = (index: number) => {
    setCustomFields(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpdateCustomField = (index: number, field: 'key' | 'value', text: string) => {
    setCustomFields(prev => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: text };
      return copy;
    });
  };

  const handleSaveAttributes = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetEntities.length === 0) return;

    const baseAttributes: Record<string, string | number> = {};
    customFields.forEach(cf => {
      const trimmedKey = cf.key.trim();
      if (trimmedKey) {
        const trimmedVal = cf.value.trim();
        const numVal = parseFloat(trimmedVal);
        baseAttributes[trimmedKey] = (!isNaN(numVal) && String(numVal) === trimmedVal) ? numVal : trimmedVal;
      }
    });

    const updates = targetEntities.map(ent => {
      let finalAttributes: Record<string, string | number>;
      
      if (targetEntities.length === 1) {
        // Single entity: Complete replacement of attributes with the ones in the form
        finalAttributes = baseAttributes;
      } else {
        // Batch edit: Merge new values into existing attributes
        finalAttributes = { ...ent.attributes, ...baseAttributes };
      }

      return {
        id: ent.id,
        type: ent.type,
        name: targetEntities.length === 1 && entityName.trim() ? entityName.trim() : ent.name,
        attributes: finalAttributes
      };
    });

    onUpdateAttributes(updates);
    onClose();
  };

  const handleExportCSV = () => {
    // Collect ALL unique keys across all entities
    const allKeys = new Set<string>();
    allEntitiesList.forEach(e => Object.keys(e.attributes).forEach(k => allKeys.add(k)));
    const keys = Array.from(allKeys);

    const headers = ['번호', '명칭', '종류', '레이어', '정보', ...keys];
    const rows = [headers.join(',')];

    allEntitiesList.forEach((e, idx) => {
      const row = [
        idx + 1,
        `"${e.name.replace(/"/g, '""')}"`,
        e.type,
        `"${e.layerName.replace(/"/g, '""')}"`,
        `"${e.info.replace(/"/g, '""')}"`
      ];
      keys.forEach(k => {
        const val = e.attributes[k] ?? '';
        row.push(`"${String(val).replace(/"/g, '""')}"`);
      });
      rows.push(row.join(','));
    });

    downloadTextFile(rows.join('\n'), `od_data_export_${new Date().toISOString().slice(0, 10)}.csv`, 'euc-kr', 'text/csv');
  };

  const getIcon = (type: EntityType) => {
    switch (type) {
      case 'point': return <MapPin className="w-4 h-4 text-sky-500" />;
      case 'line': return <Minus className="w-4 h-4 text-amber-500" />;
      case 'polyline': return <Spline className="w-4 h-4 text-amber-600" />;
      case 'polygon': return <Pentagon className="w-4 h-4 text-emerald-500" />;
      case 'text': return <Type className="w-4 h-4 text-purple-500" />;
    }
  };

  const [showLayerSummaryPopup, setShowLayerSummaryPopup] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100 relative">
        
        {/* Layer Length Summary Popup Overlay */}
        {showLayerSummaryPopup && (
          <div className="absolute inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 animate-in fade-in duration-150">
            <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
              <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 flex items-center justify-between">
                <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
                  <Layers className="w-4 h-4" />
                  <h3 className="font-bold text-sm">레이어별 총 연장 (합계)</h3>
                </div>
                <button onClick={() => setShowLayerSummaryPopup(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-lg transition"><X className="w-4 h-4" /></button>
              </div>
              <div className="p-4 max-h-[50vh] overflow-y-auto custom-scrollbar space-y-2">
                {(() => {
                  const layersMap = new Map<string, { len: number, count: number }>();
                  allEntitiesList.forEach(e => {
                    if (e.type === 'line' || e.type === 'polyline') {
                      if (!layersMap.has(e.layerName)) layersMap.set(e.layerName, { len: 0, count: 0 });
                      const s = layersMap.get(e.layerName)!;
                      s.count++;
                      const m = e.info.match(/연장: ([\d.]+)m/);
                      if (m) s.len += parseFloat(m[1]);
                    }
                  });

                  if (layersMap.size === 0) {
                    return <div className="p-8 text-center text-slate-400 text-xs italic">도면에 선 데이터가 없습니다.</div>;
                  }

                  let grandTotal = 0;
                  const sorted = Array.from(layersMap.entries()).sort((a, b) => b[1].len - a[1].len);
                  sorted.forEach(s => grandTotal += s[1].len);

                  return (
                    <>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sorted.map(([lName, s]) => (
                          <div key={lName} className="py-2.5 flex items-center justify-between">
                            <div className="flex flex-col">
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{lName}</span>
                              <span className="text-[10px] text-slate-400">객체수: {s.count}개</span>
                            </div>
                            <div className="text-right">
                              <span className="text-sm font-mono font-bold text-amber-600 dark:text-amber-400">{s.len.toFixed(3)} m</span>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 pt-3 border-t-2 border-dashed border-slate-100 dark:border-slate-800 flex items-center justify-between">
                        <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">전체 합계 (Grand Total)</span>
                        <span className="text-base font-mono font-black text-sky-600 dark:text-sky-400 underline decoration-sky-500/30 underline-offset-4">{grandTotal.toFixed(3)} m</span>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-950 text-center">
                <button 
                  onClick={() => setShowLayerSummaryPopup(false)}
                  className="w-full py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl hover:bg-slate-100 transition"
                >닫기</button>
              </div>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">현장 시설물 속성(OD) 및 조사 데이터 관리</h2>
                {(() => {
                  let selLen = 0;
                  let selArea = 0;
                  targetEntities.forEach(e => {
                    if (e.type === 'line' || e.type === 'polyline') {
                      const m = e.info.match(/연장: ([\d.]+)m/);
                      if (m) selLen += parseFloat(m[1]);
                    } else if (e.type === 'polygon') {
                      const m = e.info.match(/면적: ([\d.]+)㎡/);
                      if (m) selArea += parseFloat(m[1]);
                    }
                  });

                  return (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {selLen > 0 && (
                        <div className="px-2 py-0.5 bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 rounded-full">
                          <span className="text-[10px] text-sky-600 dark:text-sky-400 font-bold">선택 연장: {selLen.toFixed(3)}m</span>
                        </div>
                      )}
                      {selArea > 0 && (
                        <div className="px-2 py-0.5 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-full">
                          <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">선택 면적: {selArea.toFixed(3)}㎡</span>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => setShowLayerSummaryPopup(true)}
                        className="px-2.5 py-0.5 bg-amber-500 hover:bg-amber-400 text-slate-950 border border-amber-600 rounded-full flex items-center gap-1 shadow-sm transition active:scale-95"
                      >
                        <Layers className="w-3 h-3" />
                        <span className="text-[10px] font-bold">레이어별 연장 확인</span>
                      </button>
                    </div>
                  );
                })()}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                점(맨홀/시설물), 선, 텍스트 객체에 대해 자유로운 속성 항목을 추가하고 관리합니다.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex items-center px-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/30">
          <button
            onClick={() => setActiveTab('inspect')}
            className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'inspect' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500'
            }`}
          >
            <Edit3 className="w-3.5 h-3.5" />
            <span>속성 편집 ({targetEntities.length}개)</span>
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'table' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>전체 데이터 대장 ({allEntitiesList.length}개)</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'inspect' ? (
            <form onSubmit={handleSaveAttributes} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {targetEntities.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">선택된 객체가 없습니다.</div>
              ) : (
                <>
                  <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border border-slate-100 dark:border-slate-800 rounded-xl flex items-center gap-3">
                    {getIcon(firstEntity!.type)}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        {targetEntities.length === 1 ? (
                          <input 
                            value={entityName} 
                            onChange={e => setEntityName(e.target.value)}
                            placeholder="객체 명칭 입력"
                            className="bg-transparent outline-none border-b border-transparent focus:border-sky-500 w-full"
                          />
                        ) : (
                          <div className="flex flex-col">
                            <span>{targetEntities.length}개 객체 선택됨</span>
                            {(() => {
                              const types = new Set(targetEntities.map(e => e.type));
                              if (types.size === 1) {
                                const type = Array.from(types)[0];
                                if (type === 'line' || type === 'polyline') {
                                  const total = targetEntities.reduce((sum, e) => {
                                    const match = e.info.match(/연장: ([\d.]+)m/);
                                    return sum + (match ? parseFloat(match[1]) : 0);
                                  }, 0);
                                  return <span className="text-[11px] text-amber-600 dark:text-amber-400 font-mono">선택 합계 연장: {total.toFixed(3)}m</span>;
                                }
                                if (type === 'polygon') {
                                  const total = targetEntities.reduce((sum, e) => {
                                    const match = e.info.match(/면적: ([\d.]+)㎡/);
                                    return sum + (match ? parseFloat(match[1]) : 0);
                                  }, 0);
                                  return <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-mono">선택 합계 면적: {total.toFixed(3)}㎡</span>;
                                }
                              }
                              return null;
                            })()}
                          </div>
                        )}
                      </div>
                      {targetEntities.length === 1 && <div className="text-[10px] text-slate-500 mt-0.5">{firstEntity?.info}</div>}
                    </div>
                    {targetEntities.length === 1 && onFocusEntity && (
                      <button type="button" onClick={() => onFocusEntity(firstEntity!.points)} className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 text-slate-500"><Crosshair className="w-3.5 h-3.5" /></button>
                    )}
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xs font-bold flex items-center gap-1.5">
                        <Tag className="w-3.5 h-3.5 text-sky-500" />
                        <span>객체 속성 리스트 (OD Fields)</span>
                      </h3>
                      <button
                        type="button"
                        onClick={handleAddCustomField}
                        className="text-[11px] font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> 항목 추가
                      </button>
                    </div>

                    <div className="space-y-2">
                      {customFields.map((cf, idx) => (
                        <div key={idx} className="flex items-center gap-2 group">
                          <input
                            type="text"
                            list="od-keys-presets"
                            placeholder="속성명 (예: 맨홀종류, 규격)"
                            value={cf.key}
                            onChange={e => handleUpdateCustomField(idx, 'key', e.target.value)}
                            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <input
                            type="text"
                            placeholder="속성값"
                            value={cf.value}
                            onChange={e => handleUpdateCustomField(idx, 'value', e.target.value)}
                            className="flex-[2] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomField(idx)}
                            className="p-1.5 text-slate-300 hover:text-red-500 transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      <datalist id="od-keys-presets">
                        <option value="시설구분" /><option value="규격" /><option value="재질" /><option value="심도" />
                        <option value="상태" /><option value="조사일자" /><option value="조사자" /><option value="비고" />
                      </datalist>
                    </div>
                  </div>

                  <div className="pt-4 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-500">취소</button>
                    <button type="submit" className="px-6 py-2 bg-sky-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-sky-600/20 active:scale-95 transition">속성 저장</button>
                  </div>
                </>
              )}
            </form>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/20 dark:bg-slate-900/40">
              <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    placeholder="객체 검색 (명칭, 속성값, 레이어)..."
                    value={tableSearch}
                    onChange={e => setTableSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs"
                  />
                </div>
                <button onClick={handleExportCSV} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5">
                  <Download className="w-3.5 h-3.5" /> 엑셀(CSV) 저장
                </button>
              </div>

              <div className="flex-1 overflow-auto custom-scrollbar">
                <table className="w-full text-left text-[11px] border-collapse min-w-[800px]">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 sticky top-0 border-b border-slate-200 dark:border-slate-800 z-10">
                    <tr>
                      <th className="py-2.5 px-3 w-10 text-center">No</th>
                      <th className="py-2.5 px-3 min-w-[150px]">객체명</th>
                      <th className="py-2.5 px-3 min-w-[120px]">레이어</th>
                      {tableAttributeKeys.map(k => (
                        <th key={k} className="py-2.5 px-3 min-w-[100px] border-l border-slate-100 dark:border-slate-800 font-bold text-sky-600 dark:text-sky-400 bg-sky-50/30 dark:bg-sky-950/20">{k}</th>
                      ))}
                      <th className="py-2.5 px-3 text-right sticky right-0 bg-slate-50 dark:bg-slate-950 shadow-[-4px_0_10px_rgba(0,0,0,0.05)] w-16">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredEntities.map((e, idx) => (
                      <tr key={e.id} className="hover:bg-sky-50/30 dark:hover:bg-sky-900/10 transition group">
                        <td className="py-2 px-3 text-center text-slate-400 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3 font-bold text-slate-900 dark:text-white">
                          <div className="flex items-center gap-1.5">
                            {getIcon(e.type)}
                            <span className="truncate max-w-[180px]">{e.name}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-slate-500">
                          <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-[10px]">{e.layerName}</span>
                        </td>
                        {tableAttributeKeys.map(k => (
                          <td key={k} className="py-2 px-3 text-slate-600 dark:text-slate-300 border-l border-slate-100 dark:border-slate-800/50">
                            {e.attributes[k] ?? '-'}
                          </td>
                        ))}
                        <td className="py-2 px-3 text-right sticky right-0 bg-white dark:bg-slate-900 group-hover:bg-sky-50 dark:group-hover:bg-slate-800 transition shadow-[-4px_0_10px_rgba(0,0,0,0.05)]">
                          <button
                            onClick={() => { setSelectedIds([e.id]); setActiveTab('inspect'); }}
                            className="px-2 py-1 bg-sky-50 dark:bg-sky-950 text-sky-600 rounded-lg font-bold hover:bg-sky-100 transition"
                          >편집</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
