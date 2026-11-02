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
  Monitor,
  Tablet,
  Smartphone
} from 'lucide-react';
import { Point2D, SnapPoint } from '../types/cad';
import { COORDINATE_SYSTEMS } from '../utils/projections';
import { PWAInstallButton } from './PWAInstallButton';

interface CoordinateBarProps {
  crs: string;
  onChangeCRS: (newCrs: string) => void;
  isSwappedXY: boolean;
  onToggleSwapXY: () => void;
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
  onToggleLayerPanel: () => void;
  onOpenHelp: () => void;
}

export const CoordinateBar: React.FC<CoordinateBarProps> = ({
  crs,
  onChangeCRS,
  isSwappedXY,
  onToggleSwapXY,
  cursorWorld,
  activeSnap,
  pointsCount,
  linesCount,
  liveMeasurement,
  onOpenImport,
  onOpenExport,
  onOpenTable,
  onToggleLayerPanel,
  onOpenHelp
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="relative z-30 flex flex-col border-b border-slate-800 bg-slate-900/95 backdrop-blur-md">
      {/* Top Main Navigation Bar */}
      <div className="flex items-center justify-between px-2.5 py-1.5 md:px-4 md:py-2">
        {/* Left: Brand Logo & Title */}
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-sky-600 to-indigo-500 flex items-center justify-center font-bold text-white text-xs sm:text-sm shadow-md shadow-sky-500/20 shrink-0">
            CAD
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="font-semibold text-xs sm:text-base text-slate-100 tracking-tight whitespace-nowrap">
                Web GIS/CAD
              </h1>
              {/* Responsive Device Indicators */}
              <div className="hidden lg:flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                <Monitor className="w-3 h-3 text-sky-400" />
                <span>PC</span>
              </div>
              <div className="hidden sm:max-lg:flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                <Tablet className="w-3 h-3 text-sky-400" />
                <span>태블릿</span>
              </div>
              <div className="flex sm:hidden items-center gap-1 px-1 py-0.5 rounded text-[9px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
                <Smartphone className="w-2.5 h-2.5 text-sky-400" />
                <span>모바일</span>
              </div>
            </div>
            <p className="text-[10px] text-slate-400 hidden lg:block">
              좌표 CSV · 현장 스냅 드로잉 · DXF / SHP 변환 (오프라인 지원)
            </p>
          </div>
        </div>

        {/* Center: Quick CRS & Swap (Visible on Tablet & PC) */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="flex items-center gap-1 bg-slate-800/80 px-2 py-1 rounded-xl border border-slate-700">
            <span className="text-slate-400 text-[11px]">좌표계:</span>
            <select
              value={crs}
              onChange={e => onChangeCRS(e.target.value)}
              className="bg-transparent text-sky-300 text-xs font-medium focus:outline-none cursor-pointer"
            >
              {Object.values(COORDINATE_SYSTEMS).map(cs => (
                <option key={cs.code} value={cs.code} className="bg-slate-900 text-slate-200">
                  {cs.code} - {cs.name}
                </option>
              ))}
            </select>
          </div>

          <button
            onClick={onToggleSwapXY}
            title="측량 좌표계 (X=Northing, Y=Easting) ⇄ CAD 좌표계 (X=Easting, Y=Northing) 반전"
            className={`flex items-center gap-1 px-2.5 py-1 rounded-xl border text-xs font-medium transition ${
              isSwappedXY
                ? 'bg-amber-950/80 border-amber-600/80 text-amber-300 shadow-sm shadow-amber-900/30'
                : 'bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
            <span className="hidden md:inline">{isSwappedXY ? '측량반전(X↔Y) 켜짐' : '일반(X/Y)'}</span>
            <span className="md:hidden">{isSwappedXY ? 'X↔Y 반전' : 'X/Y'}</span>
          </button>
        </div>

        {/* Right: Actions & PWA Install Button */}
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* PWA Install Button */}
          <PWAInstallButton />

          {/* Import Button */}
          <button
            onClick={onOpenImport}
            className="flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
          >
            <Upload className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden md:inline">불러오기</span>
          </button>

          {/* Export Button */}
          <button
            onClick={onOpenExport}
            className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-medium shadow-md shadow-sky-600/30 transition whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">내보내기 (DXF/SHP)</span>
            <span className="sm:hidden">내보내기</span>
          </button>

          {/* Points Table Button (Hidden on small mobile, accessible via menu) */}
          <button
            onClick={onOpenTable}
            title="측점 좌표 목록 표"
            className="hidden sm:flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
          >
            <Table2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden md:inline">측점표</span>
            <span className="text-[10px] bg-slate-700 text-slate-300 px-1 rounded-full">
              {pointsCount}
            </span>
          </button>

          {/* Layers Button */}
          <button
            onClick={onToggleLayerPanel}
            title="도면 레이어 관리"
            className="hidden sm:flex items-center gap-1 px-2 sm:px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
          >
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span className="hidden md:inline">레이어</span>
          </button>

          {/* Help Modal */}
          <button
            onClick={onOpenHelp}
            title="사용 방법 및 도움말"
            className="hidden sm:block p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Mobile Menu Toggle Button (< 640px) */}
          <button
            onClick={() => setMobileMenuOpen(prev => !prev)}
            className="sm:hidden p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition"
            title="메뉴"
          >
            {mobileMenuOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer Dropdown Menu (on < 640px) */}
      {mobileMenuOpen && (
        <div className="sm:hidden border-t border-slate-800 bg-slate-900 px-3 py-2.5 flex flex-col gap-2 animate-in slide-in-from-top-2 duration-150">
          {/* Mobile CRS & Swap */}
          <div className="flex items-center justify-between gap-2 p-2 bg-slate-950 rounded-xl border border-slate-800">
            <div className="flex items-center gap-1 flex-1">
              <span className="text-[11px] text-slate-400">좌표계:</span>
              <select
                value={crs}
                onChange={e => onChangeCRS(e.target.value)}
                className="bg-transparent text-sky-400 text-xs font-semibold focus:outline-none flex-1 truncate"
              >
                {Object.values(COORDINATE_SYSTEMS).map(cs => (
                  <option key={cs.code} value={cs.code} className="bg-slate-900 text-slate-200">
                    {cs.code} - {cs.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={onToggleSwapXY}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[11px] shrink-0 font-medium ${
                isSwappedXY
                  ? 'bg-amber-950/80 border-amber-600 text-amber-300'
                  : 'bg-slate-800 border-slate-700 text-slate-300'
              }`}
            >
              <ArrowLeftRight className="w-3 h-3" />
              <span>{isSwappedXY ? 'X↔Y 반전됨' : '일반(X/Y)'}</span>
            </button>
          </div>

          {/* Mobile Buttons Grid */}
          <div className="grid grid-cols-3 gap-1.5 pt-1">
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenTable();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium"
            >
              <Table2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>측점표 ({pointsCount})</span>
            </button>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onToggleLayerPanel();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium"
            >
              <Layers className="w-3.5 h-3.5 text-purple-400" />
              <span>레이어</span>
            </button>

            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenHelp();
              }}
              className="flex items-center justify-center gap-1.5 p-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 text-xs font-medium"
            >
              <HelpCircle className="w-3.5 h-3.5 text-sky-400" />
              <span>도움말</span>
            </button>
          </div>
        </div>
      )}

      {/* Coordinate & Measurement Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-1 gap-x-2 px-2.5 py-1 bg-slate-950/90 border-t border-slate-800 text-[10px] sm:text-[11px] font-mono">
        {/* Live Drawing Measurement summary if active */}
        {liveMeasurement && liveMeasurement.pointCount > 0 ? (
          <div className="flex items-center gap-2 sm:gap-3 text-sky-400 font-sans">
            <div>
              구간: <strong className="font-mono text-slate-200">{liveMeasurement.currentSegment.toFixed(2)}m</strong>
            </div>
            <div>
              총 연장: <strong className="font-mono text-white">{liveMeasurement.totalLength.toFixed(2)}m</strong>
            </div>
            {liveMeasurement.area !== undefined && liveMeasurement.area > 0 && (
              <div>
                면적: <strong className="font-mono text-emerald-400">{liveMeasurement.area.toFixed(1)}㎡</strong>
                <span className="text-slate-400 ml-0.5">
                  ({(liveMeasurement.area / 3.305785).toFixed(1)}평)
                </span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-slate-400 font-sans">
            <span className="hidden sm:inline">도면 성과:</span>
            <span>측점 <strong className="text-white">{pointsCount}</strong></span>
            <span>선 <strong className="text-white">{linesCount}</strong></span>
          </div>
        )}

        {/* Real-time Cursor Coordinates */}
        <div className="flex items-center gap-2 sm:gap-3 ml-auto text-slate-300">
          {cursorWorld ? (
            <>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">X:</span>
                <span className="text-sky-300 font-semibold">{cursorWorld.x.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}m</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Y:</span>
                <span className="text-sky-300 font-semibold">{cursorWorld.y.toLocaleString('ko-KR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}m</span>
              </div>
            </>
          ) : (
            <span className="text-slate-500 text-[10px]">화면 터치/이동</span>
          )}

          {activeSnap && (
            <span className="px-1.5 py-0.2 rounded bg-emerald-950 border border-emerald-700 text-emerald-400 text-[9px] sm:text-[10px] font-sans truncate max-w-[120px] sm:max-w-none">
              {activeSnap.label}
            </span>
          )}
        </div>
      </div>
    </header>
  );
};
