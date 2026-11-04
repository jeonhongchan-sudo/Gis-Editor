/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  MousePointer, 
  Hand, 
  Spline, 
  Minus, 
  Pentagon, 
  MapPin, 
  Ruler, 
  Magnet, 
  RotateCcw, 
  RotateCw, 
  Focus, 
  Check, 
  X,
  ChevronUp,
  ChevronDown,
  CheckSquare
} from 'lucide-react';
import { ToolMode } from '../types/cad';

interface ToolbarProps {
  tool: ToolMode;
  setTool: (tool: ToolMode) => void;
  snapEnabled: boolean;
  setSnapEnabled: (val: boolean | ((prev: boolean) => boolean)) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onZoomExtents: () => void;
  activePointsCount: number;
  onFinishDrawing: () => void;
  onCancelDrawing: () => void;
  multiSelectMode?: boolean;
  setMultiSelectMode?: (val: boolean | ((prev: boolean) => boolean)) => void;
  onOpenManualPoint: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  setTool,
  snapEnabled,
  setSnapEnabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomExtents,
  activePointsCount,
  onFinishDrawing,
  onCancelDrawing,
  multiSelectMode = false,
  setMultiSelectMode,
  onOpenManualPoint
}) => {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  return (
    <>
      {/* 1. Desktop & Tablet Floating Dock (Left Side, sm:flex) */}
      <div className="hidden sm:flex absolute left-3 top-20 z-20 flex-col gap-1.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700/80 p-1.5 rounded-2xl shadow-2xl">
        {/* Pointer / Select */}
        <button
          onClick={() => setTool('select')}
          title="객체 다중 선택 (마우스 드래그로 영역 상자 선택 / Shift+클릭)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'select'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <MousePointer className="w-5 h-5" />
        </button>

        {/* Pan */}
        <button
          onClick={() => setTool('pan')}
          title="화면 이동 (Shift+드래그 시 바로 영역 선택)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'pan'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Hand className="w-5 h-5" />
        </button>

        {/* Multi-Select Mode Toggle (터치/클릭마다 누적 선택) */}
        <button
          onClick={() => setMultiSelectMode?.(prev => !prev)}
          title={multiSelectMode ? "다중 선택 모드 켜짐 (터치/클릭할 때마다 추가) - 클릭하여 끄기" : "다중 선택 모드 (스마트폰/PC에서 Shift 없이 터치/클릭마다 추가 선택)"}
          className={`p-2.5 rounded-xl transition flex items-center justify-center relative ${
            multiSelectMode
              ? 'bg-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/30'
              : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <CheckSquare className="w-5 h-5" />
          {multiSelectMode && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-300 rounded-full animate-ping" />
          )}
        </button>

        <div className="w-full h-px bg-slate-200 dark:bg-slate-700/60 my-0.5" />

        {/* Polyline (연속선 드로잉 - 측점 연결) */}
        <button
          onClick={() => {
            if (tool !== 'polyline') onCancelDrawing();
            setTool('polyline');
          }}
          title="연속선 / 측점 연결 (Polyline)"
          className={`relative p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'polyline'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Spline className="w-5 h-5" />
          {tool === 'polyline' && (
            <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-emerald-400 rounded-full animate-pulse" />
          )}
        </button>

        {/* Line (단일선) */}
        <button
          onClick={() => {
            if (tool !== 'line') onCancelDrawing();
            setTool('line');
          }}
          title="단일선 (Line)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'line'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Minus className="w-5 h-5" />
        </button>

        {/* Polygon (면적/폐합 폴리곤) */}
        <button
          onClick={() => {
            if (tool !== 'polygon') onCancelDrawing();
            setTool('polygon');
          }}
          title="면적 폐합 폴리곤 (Polygon)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'polygon'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Pentagon className="w-5 h-5" />
        </button>

        {/* Add Point (수동 측점) */}
        <button
          onClick={() => {
            if (tool !== 'point') onCancelDrawing();
            setTool('point');
          }}
          title="측점 생성 (도면 클릭)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'point'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <MapPin className="w-5 h-5" />
        </button>

        {/* Manual Input (좌표 직접 입력) */}
        <button
          onClick={onOpenManualPoint}
          title="좌표 직접 입력하여 측점 생성"
          className="p-2.5 rounded-xl text-sky-600 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10 hover:text-sky-700 dark:hover:text-sky-300 border border-transparent hover:border-sky-200 dark:hover:border-sky-500/30 transition flex items-center justify-center"
        >
          <div className="relative">
            <MapPin className="w-5 h-5" />
            <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-900 rounded-full p-0.5 border border-sky-300 dark:border-sky-500/50">
              <CheckSquare className="w-2.5 h-2.5" />
            </div>
          </div>
        </button>

        {/* Measure (거리 측정) */}
        <button
          onClick={() => {
            if (tool !== 'measure') onCancelDrawing();
            setTool('measure');
          }}
          title="거리/구간 측정 (Measure)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'measure'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
          }`}
        >
          <Ruler className="w-5 h-5" />
        </button>

        <div className="w-full h-px bg-slate-200 dark:bg-slate-700/60 my-0.5" />

        {/* Snap Toggle */}
        <button
          onClick={() => setSnapEnabled(prev => !prev)}
          title={`자석 스냅 (${snapEnabled ? '켜짐' : '꺼짐'})`}
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            snapEnabled
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
          }`}
        >
          <Magnet className="w-5 h-5" />
        </button>



        <button
          onClick={onZoomExtents}
          title="전체 화면 맞춤"
          className="p-2.5 rounded-xl text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition flex items-center justify-center"
        >
          <Focus className="w-5 h-5" />
        </button>
      </div>

      {/* 2. Mobile Responsive Bottom Dock (< sm) */}
      <div className="sm:hidden fixed bottom-3 left-2 right-2 z-20 flex flex-col items-center">
        {/* Expandable Extra Tools */}
        {mobileExpanded && (
          <div className="mb-2 w-full max-w-sm bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700 p-2 rounded-2xl shadow-2xl flex items-center justify-around gap-1 animate-in slide-in-from-bottom-2 duration-150">
            <button
              onClick={() => { onOpenManualPoint(); setMobileExpanded(false); }}
              className="p-2.5 rounded-xl flex flex-col items-center gap-0.5 text-[10px] text-sky-600 dark:text-sky-400"
            >
              <div className="relative">
                <MapPin className="w-4 h-4" />
                <div className="absolute -bottom-1 -right-1 bg-white dark:bg-slate-950 rounded-full p-0.5 border border-sky-300 dark:border-sky-500/50">
                  <CheckSquare className="w-2 h-2" />
                </div>
              </div>
              <span>좌표입력</span>
            </button>
            <button
              onClick={() => { setTool('point'); setMobileExpanded(false); }}
              className={`p-2.5 rounded-xl flex flex-col items-center gap-0.5 text-[10px] ${tool === 'point' ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-300'}`}
            >
              <MapPin className="w-4 h-4" />
              <span>측점추가</span>
            </button>
            <button
              onClick={() => { setTool('measure'); setMobileExpanded(false); }}
              className={`p-2.5 rounded-xl flex flex-col items-center gap-0.5 text-[10px] ${tool === 'measure' ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-300'}`}
            >
              <Ruler className="w-4 h-4" />
              <span>거리측정</span>
            </button>

            <button
              onClick={() => { onZoomExtents(); setMobileExpanded(false); }}
              className="p-2.5 rounded-xl flex flex-col items-center justify-center text-slate-500 dark:text-slate-300"
            >
              <Focus className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Primary Mobile Dock */}
        <div className="w-full max-w-sm bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl border border-slate-200 dark:border-slate-700/90 px-2 py-1.5 rounded-2xl shadow-2xl flex items-center justify-between gap-1">
          {/* Select */}
          <button
            onClick={() => setTool('select')}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              tool === 'select' ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <MousePointer className="w-4 h-4" />
            <span className="text-[9px]">영역선택</span>
          </button>

          {/* Multi-Select Toggle for Smartphone / Tablet */}
          <button
            onClick={() => setMultiSelectMode?.(prev => !prev)}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 relative ${
              multiSelectMode ? 'bg-amber-500 text-slate-950 font-bold' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <CheckSquare className="w-4 h-4" />
            <span className="text-[9px]">{multiSelectMode ? '다중 ON' : '다중선택'}</span>
            {multiSelectMode && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-amber-900 dark:bg-amber-950 rounded-full animate-ping" />
            )}
          </button>

          {/* Pan */}
          <button
            onClick={() => setTool('pan')}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              tool === 'pan' ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Hand className="w-4 h-4" />
            <span className="text-[9px]">이동</span>
          </button>

          {/* Polyline */}
          <button
            onClick={() => { if (tool !== 'polyline') onCancelDrawing(); setTool('polyline'); }}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 relative ${
              tool === 'polyline' ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Spline className="w-4 h-4" />
            <span className="text-[9px] font-semibold">연속선</span>
            {tool === 'polyline' && (
              <span className="absolute top-1 right-1 w-1.5 h-1.5 bg-emerald-400 rounded-full animate-ping" />
            )}
          </button>

          {/* Line */}
          <button
            onClick={() => { if (tool !== 'line') onCancelDrawing(); setTool('line'); }}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              tool === 'line' ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Minus className="w-4 h-4" />
            <span className="text-[9px]">직선</span>
          </button>

          {/* Polygon */}
          <button
            onClick={() => { if (tool !== 'polygon') onCancelDrawing(); setTool('polygon'); }}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              tool === 'polygon' ? 'bg-sky-500 text-white' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Pentagon className="w-4 h-4" />
            <span className="text-[9px]">면적</span>
          </button>

          {/* Snap */}
          <button
            onClick={() => setSnapEnabled(prev => !prev)}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              snapEnabled ? 'bg-emerald-600 text-white' : 'text-slate-500 dark:text-slate-400'
            }`}
          >
            <Magnet className="w-4 h-4" />
            <span className="text-[9px]">스냅</span>
          </button>

          {/* More Toggle */}
          <button
            onClick={() => setMobileExpanded(prev => !prev)}
            className="p-2 rounded-xl text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white flex flex-col items-center gap-0.5"
          >
            {mobileExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            <span className="text-[9px]">더보기</span>
          </button>
        </div>
      </div>

      {/* 3. Floating Action Controls for Active Drawing (Responsive) */}
      {activePointsCount > 0 && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-sky-400 dark:border-sky-500/70 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-200 w-auto max-w-[90vw]">
          <div className="flex flex-col mr-1.5 sm:mr-2 shrink-0">
            <span className="text-xs font-semibold text-sky-600 dark:text-sky-400">
              {tool === 'polyline' ? '연속선 입력' : tool === 'polygon' ? '폴리곤 입력' : '측정 입력'}
            </span>
            <span className="text-[10px] sm:text-[11px] text-slate-500 dark:text-slate-400">
              측점: <strong className="text-slate-900 dark:text-white">{activePointsCount}</strong>개
            </span>
          </div>

          {/* Finish drawing button */}
          <button
            onClick={onFinishDrawing}
            disabled={activePointsCount < 2}
            className={`flex items-center gap-1.5 px-3 py-2 sm:px-3.5 sm:py-1.5 rounded-xl font-medium text-xs transition min-h-[40px] sm:min-h-0 ${
              activePointsCount >= 2
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 font-semibold'
                : 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>연결 완료</span>
          </button>

          {/* Cancel drawing button */}
          <button
            onClick={onCancelDrawing}
            className="flex items-center gap-1 px-2.5 py-2 sm:px-2.5 sm:py-1.5 rounded-xl font-medium text-xs bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition min-h-[40px] sm:min-h-0"
          >
            <X className="w-4 h-4" />
            <span>취소</span>
          </button>
        </div>
      )}

      {/* 4. Top Right Quick Undo / Redo */}
      <div className="absolute top-14 right-2 sm:top-20 sm:right-3 z-20 flex items-center gap-1 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border border-slate-200 dark:border-slate-700/80 p-1 rounded-xl shadow-lg">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="실행 취소 (Ctrl+Z)"
          className={`p-1.5 sm:p-2 rounded-lg transition ${
            canUndo ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800' : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="다시 실행 (Ctrl+Y)"
          className={`p-1.5 sm:p-2 rounded-lg transition ${
            canRedo ? 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800' : 'text-slate-300 dark:text-slate-600 cursor-not-allowed'
          }`}
        >
          <RotateCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>
    </>
  );
};
