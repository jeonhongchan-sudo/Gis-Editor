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
  Compass,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { ToolMode } from '../types/cad';

interface ToolbarProps {
  tool: ToolMode;
  setTool: (tool: ToolMode) => void;
  ortho: boolean;
  setOrtho: (val: boolean | ((prev: boolean) => boolean)) => void;
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
}

export const Toolbar: React.FC<ToolbarProps> = ({
  tool,
  setTool,
  ortho,
  setOrtho,
  snapEnabled,
  setSnapEnabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onZoomExtents,
  activePointsCount,
  onFinishDrawing,
  onCancelDrawing
}) => {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  return (
    <>
      {/* 1. Desktop & Tablet Floating Dock (Left Side, sm:flex) */}
      <div className="hidden sm:flex absolute left-3 top-20 z-20 flex-col gap-1.5 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 p-1.5 rounded-2xl shadow-2xl">
        {/* Pointer / Select */}
        <button
          onClick={() => setTool('select')}
          title="객체 선택 (Select)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'select'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <MousePointer className="w-5 h-5" />
        </button>

        {/* Pan */}
        <button
          onClick={() => setTool('pan')}
          title="화면 이동 (Pan)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'pan'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Hand className="w-5 h-5" />
        </button>

        <div className="w-full h-px bg-slate-700/60 my-0.5" />

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
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
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
          title="측점 생성 (Point)"
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            tool === 'point'
              ? 'bg-sky-500 text-white shadow-lg shadow-sky-500/30'
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <MapPin className="w-5 h-5" />
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
              : 'text-slate-300 hover:bg-slate-800 hover:text-white'
          }`}
        >
          <Ruler className="w-5 h-5" />
        </button>

        <div className="w-full h-px bg-slate-700/60 my-0.5" />

        {/* Snap Toggle */}
        <button
          onClick={() => setSnapEnabled(prev => !prev)}
          title={`자석 스냅 (${snapEnabled ? '켜짐' : '꺼짐'})`}
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            snapEnabled
              ? 'bg-emerald-600/90 text-white shadow-md shadow-emerald-600/30'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          <Magnet className="w-5 h-5" />
        </button>

        {/* Ortho 90° Toggle */}
        <button
          onClick={() => setOrtho(prev => !prev)}
          title={`직교 모드 90° (${ortho ? '켜짐' : '꺼짐'})`}
          className={`p-2.5 rounded-xl transition flex items-center justify-center ${
            ortho
              ? 'bg-amber-600/90 text-white shadow-md shadow-amber-600/30'
              : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
          }`}
        >
          <Compass className="w-5 h-5" />
        </button>

        <button
          onClick={onZoomExtents}
          title="전체 화면 맞춤"
          className="p-2.5 rounded-xl text-slate-300 hover:bg-slate-800 hover:text-white transition flex items-center justify-center"
        >
          <Focus className="w-5 h-5" />
        </button>
      </div>

      {/* 2. Mobile Responsive Bottom Dock (< sm) */}
      <div className="sm:hidden fixed bottom-3 left-2 right-2 z-20 flex flex-col items-center">
        {/* Expandable Extra Tools */}
        {mobileExpanded && (
          <div className="mb-2 w-full max-w-sm bg-slate-900/95 backdrop-blur-xl border border-slate-700 p-2 rounded-2xl shadow-2xl flex items-center justify-around gap-1 animate-in slide-in-from-bottom-2 duration-150">
            <button
              onClick={() => { setTool('point'); setMobileExpanded(false); }}
              className={`p-2.5 rounded-xl flex flex-col items-center gap-0.5 text-[10px] ${tool === 'point' ? 'bg-sky-500 text-white' : 'text-slate-300'}`}
            >
              <MapPin className="w-4 h-4" />
              <span>측점추가</span>
            </button>
            <button
              onClick={() => { setTool('measure'); setMobileExpanded(false); }}
              className={`p-2.5 rounded-xl flex flex-col items-center gap-0.5 text-[10px] ${tool === 'measure' ? 'bg-sky-500 text-white' : 'text-slate-300'}`}
            >
              <Ruler className="w-4 h-4" />
              <span>거리측정</span>
            </button>
            <button
              onClick={() => { setOrtho(prev => !prev); }}
              className={`p-2.5 rounded-xl flex flex-col items-center gap-0.5 text-[10px] ${ortho ? 'bg-amber-600 text-white' : 'text-slate-300'}`}
            >
              <Compass className="w-4 h-4" />
              <span>직교 {ortho ? 'ON' : 'OFF'}</span>
            </button>
            <button
              onClick={() => { onZoomExtents(); setMobileExpanded(false); }}
              className="p-2.5 rounded-xl flex flex-col items-center justify-center text-slate-300"
            >
              <Focus className="w-5 h-5" />
            </button>
          </div>
        )}

        {/* Primary Mobile Dock */}
        <div className="w-full max-w-sm bg-slate-900/95 backdrop-blur-xl border border-slate-700/90 px-2 py-1.5 rounded-2xl shadow-2xl flex items-center justify-between gap-1">
          {/* Select */}
          <button
            onClick={() => setTool('select')}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              tool === 'select' ? 'bg-sky-500 text-white' : 'text-slate-400'
            }`}
          >
            <MousePointer className="w-4 h-4" />
            <span className="text-[9px]">선택</span>
          </button>

          {/* Pan */}
          <button
            onClick={() => setTool('pan')}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              tool === 'pan' ? 'bg-sky-500 text-white' : 'text-slate-400'
            }`}
          >
            <Hand className="w-4 h-4" />
            <span className="text-[9px]">이동</span>
          </button>

          {/* Polyline */}
          <button
            onClick={() => { if (tool !== 'polyline') onCancelDrawing(); setTool('polyline'); }}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 relative ${
              tool === 'polyline' ? 'bg-sky-500 text-white' : 'text-slate-400'
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
              tool === 'line' ? 'bg-sky-500 text-white' : 'text-slate-400'
            }`}
          >
            <Minus className="w-4 h-4" />
            <span className="text-[9px]">직선</span>
          </button>

          {/* Polygon */}
          <button
            onClick={() => { if (tool !== 'polygon') onCancelDrawing(); setTool('polygon'); }}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              tool === 'polygon' ? 'bg-sky-500 text-white' : 'text-slate-400'
            }`}
          >
            <Pentagon className="w-4 h-4" />
            <span className="text-[9px]">면적</span>
          </button>

          {/* Snap */}
          <button
            onClick={() => setSnapEnabled(prev => !prev)}
            className={`p-2 rounded-xl transition flex flex-col items-center gap-0.5 ${
              snapEnabled ? 'bg-emerald-600 text-white' : 'text-slate-500'
            }`}
          >
            <Magnet className="w-4 h-4" />
            <span className="text-[9px]">스냅</span>
          </button>

          {/* More Toggle */}
          <button
            onClick={() => setMobileExpanded(prev => !prev)}
            className="p-2 rounded-xl text-slate-400 hover:text-white flex flex-col items-center gap-0.5"
          >
            {mobileExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            <span className="text-[9px]">더보기</span>
          </button>
        </div>
      </div>

      {/* 3. Floating Action Controls for Active Drawing (Responsive) */}
      {activePointsCount > 0 && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 bg-slate-900/95 backdrop-blur-md border border-sky-500/70 px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-2xl shadow-2xl animate-in fade-in slide-in-from-bottom-3 duration-200 w-auto max-w-[90vw]">
          <div className="flex flex-col mr-1.5 sm:mr-2 shrink-0">
            <span className="text-xs font-semibold text-sky-400">
              {tool === 'polyline' ? '연속선 입력' : tool === 'polygon' ? '폴리곤 입력' : '측정 입력'}
            </span>
            <span className="text-[10px] sm:text-[11px] text-slate-400">
              측점: <strong className="text-white">{activePointsCount}</strong>개
            </span>
          </div>

          {/* Finish drawing button */}
          <button
            onClick={onFinishDrawing}
            disabled={activePointsCount < 2}
            className={`flex items-center gap-1.5 px-3 py-2 sm:px-3.5 sm:py-1.5 rounded-xl font-medium text-xs transition min-h-[40px] sm:min-h-0 ${
              activePointsCount >= 2
                ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/30 font-semibold'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>연결 완료</span>
          </button>

          {/* Cancel drawing button */}
          <button
            onClick={onCancelDrawing}
            className="flex items-center gap-1 px-2.5 py-2 sm:px-2.5 sm:py-1.5 rounded-xl font-medium text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition min-h-[40px] sm:min-h-0"
          >
            <X className="w-4 h-4" />
            <span>취소</span>
          </button>
        </div>
      )}

      {/* 4. Top Right Quick Undo / Redo */}
      <div className="absolute top-14 right-2 sm:top-20 sm:right-3 z-20 flex items-center gap-1 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 p-1 rounded-xl shadow-lg">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          title="실행 취소 (Ctrl+Z)"
          className={`p-1.5 sm:p-2 rounded-lg transition ${
            canUndo ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-600 cursor-not-allowed'
          }`}
        >
          <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          title="다시 실행 (Ctrl+Y)"
          className={`p-1.5 sm:p-2 rounded-lg transition ${
            canRedo ? 'text-slate-200 hover:bg-slate-800' : 'text-slate-600 cursor-not-allowed'
          }`}
        >
          <RotateCw className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
        </button>
      </div>
    </>
  );
};
