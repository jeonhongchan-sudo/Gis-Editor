/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Plus, X, Palette, CheckCircle2, Trash2, Edit2, Check } from 'lucide-react';
import { CADLayer } from '../types/cad';

interface LayerPanelProps {
  layers: CADLayer[];
  activeLayerId: string;
  onSetActiveLayerId: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onToggleLock: (id: string) => void;
  onChangeColor: (id: string, color: string) => void;
  onRenameLayer: (id: string, newName: string) => void;
  onAddLayer: (name: string, color: string) => void;
  onDeleteLayer: (id: string) => void;
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
  onRenameLayer,
  onAddLayer,
  onDeleteLayer,
  onClose
}) => {
  const [newLayerName, setNewLayerName] = useState('');
  const [newLayerColor, setNewLayerColor] = useState('#38bdf8');
  const [colorPickerLayerId, setColorPickerLayerId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingLayerId, setEditingLayerId] = useState<string | null>(null);
  const [tempLayerName, setTempLayerName] = useState('');

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLayerName.trim()) return;
    onAddLayer(newLayerName.trim(), newLayerColor);
    setNewLayerName('');
  };

  const handleStartEdit = (layer: CADLayer) => {
    setEditingLayerId(layer.id);
    setTempLayerName(layer.name);
  };

  const handleSaveEdit = (id: string) => {
    if (tempLayerName.trim()) {
      onRenameLayer(id, tempLayerName.trim());
    }
    setEditingLayerId(null);
  };

  return (
    <div className="absolute top-14 sm:top-20 right-2 sm:right-3 z-30 w-80 max-w-[calc(100vw-16px)] bg-white dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl p-3 sm:p-4 flex flex-col gap-3 animate-in fade-in zoom-in-95 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">CAD 도면 레이어</h2>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">도면층 표시/숨김, 이름 변경 및 삭제</p>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Layer List */}
      <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1 custom-scrollbar text-slate-900 dark:text-slate-100">
        {layers.map(layer => {
          const isActive = layer.id === activeLayerId;
          const isEditing = editingLayerId === layer.id;

          if (confirmDeleteId === layer.id) {
            return (
              <div
                key={layer.id}
                className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800/80 flex flex-col gap-1.5 animate-in fade-in duration-150"
              >
                <div className="flex items-center gap-1.5 text-red-700 dark:text-red-300 font-semibold text-xs">
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">'{layer.name}' 삭제하시겠습니까?</span>
                </div>
                <p className="text-[10px] text-red-600/80 dark:text-red-400 leading-tight">
                  이 레이어에 있는 객체는 기본 레이어로 안전하게 자동 이동됩니다.
                </p>
                <div className="flex items-center justify-end gap-1.5 mt-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId(null);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-medium hover:bg-slate-300 dark:hover:bg-slate-700 transition"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteLayer(layer.id);
                      setConfirmDeleteId(null);
                    }}
                    className="px-2.5 py-1 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-500 transition shadow-sm shadow-red-600/20"
                  >
                    삭제
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div
              key={layer.id}
              onClick={() => onSetActiveLayerId(layer.id)}
              className={`group flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                isActive 
                  ? 'bg-sky-50 dark:bg-sky-900/30 border-sky-200 dark:border-sky-500/50 shadow-sm shadow-sky-500/10' 
                  : 'bg-white dark:bg-slate-800/40 border-slate-100 dark:border-slate-800/60 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-200 dark:hover:border-slate-700'
              }`}
            >
              {/* Left: Indicator & Name */}
              <div className="flex items-center gap-2.5 overflow-hidden flex-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setColorPickerLayerId(colorPickerLayerId === layer.id ? null : layer.id);
                  }}
                  className="w-4 h-4 rounded-full border border-slate-300 dark:border-slate-600 shrink-0 hover:scale-110 transition shadow-inner"
                  style={{ backgroundColor: layer.color }}
                  title="색상 변경"
                />
                
                {isEditing ? (
                  <input
                    autoFocus
                    type="text"
                    value={tempLayerName}
                    onChange={e => setTempLayerName(e.target.value)}
                    onBlur={() => handleSaveEdit(layer.id)}
                    onKeyDown={e => e.key === 'Enter' && handleSaveEdit(layer.id)}
                    onClick={e => e.stopPropagation()}
                    className="bg-white dark:bg-slate-900 border border-sky-500 text-slate-900 dark:text-slate-100 text-xs rounded px-1.5 py-0.5 outline-none w-full"
                  />
                ) : (
                  <div className="flex flex-col overflow-hidden">
                    <span className={`text-xs font-semibold truncate ${isActive ? 'text-sky-700 dark:text-sky-300' : 'text-slate-700 dark:text-slate-300'}`}>
                      {layer.name}
                    </span>
                    {isActive && (
                      <span className="text-[9px] text-sky-500 dark:text-sky-400 font-medium">현재 작업 레이어</span>
                    )}
                  </div>
                )}
              </div>

              {/* Right: Actions */}
              <div className="flex items-center gap-1 shrink-0 ml-1">
                {/* Rename */}
                {!isEditing && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStartEdit(layer);
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-sky-600 dark:hover:text-sky-400 hover:bg-white dark:hover:bg-slate-800 transition opacity-0 group-hover:opacity-100"
                    title="이름 변경"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                )}

                {/* Visibility */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(layer.id);
                  }}
                  className={`p-1 rounded-lg transition ${
                    layer.visible ? 'text-slate-500 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white' : 'text-slate-300 dark:text-slate-600 hover:text-slate-50 dark:hover:text-slate-400'
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
                    layer.locked ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                  title={layer.locked ? '잠금 해제' : '레이어 잠금'}
                >
                  {layer.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                </button>

                {/* Delete Layer */}
                <button
                  type="button"
                  disabled={layers.length <= 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (layers.length > 1) {
                      setConfirmDeleteId(layer.id);
                    }
                  }}
                  className={`p-1 rounded-lg transition ${
                    layers.length <= 1
                      ? 'text-slate-300 dark:text-slate-700 cursor-not-allowed opacity-30'
                      : 'text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40'
                  }`}
                  title={layers.length <= 1 ? '최소 1개의 기본 레이어가 필요합니다' : '레이어 삭제'}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Color picker popup if open */}
      {colorPickerLayerId && (
        <div className="p-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl flex flex-wrap items-center justify-center gap-1 shadow-lg animate-in slide-in-from-top-1 duration-150">
          {PALETTE.map(c => (
            <button
              key={c}
              onClick={() => {
                onChangeColor(colorPickerLayerId, c);
                setColorPickerLayerId(null);
              }}
              style={{ backgroundColor: c }}
              className="w-6 h-6 rounded-full border border-slate-200 dark:border-slate-600 hover:scale-110 transition shadow-sm"
            />
          ))}
          <button 
            onClick={() => setColorPickerLayerId(null)}
            className="p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Add New Layer Form */}
      <form onSubmit={handleCreate} className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center gap-1.5">
        <input
          type="text"
          placeholder="새 레이어명 (예: 경계선, 도로)"
          value={newLayerName}
          onChange={e => setNewLayerName(e.target.value)}
          className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-200 text-xs rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500 shadow-sm"
        />
        <div className="relative">
          <input
            type="color"
            value={newLayerColor}
            onChange={e => setNewLayerColor(e.target.value)}
            className="w-8 h-8 rounded-xl bg-transparent border-0 cursor-pointer p-0 overflow-hidden"
            title="레이어 색상 선택"
          />
        </div>
        <button
          type="submit"
          disabled={!newLayerName.trim()}
          className="p-2 bg-sky-600 hover:bg-sky-500 disabled:bg-slate-100 dark:disabled:bg-slate-800 disabled:text-slate-300 dark:disabled:text-slate-600 text-white rounded-xl transition shadow-sm"
          title="레이어 추가"
        >
          <Plus className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
};
