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
  Sliders,
  Calendar,
  User,
  Activity,
  FileSpreadsheet
} from 'lucide-react';
import { CADLine, CADPolyline, Point2D } from '../types/cad';
import { distance2D } from '../utils/geometry';
import { downloadTextFile } from '../utils/downloadHelper';

interface LineODModalProps {
  lines: CADLine[];
  polylines: CADPolyline[];
  targetLineIds?: string[];
  activeLayerId: string;
  onUpdateLineAttributes: (updatedLines: { id: string; name?: string; attributes: Record<string, string | number> }[]) => void;
  onFocusLine?: (points: Point2D[]) => void;
  onClose: () => void;
}

const CATEGORY_PRESETS = [
  '상수관', '하수관', '우수관', '가스관', '통신관', '전력선',
  '도로경계', '보차도경계', '옹벽', '측구', '지적경계', '울타리/펜스', '농수로', '기타시설'
];

const SPEC_PRESETS = [
  'D50', 'D100', 'D150', 'D200', 'D250', 'D300', 'D400', 'D500', 'D600',
  'B300xH300', 'B400xH400', 'B600xH600', '폭 3m', '폭 4m', '폭 6m', '폭 8m'
];

const MATERIAL_PRESETS = [
  'PE(폴리에틸렌)', 'PVC', 'DIP(닥타일주철관)', 'SP(강관)', 'RC(철근콘크리트)', '아스콘', '석재', '목재', '스틸(강재)'
];

const STATUS_PRESETS = [
  '양호', '보통', '노후/점검필요', '파손/개보수', '미확인'
];

export const LineODModal: React.FC<LineODModalProps> = ({
  lines,
  polylines,
  targetLineIds,
  activeLayerId,
  onUpdateLineAttributes,
  onFocusLine,
  onClose
}) => {
  // Combine all lines and polylines with computed length
  const allLinesList = useMemo(() => {
    const list: Array<{
      id: string;
      isPolyline: boolean;
      name: string;
      layerId: string;
      length: number;
      points: Point2D[];
      attributes: Record<string, string | number>;
    }> = [];

    lines.forEach((l, idx) => {
      const len = distance2D(l.start, l.end);
      list.push({
        id: l.id,
        isPolyline: false,
        name: l.name || `단일선_${idx + 1}`,
        layerId: l.layerId,
        length: len,
        points: [l.start, l.end],
        attributes: { ...(l.attributes || {}) }
      });
    });

    polylines.forEach((pl, idx) => {
      let len = 0;
      for (let i = 0; i < pl.points.length - 1; i++) {
        len += distance2D(pl.points[i], pl.points[i + 1]);
      }
      list.push({
        id: pl.id,
        isPolyline: true,
        name: pl.name || `연속선_${idx + 1}`,
        layerId: pl.layerId,
        length: len,
        points: pl.points,
        attributes: { ...(pl.attributes || {}) }
      });
    });

    return list;
  }, [lines, polylines]);

  // Mode: 'inspect' (edit selected lines) vs 'table' (view/search all lines)
  const initialMode = targetLineIds && targetLineIds.length > 0 ? 'inspect' : 'table';
  const [activeTab, setActiveTab] = useState<'inspect' | 'table'>(initialMode);

  // Selected lines for editing
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    if (targetLineIds && targetLineIds.length > 0) return targetLineIds;
    if (allLinesList.length > 0) return [allLinesList[0].id];
    return [];
  });

  // Current editing state
  const targetLines = useMemo(() => {
    return allLinesList.filter(l => selectedIds.includes(l.id));
  }, [allLinesList, selectedIds]);

  const firstLine = targetLines[0] || null;

  // Form Fields
  const [lineName, setLineName] = useState<string>(() => {
    if (targetLines.length === 1 && firstLine) return firstLine.name || '';
    return '';
  });

  const [category, setCategory] = useState<string>(() => {
    return (firstLine?.attributes?.CATEGORY as string) || (firstLine?.attributes?.시설구분 as string) || '';
  });

  const [spec, setSpec] = useState<string>(() => {
    return (firstLine?.attributes?.SPEC as string) || (firstLine?.attributes?.규격 as string) || '';
  });

  const [material, setMaterial] = useState<string>(() => {
    return (firstLine?.attributes?.MATERIAL as string) || (firstLine?.attributes?.재질 as string) || '';
  });

  const [depth, setDepth] = useState<string>(() => {
    const val = firstLine?.attributes?.DEPTH ?? firstLine?.attributes?.매설심도;
    return val !== undefined ? String(val) : '';
  });

  const [surveyDate, setSurveyDate] = useState<string>(() => {
    return (firstLine?.attributes?.SURV_DATE as string) || 
           (firstLine?.attributes?.조사일자 as string) || 
           new Date().toISOString().slice(0, 10);
  });

  const [surveyor, setSurveyor] = useState<string>(() => {
    return (firstLine?.attributes?.SURVEYOR as string) || (firstLine?.attributes?.조사자 as string) || '';
  });

  const [status, setStatus] = useState<string>(() => {
    return (firstLine?.attributes?.STATUS as string) || (firstLine?.attributes?.상태 as string) || '양호';
  });

  const [remark, setRemark] = useState<string>(() => {
    return (firstLine?.attributes?.REMARK as string) || (firstLine?.attributes?.비고 as string) || '';
  });

  // Custom User OD Fields (key-value list)
  const [customFields, setCustomFields] = useState<Array<{ key: string; value: string }>>(() => {
    if (!firstLine || !firstLine.attributes) return [];
    const standardKeys = new Set([
      'CATEGORY', 'SPEC', 'MATERIAL', 'DEPTH', 'SURV_DATE', 'SURVEYOR', 'STATUS', 'REMARK',
      '시설구분', '규격', '재질', '매설심도', '조사일자', '조사자', '상태', '비고',
      'ID', 'NAME', 'LAYER', 'LENGTH_M', 'TYPE'
    ]);
    const extras: Array<{ key: string; value: string }> = [];
    Object.entries(firstLine.attributes).forEach(([k, v]) => {
      if (!standardKeys.has(k)) {
        extras.push({ key: k, value: String(v) });
      }
    });
    return extras;
  });

  // Table search & filter
  const [tableSearch, setTableSearch] = useState('');

  const filteredLines = useMemo(() => {
    if (!tableSearch.trim()) return allLinesList;
    const q = tableSearch.toLowerCase();
    return allLinesList.filter(l => {
      const matchName = l.name.toLowerCase().includes(q);
      const matchLayer = l.layerId.toLowerCase().includes(q);
      const attrStr = Object.values(l.attributes).join(' ').toLowerCase();
      return matchName || matchLayer || attrStr.includes(q);
    });
  }, [allLinesList, tableSearch]);

  // Total statistics
  const totalLength = useMemo(() => {
    // JavaScript numbers (64-bit float) already provide ~15-17 significant decimal digits.
    return allLinesList.reduce((sum, l) => sum + l.length, 0);
  }, [allLinesList]);

  const targetTotalLength = useMemo(() => {
    return targetLines.reduce((sum, l) => sum + l.length, 0);
  }, [targetLines]);

  // Layer-by-layer summary
  const layerSummary = useMemo(() => {
    const summary = new Map<string, { count: number; length: number }>();
    allLinesList.forEach(l => {
      const existing = summary.get(l.layerId) || { count: 0, length: 0 };
      summary.set(l.layerId, {
        count: existing.count + 1,
        length: existing.length + l.length
      });
    });
    return Array.from(summary.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [allLinesList]);

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

  // Submit / Save OD Attributes
  const handleSaveAttributes = (e: React.FormEvent) => {
    e.preventDefault();
    if (targetLines.length === 0) return;

    const baseAttributes: Record<string, string | number> = {};

    if (category.trim()) baseAttributes.CATEGORY = category.trim();
    if (spec.trim()) baseAttributes.SPEC = spec.trim();
    if (material.trim()) baseAttributes.MATERIAL = material.trim();
    if (depth.trim() && !isNaN(parseFloat(depth))) {
      baseAttributes.DEPTH = parseFloat(parseFloat(depth).toFixed(3));
    } else if (depth.trim()) {
      baseAttributes.DEPTH = depth.trim();
    }
    if (surveyDate.trim()) baseAttributes.SURV_DATE = surveyDate.trim();
    if (surveyor.trim()) baseAttributes.SURVEYOR = surveyor.trim();
    if (status.trim()) baseAttributes.STATUS = status.trim();
    if (remark.trim()) baseAttributes.REMARK = remark.trim();

    // Add custom fields
    customFields.forEach(cf => {
      const trimmedKey = cf.key.trim();
      if (trimmedKey && cf.value.trim()) {
        const numVal = parseFloat(cf.value.trim());
        baseAttributes[trimmedKey] = (!isNaN(numVal) && String(numVal) === cf.value.trim()) ? numVal : cf.value.trim();
      }
    });

    const updates = targetLines.map(line => {
      const merged = { ...line.attributes, ...baseAttributes };
      return {
        id: line.id,
        name: targetLines.length === 1 && lineName.trim() ? lineName.trim() : line.name,
        attributes: merged
      };
    });

    onUpdateLineAttributes(updates);
    onClose();
  };

  const [odCsvFileName, setOdCsvFileName] = useState(() => `cad_lines_od_data_${new Date().toISOString().slice(0, 10)}`);

  // Export Line OD Table as CSV
  const handleExportODCSV = () => {
    const headers = [
      'ID', '선명칭', '구분', '레이어', '연장(m)',
      '시설구분', '규격', '재질', '매설심도(m)', '조사일자', '조사자', '상태', '비고'
    ];
    const rows = [headers.join(',')];

    allLinesList.forEach((l, idx) => {
      const a = l.attributes || {};
      const row = [
        idx + 1,
        `"${l.name.replace(/"/g, '""')}"`,
        l.isPolyline ? '연속선' : '단일선',
        `"${l.layerId}"`,
        l.length.toFixed(3),
        `"${(a.CATEGORY || a.시설구분 || '').toString().replace(/"/g, '""')}"`,
        `"${(a.SPEC || a.규격 || '').toString().replace(/"/g, '""')}"`,
        `"${(a.MATERIAL || a.재질 || '').toString().replace(/"/g, '""')}"`,
        a.DEPTH !== undefined ? a.DEPTH : '',
        `"${(a.SURV_DATE || a.조사일자 || '').toString().replace(/"/g, '""')}"`,
        `"${(a.SURVEYOR || a.조사자 || '').toString().replace(/"/g, '""')}"`,
        `"${(a.STATUS || a.상태 || '').toString().replace(/"/g, '""')}"`,
        `"${(a.REMARK || a.비고 || '').toString().replace(/"/g, '""')}"`
      ];
      rows.push(row.join(','));
    });

    const cleanName = (odCsvFileName.trim() || `cad_lines_od_data_${new Date().toISOString().slice(0, 10)}`).replace(/\.csv$/i, '');
    downloadTextFile(rows.join('\n'), `${cleanName}.csv`, 'euc-kr', 'text/csv');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-cyan-500 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0">
              <Database className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white">
                  선 속성 및 오토캐드 맵(OD) 데이터 관리
                </h2>
                <span className="text-[10px] bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 px-2 py-0.5 rounded-full font-bold">
                  AutoCAD Map 3D 호환
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                현장 조사에서 파악한 선 객체(관로, 도로, 경계 등)의 속성을 입력하고 SHP 내보내기 시 캐드 OD 테이블로 자동 탑재합니다.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between px-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-950/30">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('inspect')}
              className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                activeTab === 'inspect'
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>
                {targetLines.length > 1
                  ? `선택된 선 일괄 속성 입력 (${targetLines.length}개)`
                  : '선택 선 OD 속성 편집'}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('table')}
              className={`py-2.5 px-3.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                activeTab === 'table'
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>전체 선/OD 대장 관리 ({allLinesList.length}개)</span>
            </button>
          </div>

          <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
            총 선로 연장: <strong className="font-mono text-sky-600 dark:text-sky-400">{totalLength.toFixed(3)}m</strong>
          </div>
        </div>

        {/* Tab 1: Inspector / Edit Mode */}
        {activeTab === 'inspect' && (
          <form onSubmit={handleSaveAttributes} className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {targetLines.length === 0 ? (
              <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-xs">
                현재 선택된 선이 없습니다. 도면에서 선을 클릭하거나 '전체 선/OD 대장 관리' 탭에서 편집할 선을 선택해 주세요.
              </div>
            ) : (
              <>
                {/* Line Selection Summary Card */}
                <div className="p-3.5 bg-sky-50/60 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-800/60 rounded-2xl flex flex-wrap items-center justify-between gap-2.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-lg bg-sky-100 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 font-bold text-[11px]">
                      {targetLines.length === 1 ? (firstLine?.isPolyline ? '연속선 (Polyline)' : '단일선 (Line)') : `다중 선택 (${targetLines.length}개 선)`}
                    </span>
                    <span className="text-slate-700 dark:text-slate-300 font-medium">
                      {targetLines.length === 1 ? firstLine?.name : `선택 객체 총 ${targetLines.length}개`}
                    </span>
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      레이어: <span className="font-mono text-slate-800 dark:text-slate-200">{firstLine?.layerId}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-[11px]">
                      총 연장: <strong className="font-mono text-sky-600 dark:text-sky-400 text-sm">{targetTotalLength.toFixed(3)}</strong> m
                    </div>
                    {firstLine && onFocusLine && (
                      <button
                        type="button"
                        onClick={() => onFocusLine(firstLine.points)}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] transition"
                        title="화면을 해당 선으로 이동"
                      >
                        <Crosshair className="w-3 h-3 text-sky-500" />
                        <span>화면이동</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Form Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  {/* 1. Name */}
                  {targetLines.length === 1 && (
                    <div className="space-y-1.5 sm:col-span-2">
                      <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center justify-between">
                        <span>선 명칭 (Line Name / 식별자)</span>
                        <span className="text-[10px] text-slate-400 font-normal">AutoCAD Map OD 필드: NAME</span>
                      </label>
                      <input
                        type="text"
                        value={lineName}
                        onChange={e => setLineName(e.target.value)}
                        placeholder="예: 상수관로_01, 배수측구_A구간, 경계옹벽선"
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                      />
                    </div>
                  )}

                  {/* 2. Facility / Category */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center justify-between">
                      <span className="text-sky-600 dark:text-sky-400">시설 / 공종 구분 (CATEGORY)</span>
                      <span className="text-[10px] text-slate-400 font-normal">필드: CATEGORY</span>
                    </label>
                    <input
                      type="text"
                      value={category}
                      onChange={e => setCategory(e.target.value)}
                      placeholder="예: 상수관, 하수관, 도로경계, 옹벽"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    />
                    {/* Quick Preset Buttons */}
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {CATEGORY_PRESETS.slice(0, 7).map(cp => (
                        <button
                          key={cp}
                          type="button"
                          onClick={() => setCategory(cp)}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-sky-50 dark:hover:bg-sky-950 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition"
                        >
                          {cp}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 3. Specification / Diameter */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center justify-between">
                      <span className="text-amber-600 dark:text-amber-400">규격 / 관경 (SPEC)</span>
                      <span className="text-[10px] text-slate-400 font-normal">필드: SPEC</span>
                    </label>
                    <input
                      type="text"
                      value={spec}
                      onChange={e => setSpec(e.target.value)}
                      placeholder="예: D100, D150, B300xH300, 폭 6m"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {SPEC_PRESETS.slice(0, 7).map(sp => (
                        <button
                          key={sp}
                          type="button"
                          onClick={() => setSpec(sp)}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-amber-50 dark:hover:bg-amber-950 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition"
                        >
                          {sp}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 4. Material */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center justify-between">
                      <span>재질 (MATERIAL)</span>
                      <span className="text-[10px] text-slate-400 font-normal">필드: MATERIAL</span>
                    </label>
                    <input
                      type="text"
                      value={material}
                      onChange={e => setMaterial(e.target.value)}
                      placeholder="예: PE, PVC, DIP(주철관), RC, 아스콘"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    />
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {MATERIAL_PRESETS.slice(0, 5).map(mp => (
                        <button
                          key={mp}
                          type="button"
                          onClick={() => setMaterial(mp)}
                          className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 transition"
                        >
                          {mp}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 5. Depth */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center justify-between">
                      <span>매설심도 / 높이 (DEPTH, m)</span>
                      <span className="text-[10px] text-slate-400 font-normal">필드: DEPTH</span>
                    </label>
                    <input
                      type="number"
                      step="0.001"
                      value={depth}
                      onChange={e => setDepth(e.target.value)}
                      placeholder="예: 1.200 (미터 단위)"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs font-mono rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    />
                  </div>

                  {/* 6. Survey Date */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-slate-400" />
                      <span>조사일자 (SURV_DATE)</span>
                    </label>
                    <input
                      type="date"
                      value={surveyDate}
                      onChange={e => setSurveyDate(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    />
                  </div>

                  {/* 7. Surveyor */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center gap-1">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>조사자 / 담당자 (SURVEYOR)</span>
                    </label>
                    <input
                      type="text"
                      value={surveyor}
                      onChange={e => setSurveyor(e.target.value)}
                      placeholder="예: 현장조사 1팀 / 홍길동"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    />
                  </div>

                  {/* 8. Status */}
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1 flex items-center gap-1">
                      <Activity className="w-3 h-3 text-slate-400" />
                      <span>시설 상태 (STATUS)</span>
                    </label>
                    <select
                      value={status}
                      onChange={e => setStatus(e.target.value)}
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    >
                      {STATUS_PRESETS.map(st => (
                        <option key={st} value={st}>{st}</option>
                      ))}
                    </select>
                  </div>

                  {/* 9. Remarks */}
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1">
                      현장 조사 비고 (REMARK)
                    </label>
                    <input
                      type="text"
                      value={remark}
                      onChange={e => setRemark(e.target.value)}
                      placeholder="예: 도로 횡단 구간, 밸브실 점검 필요, 표고차 0.45m 확인"
                      className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
                    />
                  </div>
                </div>

                {/* Custom User OD Fields */}
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        사용자 정의 OD 속성 필드 추가
                      </h4>
                      <p className="text-[10px] text-slate-500">
                        오토캐드 맵에서 원하는 추가 속성 컬럼(필드)을 자유롭게 확장할 수 있습니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={handleAddCustomField}
                      className="flex items-center gap-1 px-2.5 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs rounded-xl transition"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>필드 추가</span>
                    </button>
                  </div>

                  {customFields.length > 0 && (
                    <div className="space-y-2">
                      {customFields.map((cf, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="속성명 (예: 관리번호, 압력)"
                            value={cf.key}
                            onChange={e => handleUpdateCustomField(idx, 'key', e.target.value)}
                            className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <input
                            type="text"
                            placeholder="속성값 (예: 2026-PIPE-09, 0.5MPa)"
                            value={cf.value}
                            onChange={e => handleUpdateCustomField(idx, 'value', e.target.value)}
                            className="flex-[2] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveCustomField(idx)}
                            className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg transition"
                            title="삭제"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* AutoCAD Map 3D Compatibility Guide */}
                <div className="p-3 bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-xl text-[11px] text-slate-600 dark:text-slate-300 flex items-start gap-2 leading-relaxed">
                  <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-sky-600 dark:text-sky-400">오토캐드 맵(AutoCAD Map 3D) OD 연동 팁:</span>
                    <p className="mt-0.5 text-slate-500 dark:text-slate-400">
                      SHP 내보내기 후 캐드 맵에서 <code className="bg-slate-200 dark:bg-slate-800 px-1 py-0.5 rounded text-sky-600 dark:text-sky-400 font-mono">MAPIMPORT</code> 명령을 실행하고, 
                      가져오기 창의 <strong>[데이터]</strong> 항목에서 <strong>'객체 데이터(OD) 생성'</strong>을 선택하면 위에서 입력한 모든 현장 조사 속성이 캐드 도면 객체의 Object Data 테이블로 즉시 연동됩니다.
                    </p>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-semibold rounded-xl transition"
                  >
                    취소
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-sky-600/30 transition flex items-center gap-1.5 active:scale-95"
                  >
                    <Check className="w-4 h-4" />
                    <span>선 속성(OD) 저장 및 적용</span>
                  </button>
                </div>
              </>
            )}
          </form>
        )}

        {/* Tab 2: All Lines Table Mode */}
        {activeTab === 'table' && (
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/20 dark:bg-slate-900/40">
            {/* Search & Actions Bar */}
            <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-white dark:bg-slate-950/60">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="선 명칭, 시설종류, 레이어, 규격, 재질 검색..."
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden sm:flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs">
                  <span className="text-[11px] text-slate-400">파일명:</span>
                  <input
                    type="text"
                    value={odCsvFileName}
                    onChange={e => setOdCsvFileName(e.target.value)}
                    placeholder="OD 대장 파일명"
                    className="bg-transparent text-slate-900 dark:text-white text-xs outline-none w-36 font-medium"
                  />
                  <span className="text-[10px] text-slate-400 font-mono">.csv</span>
                </div>

                <button
                  onClick={handleExportODCSV}
                  disabled={allLinesList.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-sm transition"
                  title="모든 선의 길이 및 OD 속성을 CSV로 저장"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>OD 대장 CSV 저장</span>
                </button>
              </div>
            </div>

            {/* Layer-by-Layer Length Summary */}
            {allLinesList.length > 0 && (
              <div className="px-3 pb-3 bg-white dark:bg-slate-950/40">
                <div className="p-2.5 bg-slate-50/50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800 rounded-xl flex flex-wrap gap-x-4 gap-y-2 items-center">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 pr-2 border-r border-slate-200 dark:border-slate-700">
                    <Layers className="w-3.5 h-3.5" />
                    <span>레이어별 집계:</span>
                  </div>
                  {layerSummary.map(([layerId, stats]) => (
                    <div key={layerId} className="flex items-center gap-2 text-[11px]">
                      <span className="text-slate-400 font-mono">{layerId.replace(/^layer-/, '')}:</span>
                      <span className="font-bold text-sky-600 dark:text-sky-400 font-mono">{stats.length.toFixed(3)}m</span>
                      <span className="text-[10px] text-slate-400">({stats.count}개)</span>
                    </div>
                  ))}
                  <div className="ml-auto flex items-center gap-2 text-[11px] bg-sky-100 dark:bg-sky-900/40 px-2 py-0.5 rounded-lg border border-sky-200 dark:border-sky-800">
                    <span className="font-bold text-sky-700 dark:text-sky-300 uppercase">전체 합계:</span>
                    <strong className="font-mono text-sky-700 dark:text-sky-300">{totalLength.toFixed(3)}m</strong>
                  </div>
                </div>
              </div>
            )}

            {/* Table */}
            <div className="flex-1 overflow-auto custom-scrollbar bg-white dark:bg-slate-900">
              {filteredLines.length === 0 ? (
                <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-xs">
                  등록된 선/폴리라인 객체가 없습니다. 도면에서 [연속선] 또는 [직선] 도구로 선을 그려보세요.
                </div>
              ) : (
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-200 dark:border-slate-800 text-[11px]">
                    <tr>
                      <th className="py-2 px-3 w-12 text-center">번호</th>
                      <th className="py-2 px-3">선 명칭</th>
                      <th className="py-2 px-3">구분</th>
                      <th className="py-2 px-3">연장 (Length)</th>
                      <th className="py-2 px-3 text-sky-600 dark:text-sky-400">시설구분</th>
                      <th className="py-2 px-3">규격/관경</th>
                      <th className="py-2 px-3">재질</th>
                      <th className="py-2 px-3">심도(m)</th>
                      <th className="py-2 px-3">상태</th>
                      <th className="py-2 px-3 text-right">관리</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                    {filteredLines.map((l, idx) => {
                      const a = l.attributes || {};
                      const hasAttrs = Object.keys(a).length > 0;

                      return (
                        <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition">
                          <td className="py-2 px-3 text-center text-slate-400 font-mono text-[10px]">{idx + 1}</td>
                          <td className="py-2 px-3 font-semibold text-slate-900 dark:text-white">
                            {l.name}
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-500">
                            {l.isPolyline ? '연속선' : '단일선'}
                          </td>
                          <td className="py-2 px-3 font-mono text-sky-600 dark:text-sky-400 font-semibold">
                            {l.length.toFixed(3)}m
                          </td>
                          <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                            {a.CATEGORY || a.시설구분 || <span className="text-slate-400 italic">미입력</span>}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">
                            {a.SPEC || a.규격 || '-'}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                            {a.MATERIAL || a.재질 || '-'}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600 dark:text-slate-300">
                            {a.DEPTH !== undefined ? `${a.DEPTH}m` : '-'}
                          </td>
                          <td className="py-2 px-3">
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                              {a.STATUS || '미입력'}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {onFocusLine && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onFocusLine(l.points);
                                    onClose();
                                  }}
                                  className="p-1 rounded-lg text-slate-400 hover:text-sky-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                                  title="캔버스 중심 이동"
                                >
                                  <Crosshair className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedIds([l.id]);
                                  setActiveTab('inspect');
                                }}
                                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 hover:bg-sky-100 dark:hover:bg-sky-900 border border-sky-200 dark:border-sky-800 text-[11px] font-semibold transition"
                              >
                                <Edit3 className="w-3 h-3" />
                                <span>OD 속성</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
