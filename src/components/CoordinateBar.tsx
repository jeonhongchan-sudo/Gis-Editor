/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  Layers, 
  Table2, 
  Upload, 
  Download, 
  ArrowLeftRight, 
  HelpCircle,
  Menu,
  X,
  Compass,
  Sun,
  Moon,
  MapPin,
  Database
} from 'lucide-react';
import { Point2D, SnapPoint } from '../types/cad';
import { PWAInstallButton } from './PWAInstallButton';

interface CoordinateBarProps {
  cursorWorld: Point2D | null;
  activeSnap: SnapPoint | null;
  pointsCount: number;
  linesCount: number;
  liveMeasurement?: {
    currentSegment: number;
    totalLength: number;
    area?: number;
    pointCount: number;
  };
  onOpenImport: () => void;
  onOpenExport: () => void;
  onOpenTable: () => void;
  onOpenLineOD: () => void;
  onToggleLayerPanel: () => void;
  onOpenHelp: () => void;
  onOpenManualPoint: () => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
}

export const CoordinateBar: React.FC<CoordinateBarProps> = ({
  cursorWorld,
  activeSnap,
  pointsCount,
  linesCount,
  liveMeasurement,
  onOpenImport,
  onOpenExport,
  onOpenTable,
  onOpenLineOD,
  onToggleLayerPanel,
  onOpenHelp,
  onOpenManualPoint,
  theme,
  setTheme
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="relative z-30 flex flex-col border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md">
      {/* Top Main Navigation Bar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 md:px-4 md:py-2">
        {/* Left: Brand Logo & Title */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center font-bold text-white text-xs sm:text-sm shadow-md shadow-sky-500/20 shrink-0">
            CAD
          </div>
          <div>
            <div className="flex items-center gap-1.5">
            <h1 className="font-semibold text-xs sm:text-base text-slate-900 dark:text-slate-100 tracking-tight whitespace-nowrap">
                Web GIS/CAD
              </h1>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 hidden lg:block">
              좌표 CSV · 현장 스냅 드로잉 · GIS SHP 변환 (오프라인 지원)
            </p>
          </div>
        </div>

        {/* Right: Actions & PWA Install Button */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Theme Toggle */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
          >
            {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>

          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* Import Button */}
          <button
            onClick={onOpenImport}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium border border-slate-200 dark:border-slate-700 transition"
          >
            <Download className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
            <span className="hidden md:inline">불러오기</span>
          </button>

          {/* Export Button */}
          <button
            onClick={onOpenExport}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium shadow-md shadow-emerald-600/30 transition whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">내보내기 (SHP/CSV)</span>
            <span className="sm:hidden">내보내기</span>
          </button>

          {/* Points Table Button (Hidden on small mobile, accessible via menu) */}
          <button
            onClick={onOpenTable}
            title="측점 좌표 목록 표"
            className="hidden sm:flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-200 dark:border-slate-700 transition"
          >
            <Table2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
            <span className="hidden md:inline">측점표</span>
            <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1 rounded-full font-mono">
              {pointsCount}
            </span>
          </button>

          {/* Line OD Table Button */}
          <button
            onClick={onOpenLineOD}
            title="선 속성 및 오토캐드 맵(OD) 데이터 관리"
            className="hidden sm:flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-200 dark:border-slate-700 transition"
          >
            <Database className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
            <span className="hidden md:inline">선(OD)</span>
            <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1 rounded-full font-mono">
              {linesCount}
            </span>
          </button>

          {/* Layers Button */}
          <button
            onClick={onToggleLayerPanel}
            title="도면 레이어 관리"
            className="hidden sm:flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium border border-slate-200 dark:border-slate-700 transition"
          >
            <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
            <span className="hidden md:inline">레이어</span>
          </button>

          {/* Help Modal */}
          <button
            onClick={onOpenHelp}
            title="사용 방법 및 도움말"
            className="hidden sm:block p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Mobile Menu Toggle Button (< 640px) */}
          <button
            onClick={() => setMobileMenuOpen(prev => !prev)}
            className="sm:hidden p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition"
            title="메뉴"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Dropdown Menu (on < 640px) */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2.5 flex flex-col gap-2 animate-in slide-in-from-top-2 duration-150">
          {/* Mobile Info */}
          <div className="p-3 bg-white dark:bg-slate-950 rounded-xl border border-slate-200 dark:border-slate-800 text-center">
            <span className="text-[11px] text-slate-500 font-medium">현장 측량 및 도면 편집 도구</span>
          </div>

          {/* Mobile Buttons Grid */}
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenTable();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium shadow-sm"
            >
              <Table2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>측점표 ({pointsCount})</span>
            </button>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenLineOD();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sky-600 dark:text-sky-400 text-xs font-medium shadow-sm"
            >
              <Database className="w-3.5 h-3.5" />
              <span>선/OD ({linesCount})</span>
            </button>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onToggleLayerPanel();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium shadow-sm"
            >
              <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span>레이어</span>
            </button>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenManualPoint();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sky-600 dark:text-sky-400 text-xs font-medium shadow-sm"
            >
              <MapPin className="w-3.5 h-3.5" />
              <span>좌표입력</span>
            </button>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenHelp();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-medium"
            >
              <HelpCircle className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
              <span>도움말</span>
            </button>
          </div>
        </div>
      )}

      {/* Coordinate & Measurement Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-2 px-2.5 py-1 bg-slate-50/90 dark:bg-slate-950/90 border-t border-slate-200 dark:border-slate-800 text-[10px] sm:text-[11px] font-mono">
        {/* Live Drawing Measurement summary if active */}
        {liveMeasurement && liveMeasurement.pointCount > 0 ? (
          <div className="flex items-center gap-2 sm:gap-3 text-sky-400 font-sans">
            <div>
              구간: <strong className="font-mono text-slate-900 dark:text-slate-200">{liveMeasurement.currentSegment.toFixed(3)}m</strong>
            </div>
            <div>
              총 연장: <strong className="font-mono text-white">{liveMeasurement.totalLength.toFixed(3)}m</strong>
            </div>
            {liveMeasurement.area !== undefined && liveMeasurement.area > 0 && (
              <div>
                면적: <strong className="font-mono text-emerald-400">{liveMeasurement.area.toFixed(3)}㎡</strong>
                <span className="text-slate-400 ml-0.5">
                  ({(liveMeasurement.area / 3.305785).toFixed(3)}평)
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 font-sans">
            <span className="hidden sm:inline">도면 성과:</span>
            <span>측점 <strong className="text-slate-900 dark:text-white">{pointsCount}</strong></span>
            <span>선 <strong className="text-slate-900 dark:text-white">{linesCount}</strong></span>
          </div>
        )}

        {/* Real-time Cursor Coordinates */}
        <div className="flex items-center gap-2 sm:gap-3 ml-auto text-slate-700 dark:text-slate-300">
          {cursorWorld ? (
            <>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 dark:text-slate-500 font-sans">X:</span>
                <span className="text-sky-600 dark:text-sky-300 font-semibold">{cursorWorld.x.toLocaleString('ko-KR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}m</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-400 dark:text-slate-500 font-sans">Y:</span>
                <span className="text-sky-600 dark:text-sky-300 font-semibold">{cursorWorld.y.toLocaleString('ko-KR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })}m</span>
              </div>
            </>
          ) : (
            <span className="text-slate-400 dark:text-slate-500 text-[10px]">화면 터치/이동</span>
          )}

          {activeSnap && (
            <span className="px-1.5 py-0.2 rounded bg-emerald-100 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-700 text-emerald-700 dark:text-emerald-400 text-[9px] sm:text-[10px] font-sans truncate max-w-[120px] sm:max-w-none">
              {activeSnap.label}
            </span>
          )}
        </div>
      </div>
    </header>
  );
};
