/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { X, Search, Trash2, Crosshair, Download } from 'lucide-react';
import { CADPoint } from '../types/cad';
import { downloadTextFile } from '../utils/downloadHelper';

interface PointTableModalProps {
  points: CADPoint[];
  onDeletePoint: (id: string) => void;
  onClearAllPoints: () => void;
  onFocusPoint: (point: CADPoint) => void;
  onClose: () => void;
}

export const PointTableModal: React.FC<PointTableModalProps> = ({
  points,
  onDeletePoint,
  onClearAllPoints,
  onFocusPoint,
  onClose
}) => {
  const [search, setSearch] = useState('');

  const filteredPoints = useMemo(() => {
    if (!search.trim()) return points;
    const q = search.toLowerCase();
    return points.filter(p => 
      p.name.toLowerCase().includes(q) || 
      p.id.toLowerCase().includes(q)
    );
  }, [points, search]);

  const handleExportCSV = () => {
    const lines = ['ID,측점명,X(캐드_동향),Y(캐드_북향),고도(Z),레이어'];
    points.forEach((p, i) => {
      lines.push(`${i + 1},"${p.name}",${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z !== undefined ? p.z.toFixed(4) : ''},"${p.layerId}"`);
    });
    downloadTextFile(lines.join('\n'), 'survey_points_cad.csv', 'text/csv');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[85vh] bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <span>측점 좌표 데이터 관리</span>
              <span className="text-xs bg-sky-950 text-sky-400 border border-sky-800 px-2 py-0.5 rounded-full">
                총 {points.length}개 측점
              </span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              업로드 및 생성된 측점 좌표 목록을 검색하고 특정 좌표로 화면을 이동할 수 있습니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar: Search and Bulk actions */}
        <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="측점명 또는 번호 검색..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:ring-1 focus:ring-sky-500"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportCSV}
              disabled={points.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs rounded-xl border border-slate-700 transition"
            >
              <Download className="w-3.5 h-3.5" />
              CSV 저장
            </button>

            <button
              onClick={() => {
                if (confirm('모든 측점을 삭제하시겠습니까? (연결된 선은 유지됩니다)')) {
                  onClearAllPoints();
                }
              }}
              disabled={points.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/80 hover:bg-red-900 border border-red-800/80 disabled:opacity-50 text-red-300 text-xs rounded-xl transition"
            >
              <Trash2 className="w-3.5 h-3.5" />
              전체 측점 삭제
            </button>
          </div>
        </div>

        {/* Table Body */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          {filteredPoints.length === 0 ? (
            <div className="p-12 text-center text-slate-500 text-xs">
              등록된 측점 데이터가 없습니다. CSV 파일 또는 샘플 데이터를 불러와보세요.
            </div>
          ) : (
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3 w-16">번호</th>
                  <th className="py-2.5 px-3 font-sans">측점명</th>
                  <th className="py-2.5 px-3">X 좌표 (Easting)</th>
                  <th className="py-2.5 px-3">Y 좌표 (Northing)</th>
                  <th className="py-2.5 px-3">고도 (Z)</th>
                  <th className="py-2.5 px-3 text-right font-sans">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {filteredPoints.map((pt, idx) => (
                  <tr key={pt.id} className="hover:bg-slate-800/40 transition group">
                    <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-2 px-3 font-sans font-medium text-white">{pt.name}</td>
                    <td className="py-2 px-3 text-sky-400">{pt.x.toFixed(3)}</td>
                    <td className="py-2 px-3 text-sky-400">{pt.y.toFixed(3)}</td>
                    <td className="py-2 px-3 text-slate-400">{pt.z !== undefined ? pt.z.toFixed(2) : '-'}</td>
                    <td className="py-2 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => {
                            onFocusPoint(pt);
                            onClose();
                          }}
                          className="p-1 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-slate-800 transition"
                          title="해당 측점으로 캔버스 중심 이동"
                        >
                          <Crosshair className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeletePoint(pt.id)}
                          className="p-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800 transition"
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
