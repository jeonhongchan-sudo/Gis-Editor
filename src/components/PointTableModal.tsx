/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { X, Search, Trash2, Crosshair, Download, Edit2, Check } from 'lucide-react';
import { CADPoint } from '../types/cad';
import { downloadTextFile } from '../utils/downloadHelper';

interface PointTableModalProps {
  points: CADPoint[];
  onDeletePoint: (id: string) => void;
  onUpdatePoint: (id: string, updates: Partial<CADPoint>) => void;
  onClearAllPoints: () => void;
  onFocusPoint: (point: CADPoint) => void;
  onClose: () => void;
}

export const PointTableModal: React.FC<PointTableModalProps> = ({
  points,
  onDeletePoint,
  onUpdatePoint,
  onClearAllPoints,
  onFocusPoint,
  onClose
}) => {
  const [search, setSearch] = useState('');
  const [editingPtId, setEditingPtId] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<'name' | null>(null);
  const [tempVal, setTempVal] = useState('');

  const filteredPoints = useMemo(() => {
    if (!search.trim()) return points;
    const q = search.toLowerCase();
    return points.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.id.toLowerCase().includes(q)
    );
  }, [points, search]);

  const [csvFileName, setCsvFileName] = useState(() => `survey_points_${new Date().toISOString().slice(0, 10)}`);

  const handleExportCSV = () => {
    const lines = ['번호,측점명,X(캐드_동향),Y(캐드_북향),고도(Z),레이어'];
    points.forEach((p, i) => {
      lines.push(`${i + 1},"${p.name}",${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z !== undefined ? p.z.toFixed(3) : ''},"${p.layerId}"`);
    });
    const cleanName = (csvFileName.trim() || `survey_points_${new Date().toISOString().slice(0, 10)}`).replace(/\.csv$/i, '');
    downloadTextFile(lines.join('\n'), `${cleanName}.csv`, 'utf-8-bom', 'text/csv');
  };

  const handleStartEdit = (pt: CADPoint, field: 'name') => {
    setEditingPtId(pt.id);
    setEditingField(field);
    setTempVal((pt as any)[field] || '');
  };

  const handleSaveEdit = (id: string) => {
    if (editingField) {
      onUpdatePoint(id, { [editingField]: tempVal.trim() });
    }
    setEditingPtId(null);
    setEditingField(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-6xl max-h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <span>측점 통합 데이터베이스 관리</span>
              <span className="text-xs bg-sky-50 dark:bg-sky-950 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 px-2 py-0.5 rounded-full">
                총 {points.length}개 측점
              </span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              DXF/SHP/CSV 통합 데이터: 측점명 편집 및 검색
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar: Search and Bulk actions */}
        <div className="p-3 bg-slate-50 dark:bg-slate-950/60 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="측점명 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-200 text-xs rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
            />
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 text-xs shadow-sm">
              <span className="text-[11px] text-slate-400">파일명:</span>
              <input
                type="text"
                value={csvFileName}
                onChange={e => setCsvFileName(e.target.value)}
                placeholder="CSV 파일명"
                className="bg-transparent text-slate-900 dark:text-white text-xs outline-none w-36 font-medium"
              />
              <span className="text-[10px] text-slate-400 font-mono">.csv</span>
            </div>

            <button
              onClick={handleExportCSV}
              disabled={points.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl transition shadow-md shadow-emerald-600/20"
            >
              <Download className="w-3.5 h-3.5" />
              <span>전체 데이터 CSV 내보내기</span>
            </button>

            <button
              onClick={() => {
                if (confirm('모든 측점을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) {
                  onClearAllPoints();
                }
              }}
              disabled={points.length === 0}
              className="flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 border border-red-200 dark:border-red-900/50 text-red-600 dark:text-red-400 text-xs font-bold rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition shadow-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">전체 삭제</span>
            </button>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-auto custom-scrollbar bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
          {filteredPoints.length === 0 ? (
            <div className="p-12 text-center text-slate-400 dark:text-slate-500 text-xs flex flex-col items-center gap-3">
              <Crosshair className="w-12 h-12 opacity-10" />
              <div>
                <p className="font-bold">등록된 측점 데이터가 없습니다.</p>
                <p className="mt-1 opacity-70">DXF/SHP/CSV 파일을 불러오거나 수동으로 측점을 추가해 주세요.</p>
                {search && <p className="mt-2 text-sky-500">검색어 "{search}"에 대한 결과가 없습니다.</p>}
              </div>
            </div>
          ) : (
            <table className="w-full text-left text-[11px] font-mono border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-950 text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-200 dark:border-slate-800 shadow-sm z-10">
                <tr>
                  <th className="py-2.5 px-3 w-12 text-center">No.</th>
                  <th className="py-2.5 px-3 font-sans min-w-[140px]">측점명 (Name)</th>
                  <th className="py-2.5 px-3">X (Easting)</th>
                  <th className="py-2.5 px-3">Y (Northing)</th>
                  <th className="py-2.5 px-3">Z (Elev)</th>
                  <th className="py-2.5 px-3 text-right font-sans w-20">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                {filteredPoints.map((pt, idx) => (
                  <tr key={pt.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition group">
                    <td className="py-2 px-3 text-slate-400 dark:text-slate-500 text-center">{idx + 1}</td>
                    
                    {/* Name Cell */}
                    <td className="py-2 px-3 font-sans font-medium text-slate-900 dark:text-white">
                      {editingPtId === pt.id && editingField === 'name' ? (
                        <div className="flex items-center gap-1">
                          <input
                            autoFocus
                            type="text"
                            value={tempVal}
                            onChange={e => setTempVal(e.target.value)}
                            onBlur={() => handleSaveEdit(pt.id)}
                            onKeyDown={e => e.key === 'Enter' && handleSaveEdit(pt.id)}
                            className="bg-white dark:bg-slate-950 border border-sky-500 text-xs rounded px-1.5 py-0.5 outline-none w-full shadow-sm"
                          />
                        </div>
                      ) : (
                        <div className="flex items-center justify-between group/cell">
                          <span className="truncate max-w-[150px]">{pt.name}</span>
                          <button onClick={() => handleStartEdit(pt, 'name')} className="p-1 text-slate-300 hover:text-sky-500 opacity-0 group-hover/cell:opacity-100 transition"><Edit2 className="w-3 h-3"/></button>
                        </div>
                      )}
                    </td>

                    <td className="py-2 px-3 text-sky-600 dark:text-sky-400 font-mono text-[10px]">{pt.x.toFixed(3)}</td>
                    <td className="py-2 px-3 text-sky-600 dark:text-sky-400 font-mono text-[10px]">{pt.y.toFixed(3)}</td>
                    <td className="py-2 px-3 text-slate-400 dark:text-slate-500 font-mono text-[10px]">{pt.z !== undefined ? pt.z.toFixed(3) : '-'}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-0.5">
                        <button
                          onClick={() => {
                            onFocusPoint(pt);
                            onClose();
                          }}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                          title="해당 측점으로 화면 이동"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeletePoint(pt.id)}
                          className="p-1.5 rounded-lg text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                          title="삭제"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
