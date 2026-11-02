/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Plus, X, Palette, CheckCircle2 } from 'lucide-react';
import { CADLayer } from '../types/cad';

interface LayerPanelProps {
  layers: CADLayer[];
  activeLayerId: string;
  onSetActiveLayerId: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onChangeColor: (id: string, color: string) => void;
  onAddLayer: (name: string, color: string) => void;
  onClose: () => void;
}

const PALETTE = [
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#ffffff', // White
  '#94a3b8'  // Gray
];

export const LayerPanel: React.FC<LayerPanelProps> = ({
  layers,
  activeLayerId,
  onSetActiveLayerId,
  onToggleVisible,
  onToggleLock,
  onChangeColor,
  onAddLayer,
  onClose
}) => {
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerColor, setNewLayerColor] = useState('#38bdf8');
  const [colorPickerLayerId, setColorPickerLayerId] = useState<string | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLayerName.trim()) return;
    onAddLayer(newLayerName.trim(), newLayerColor);
    setNewLayerName('');
  };

  return (
    <div className="absolute top-14 sm:top-20 right-2 sm:right-3 z-30 w-80 max-w-[calc(100vw-16px)] bg-slate-900/95 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl p-3 sm:p-4 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-100">CAD 도면 레이어</h2>
          <p className="text-[11px] text-slate-400">도면층 표시/숨김 및 색상 관리</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Layer List */}
      <div className="max-h-64 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
        {layers.map(layer => {
          const isActive = layer.id === activeLayerId;

          return (
            <div
              key={layer.id}
              onClick={() => onSetActiveLayerId(layer.id)}
              className={`flex items-center justify-between p-2 rounded-xl text-xs cursor-pointer transition ${
                isActive
                  ? 'bg-sky-950/60 border border-sky-500/50 text-white'
                  : 'hover:bg-slate-800/80 text-slate-300 border border-transparent'
              }`}
            >
              {/* Left: Active Check & Color Swatch & Name */}
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className="w-3.5 h-3.5 rounded-full shrink-0 border border-slate-600 shadow-sm relative group cursor-pointer"
                  style={{ backgroundColor: layer.color }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerLayerId(colorPickerLayerId === layer.id ? null : layer.id);
                  }}
                  title="색상 변경"
                />

                <span className="truncate font-medium">
                  {layer.name}
                </span>

                {isActive && (
                  <span className="text-[10px] bg-sky-500/20 text-sky-400 px-1 rounded shrink-0">
                    작업중
                  </span>
                )}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Visibility */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(layer.id);
                  }}
                  className={`p-1 rounded-lg transition ${
                    layer.visible ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-400'
                  }`}
                  title={layer.visible ? '레이어 숨기기' : '레이어 표시'}
                >
                  {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>

                {/* Lock */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleLock(layer.id);
                  }}
                  className={`p-1 rounded-lg transition ${
                    layer.locked ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
                  }`}
                  title={layer.locked ? '잠금 해제' : '레이어 잠금'}
                >
                  {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Color picker popup if open */}
      {colorPickerLayerId && (
        <div className="p-2 bg-slate-950 border border-slate-700 rounded-xl flex items-center justify-between gap-1">
          {PALETTE.map(c => (
            <button
              key={c}
              onClick={() => {
                onChangeColor(colorPickerLayerId, c);
                setColorPickerLayerId(null);
              }}
              style={{ backgroundColor: c }}
              className="w-5 h-5 rounded-full border border-slate-600 hover:scale-110 transition"
            />
          ))}
        </div>
      )}

      {/* Add New Layer Form */}
      <form onSubmit={handleCreate} className="pt-2 border-t border-slate-800 flex items-center gap-1.5">
        <input
          type="text"
          placeholder="새 레이어명 (예: 경계선, 도로)"
          value={newLayerName}
          onChange={e => setNewLayerName(e.target.value)}
          className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500"
        />
        <input
          type="color"
          value={newLayerColor}
          onChange={e => setNewLayerColor(e.target.value)}
          className="w-8 h-8 rounded-xl bg-transparent border-0 cursor-pointer"
          title="레이어 색상 선택"
        />
        <button
          type="submit"
          disabled={!newLayerName.trim()}
          className="p-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-800 disabled:text-slate-600 text-white rounded-xl transition"
          title="레이어 추가"
        >
          <Plus className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
