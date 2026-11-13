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
  Type,
  LayoutTemplate,
  Save,
  Upload,
  Share2
} from 'lucide-react';
import { CADLine, CADPolyline, CADPoint, CADPolygon, CADText, Point2D, CADLayer, AttributeTemplate } from '../types/cad';
import { distance2D } from '../utils/geometry';
import { downloadTextFile } from '../utils/downloadHelper';
import { db } from '../db/localDb';
import { useLiveQuery } from 'dexie-react-hooks';

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

const TemplateItem: React.FC<{ 
  tpl: AttributeTemplate; 
  onEdit: (t: AttributeTemplate) => void; 
}> = ({ tpl, onEdit }) => {
  const [isConfirming, setIsConfirming] = useState(false);

  return (
    <div className="group p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl hover:border-sky-500 transition shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
          <LayoutTemplate className="w-3.5 h-3.5 text-sky-500" />
          {tpl.name}
        </h4>
        <div className="flex gap-1 items-center">
          {isConfirming ? (
            <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-1 duration-150">
              <span className="text-[9px] font-bold text-red-500 mr-1">삭제하시겠습니까?</span>
              <button 
                type="button" 
                onClick={async () => { await db.attributeTemplates.delete(tpl.id!); setIsConfirming(false); }} 
                className="px-2 py-0.5 bg-red-500 text-white text-[9px] font-bold rounded hover:bg-red-600 transition"
              >확인</button>
              <button 
                type="button" 
                onClick={() => setIsConfirming(false)} 
                className="px-2 py-0.5 bg-slate-100 dark:bg-slate-700 text-slate-500 text-[9px] font-bold rounded hover:bg-slate-200 transition"
              >취소</button>
            </div>
          ) : (
            <>
              <button 
                type="button" 
                onClick={() => onEdit(tpl)} 
                className="p-1.5 text-slate-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/30 rounded-lg transition"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
              <button 
                type="button" 
                onClick={() => setIsConfirming(true)} 
                className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {tpl.keys.map(k => (
          <span key={k} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-950 text-[9px] text-slate-500 border border-slate-200 dark:border-slate-800 rounded">{k}</span>
        ))}
      </div>
    </div>
  );
};

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
  // 1. Load Templates from IndexedDB
  const templates = useLiveQuery(() => db.attributeTemplates.toArray()) || [];

  // Combine all entities into a single searchable list
  const allEntitiesList = useMemo(() => {
    const list: Array<{
      id: string;
      type: EntityType;
      name: string;
      layerId: string;
      layerName: string;
      info: string;
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
      if (pl.isClosed && pl.points.length >= 2) {
        const first = pl.points[0];
        const last = pl.points[pl.points.length - 1];
        if (first.x !== last.x || first.y !== last.y) {
          len += distance2D(last, first);
        }
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
  const [activeTab, setActiveTab] = useState<'inspect' | 'table' | 'templates'>(initialMode);
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
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>([]);

  // Update form fields when selection changes
  React.useEffect(() => {
    if (targetEntities.length === 1 && firstEntity) {
      setEntityName(firstEntity.name || '');
      const existing = firstEntity.attributes || {};
      const fields: Array<{ key: string; value: string }> = [];
      Object.entries(existing).forEach(([k, v]) => {
        fields.push({ key: k, value: String(v) });
      });
      setCustomFields(fields);
    } else if (targetEntities.length > 1) {
      setEntityName(`${targetEntities.length}개 객체 선택됨`);
      setCustomFields([]); // Clear for batch mode
    } else {
      setEntityName('');
      setCustomFields([]);
    }
  }, [selectedIds, allEntitiesList]);

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
        finalAttributes = baseAttributes;
      } else {
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
    if (targetEntities.length === 1) onClose();
  };

  const handleApplyTemplate = (tpl: AttributeTemplate) => {
    const seenKeys = new Set(customFields.map(f => f.key.trim()));
    const nextFields = [...customFields];
    tpl.keys.forEach(k => {
      if (!seenKeys.has(k.trim())) {
        nextFields.push({ key: k.trim(), value: '' });
      }
    });
    setCustomFields(nextFields);
  };

  // Template Management States
  const [editingTpl, setEditingTemplate] = useState<AttributeTemplate | null>(null);
  const [tplFormName, setTplFormName] = useState('');
  const [tplFormKeys, setTplFormKeys] = useState('');

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tplFormName.trim()) return;
    const keys = tplFormKeys.split(',').map(k => k.trim()).filter(k => !!k);
    
    if (editingTpl) {
      await db.attributeTemplates.update(editingTpl.id!, { name: tplFormName.trim(), keys });
    } else {
      await db.attributeTemplates.add({ name: tplFormName.trim(), keys, createdAt: Date.now() });
    }
    
    setEditingTemplate(null);
    setTplFormName('');
    setTplFormKeys('');
  };

  const handleExportTemplates = () => {
    const data = JSON.stringify(templates, null, 2);
    downloadTextFile(data, `od_templates_${new Date().toISOString().slice(0, 10)}.json`, 'utf-8', 'application/json');
  };

  const handleImportTemplates = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const imported = JSON.parse(ev.target?.result as string);
        if (Array.isArray(imported)) {
          for (const t of imported) {
            if (t.name && Array.isArray(t.keys)) {
              await db.attributeTemplates.add({ 
                name: t.name, 
                keys: t.keys, 
                createdAt: t.createdAt || Date.now() 
              });
            }
          }
          alert('템플릿이 성공적으로 추가되었습니다.');
        }
      } catch (err) {
        alert('잘못된 템플릿 파일 형식입니다.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleExportCSV = () => {
    const allKeys = new Set<string>();
    allEntitiesList.forEach(e => Object.keys(e.attributes).forEach(k => allKeys.add(k)));
    const keys = Array.from(allKeys);
    const headers = ['번호', '명칭', '종류', '레이어', '정보', ...keys];
    const rows = [headers.join(',')];
    allEntitiesList.forEach((e, idx) => {
      const row = [idx + 1, `"${e.name.replace(/"/g, '""')}"`, e.type, `"${e.layerName.replace(/"/g, '""')}"`, `"${e.info.replace(/"/g, '""')}"` ];
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
                  if (layersMap.size === 0) return <div className="p-8 text-center text-slate-400 text-xs italic">도면에 선 데이터가 없습니다.</div>;
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
                        <span className="text-xs font-black text-slate-900 dark:text-white uppercase tracking-wider">전체 합계</span>
                        <span className="text-base font-mono font-black text-sky-600 dark:text-sky-400 underline underline-offset-4">{grandTotal.toFixed(3)} m</span>
                      </div>
                    </>
                  );
                })()}
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-950 text-center">
                <button onClick={() => setShowLayerSummaryPopup(false)} className="w-full py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold rounded-xl hover:bg-slate-100 transition">닫기</button>
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
                <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">속성(OD) 및 템플릿 관리</h2>
                <button
                  type="button"
                  onClick={() => setShowLayerSummaryPopup(true)}
                  className="px-2.5 py-0.5 bg-amber-500 hover:bg-amber-400 text-slate-950 border border-amber-600 rounded-full flex items-center gap-1 shadow-sm transition active:scale-95"
                >
                  <Layers className="w-3 h-3" />
                  <span className="text-[10px] font-bold">레이어별 연장</span>
                </button>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">사용자 정의 템플릿을 통해 시설물별 속성 항목을 유연하게 관리합니다.</p>
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
            <span>속성 편집 ({targetEntities.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('table')}
            className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'table' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            <span>데이터 대장</span>
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
              activeTab === 'templates' ? 'border-sky-500 text-sky-600' : 'border-transparent text-slate-500'
            }`}
          >
            <LayoutTemplate className="w-3.5 h-3.5" />
            <span>템플릿 설정</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'inspect' && (
            <form onSubmit={handleSaveAttributes} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {targetEntities.length === 0 ? (
                <div className="p-12 text-center text-slate-400 text-xs">선택된 객체가 없습니다.</div>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Left: Entity Info & Apply Template */}
                    <div className="flex-1 space-y-3">
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
                              <span>{targetEntities.length}개 객체 일괄 수정</span>
                            )}
                          </div>
                          {targetEntities.length === 1 && <div className="text-[10px] text-slate-500 mt-0.5">{firstEntity?.info}</div>}
                        </div>
                        {targetEntities.length === 1 && onFocusEntity && (
                          <button type="button" onClick={() => onFocusEntity(firstEntity!.points)} className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 text-slate-500 shadow-sm"><Crosshair className="w-3.5 h-3.5" /></button>
                        )}
                      </div>

                      {/* Template Application Area */}
                      <div className="space-y-2">
                        <label className="text-[10px] font-black text-slate-400 uppercase flex items-center gap-1.5 px-1">
                          <LayoutTemplate className="w-3 h-3" />
                          <span>속성 템플릿 불러오기</span>
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {templates.length === 0 ? (
                            <span className="text-[11px] text-slate-400 px-1 italic">등록된 템플릿이 없습니다. (템플릿 설정 탭에서 추가)</span>
                          ) : (
                            templates.map(tpl => (
                              <button
                                key={tpl.id}
                                type="button"
                                onClick={() => handleApplyTemplate(tpl)}
                                className="px-2.5 py-1.5 bg-sky-50 dark:bg-sky-900/30 border border-sky-200 dark:border-sky-800 rounded-lg text-[11px] font-bold text-sky-700 dark:text-sky-300 hover:bg-sky-100 transition shadow-sm"
                              >
                                {tpl.name}
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Right: Attribute Fields List */}
                    <div className="flex-[1.5] space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-sky-500" />
                          <span>속성 상세 항목 (Fields)</span>
                        </h3>
                        <button type="button" onClick={handleAddCustomField} className="text-[11px] font-bold text-sky-600 dark:text-sky-400 flex items-center gap-1">
                          <Plus className="w-3 h-3" /> 항목 추가
                        </button>
                      </div>

                      <div className="space-y-2 max-h-64 overflow-y-auto pr-1 custom-scrollbar">
                        {customFields.map((cf, idx) => (
                          <div key={idx} className="flex items-center gap-2 group">
                            <input
                              type="text"
                              placeholder="속성명"
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
                            <button type="button" onClick={() => handleRemoveCustomField(idx)} className="p-1.5 text-slate-300 hover:text-red-500 transition">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-semibold text-slate-500">취소</button>
                    <button type="submit" className="px-8 py-2 bg-sky-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-sky-600/20 active:scale-95 transition">속성 저장</button>
                  </div>
                </>
              )}
            </form>
          )}

          {activeTab === 'table' && (
            <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/20 dark:bg-slate-900/40">
              <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input placeholder="객체 검색 (명칭, 속성값, 레이어)..." value={tableSearch} onChange={e => setTableSearch(e.target.value)} className="w-full pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs" />
                </div>
                <button onClick={handleExportCSV} className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5 transition hover:bg-slate-200 shadow-sm"><Download className="w-3.5 h-3.5" /> 엑셀(CSV)</button>
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
                          <div className="flex items-center gap-1.5">{getIcon(e.type)} <span className="truncate max-w-[180px]">{e.name}</span></div>
                        </td>
                        <td className="py-2 px-3 text-slate-500"><span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-[10px]">{e.layerName}</span></td>
                        {tableAttributeKeys.map(k => (
                          <td key={k} className="py-2 px-3 text-slate-600 dark:text-slate-300 border-l border-slate-100 dark:border-slate-800/50">{e.attributes[k] ?? '-'}</td>
                        ))}
                        <td className="py-2 px-3 text-right sticky right-0 bg-white dark:bg-slate-900 group-hover:bg-sky-50 dark:group-hover:bg-slate-800 transition shadow-[-4px_0_10px_rgba(0,0,0,0.05)]">
                          <button onClick={() => { setSelectedIds([e.id]); setActiveTab('inspect'); }} className="px-2 py-1 bg-sky-50 dark:bg-sky-950 text-sky-600 rounded-lg font-bold hover:bg-sky-100 transition shadow-sm">편집</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="flex-1 flex flex-col sm:flex-row overflow-hidden">
              {/* Template List & Actions */}
              <div className="flex-1 flex flex-col border-r border-slate-100 dark:border-slate-800 overflow-hidden">
                <div className="p-3 bg-slate-50 dark:bg-slate-950/40 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">나의 속성 템플릿</span>
                  <div className="flex gap-1.5">
                    <label className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:text-sky-600 cursor-pointer transition shadow-sm" title="템플릿 파일 불러오기">
                      <Upload className="w-3.5 h-3.5" />
                      <input type="file" accept=".json" className="hidden" onChange={handleImportTemplates} />
                    </label>
                    <button onClick={handleExportTemplates} className="p-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-500 hover:text-sky-600 transition shadow-sm" title="내 템플릿 파일로 저장/백업"><Save className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
                  {templates.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs italic">등록된 템플릿이 없습니다. 오른쪽 폼에서 새 템플릿을 만들어보세요.</div>
                  ) : (
                    <div className="space-y-2">
                      {templates.map(tpl => (
                        <TemplateItem key={tpl.id} tpl={tpl} onEdit={(t) => {
                          setEditingTemplate(t);
                          setTplFormName(t.name);
                          setTplFormKeys(t.keys.join(', '));
                        }} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Template Editor Form */}
              <div className="w-full sm:w-80 bg-slate-50/50 dark:bg-slate-950/20 p-4">
                <form onSubmit={handleSaveTemplate} className="space-y-4">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="p-1.5 rounded-lg bg-sky-100 dark:bg-sky-900 text-sky-600 dark:text-sky-400"><Plus className="w-3.5 h-3.5" /></div>
                    <h3 className="text-xs font-black uppercase tracking-tight">{editingTpl ? '템플릿 수정' : '새 템플릿 생성'}</h3>
                  </div>
                  
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">템플릿 이름</label>
                    <input 
                      required 
                      placeholder="예: 오수맨홀 성과" 
                      value={tplFormName} 
                      onChange={e => setTplFormName(e.target.value)} 
                      className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-500 uppercase ml-1">속성 항목 (쉼표로 구분)</label>
                    <textarea 
                      required 
                      placeholder="시설종류, 규격, 재질, 심도, 조사자" 
                      value={tplFormKeys} 
                      onChange={e => setTplFormKeys(e.target.value)} 
                      rows={5}
                      className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-sky-500 resize-none font-sans"
                    />
                    <p className="text-[9px] text-slate-400 mt-1 leading-tight px-1">관리할 속성 키값들을 쉼표(,)로 연결하여 입력하세요. 저장 시 템플릿 목록에 추가됩니다.</p>
                  </div>

                  <div className="pt-2 flex gap-2">
                    {editingTpl && (
                      <button type="button" onClick={() => { setEditingTemplate(null); setTplFormName(''); setTplFormKeys(''); }} className="flex-1 py-2 text-xs font-bold text-slate-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">취소</button>
                    )}
                    <button type="submit" className="flex-[2] py-2 bg-sky-600 text-white text-xs font-black rounded-xl shadow-lg shadow-sky-600/20 active:scale-95 transition flex items-center justify-center gap-1.5">
                      <Save className="w-3.5 h-3.5" />
                      {editingTpl ? '변경사항 저장' : '템플릿 저장'}
                    </button>
                  </div>
                </form>

                <div className="mt-8 p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900 rounded-xl">
                  <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 mb-1.5">
                    <Share2 className="w-3 h-3" />
                    <span className="text-[10px] font-black uppercase">템플릿 공유 팁</span>
                  </div>
                  <p className="text-[9px] text-amber-700/80 dark:text-amber-300/60 leading-relaxed">상단의 저장 아이콘을 클릭하여 템플릿 파일을 내보낸 뒤, 동료에게 전송하면 다른 기기에서도 동일한 속성 형식을 사용할 수 있습니다.</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
