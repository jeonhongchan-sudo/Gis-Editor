/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { X, Check, MapPin, Hash } from 'lucide-react';
import { CADPoint } from '../types/cad';

interface ManualPointModalProps {
  onAdd: (point: CADPoint) => void;
  onClose: () => void;
  activeLayerId: string;
  nextPointNumber: number;
}

export const ManualPointModal: React.FC<ManualPointModalProps> = ({ 
  onAdd, 
  onClose, 
  activeLayerId,
  nextPointNumber 
}) => {
  const [name, setName] = useState(`측점_${nextPointNumber}`);
  const [x, setX] = useState('');
  const [y, setY] = useState('');
  const [z, setZ] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const numX = parseFloat(x);
    const numY = parseFloat(y);
    const numZ = z.trim() ? parseFloat(z) : undefined;

    if (isNaN(numX) || isNaN(numY)) {
      alert('유효한 X, Y 좌표를 입력해 주세요.');
      return;
    }

    onAdd({
      id: `point-${Date.now()}`,
      name: name.trim() || `측점_${nextPointNumber}`,
      x: numX,
      y: numY,
      z: numZ,
      layerId: activeLayerId,
      isSurveyNode: false
    });
    
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 flex items-center justify-center text-sky-600 dark:text-sky-400">
              <MapPin className="w-5 h-5" />
            </div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">좌표 직접 입력 측점 생성</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1">측점명 (Label)</label>
            <div className="relative">
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm rounded-xl p-2.5 pl-3 focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder="예: 측점_101"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] text-sky-600 dark:text-sky-400 font-bold ml-1 flex items-center gap-1">
                <Hash className="w-3 h-3" />
                <span>CAD X (동향)</span>
                <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.001"
                value={x}
                onChange={e => setX(e.target.value)}
                required
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm font-mono rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder="0.000"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-sky-600 dark:text-sky-400 font-bold ml-1 flex items-center gap-1">
                <Hash className="w-3 h-3" />
                <span>CAD Y (북향)</span>
                <span className="text-red-500 dark:text-red-400">*</span>
              </label>
              <input
                type="number"
                step="0.001"
                value={y}
                onChange={e => setY(e.target.value)}
                required
                className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-sm font-mono rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
                placeholder="0.000"
              />
            </div>
          </div>

          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] text-slate-500 dark:text-slate-400 font-bold ml-1">표고 (Optional Z)</label>
            <input
              type="number"
              step="0.001"
              value={z}
              onChange={e => setZ(e.target.value)}
              className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-200 text-sm font-mono rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="미입력 시 제외"
            />
          </div>

          <div className="pt-4 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 px-4 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl transition"
            >
              취소
            </button>
            <button
              type="submit"
              className="flex-[2] py-2.5 px-4 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl shadow-lg shadow-sky-600/30 transition flex items-center justify-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>측점 생성 및 배치</span>
            </button>
          </div>
        </form>

        <div className="p-3 bg-slate-50/50 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 text-center">
          좌표를 입력하면 도면의 해당 위치에 즉시 측점이 생성됩니다.
        </div>
      </div>
    </div>
  );
};
