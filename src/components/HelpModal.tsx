/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, Touchpad, Magnet, ArrowLeftRight, FileCode, Layers, HelpCircle } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">웹 GIS/CAD 편집기 사용 가이드</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto text-xs text-slate-600 dark:text-slate-300 leading-relaxed custom-scrollbar">
          {/* Section 1 */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-sm">
              <ArrowLeftRight className="w-4 h-4" />
              <span>1. 좌표계 기준 (X: 동향, Y: 북향)</span>
            </div>
            <p>
              • 본 시스템은 오토캐드(AutoCAD) 및 GIS 표준 직교좌표계를 따릅니다. <strong>가로 방향이 X(동향, Easting)</strong>, <strong>세로 방향이 Y(북향, Northing)</strong>입니다.
            </p>
            <p>
              • CSV 및 엑셀 파일을 불러올 때 각 열을 X와 Y에 맞게 지정하면 도면에 정확한 위치로 배치됩니다. 모든 수치와 좌표는 소수점 3자리까지 정밀하게 관리됩니다.
            </p>
          </div>

          {/* Section 2 */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
              <Magnet className="w-4 h-4" />
              <span>2. 자석 스냅(Snap) 기능 & 선 연결 및 길이/면적 계산</span>
            </div>
            <p>
              • <strong>연속선 (Polyline)</strong> 툴을 선택하고 마우스나 손가락으로 측점 근처를 누르면 자석처럼 녹색 원/사각형으로 흡착(스냅)됩니다.
            </p>
            <p>
              • 실시간으로 각 구간 길이(m)와 누적 총 연장(m)이 표시됩니다.
            </p>
            <p>
              • <strong>폴리곤 (Polygon)</strong> 툴로 폐합 시 총 면적(㎡) 및 한국 표준 단위인 <strong>평(坪)</strong> 단위가 자동 환산되어 표기됩니다.
            </p>
            <p>
              • 선 연결이 끝나면 화면 하단의 <strong>[선 연결 완료]</strong> 버튼 또는 더블 클릭/더블 탭을 누르면 확정됩니다.
            </p>
          </div>

          {/* Section 3 */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-semibold text-sm">
              <Touchpad className="w-4 h-4" />
              <span>3. 태블릿 & 스마트폰 터치 제스처</span>
            </div>
            <p>
              • <strong>두 손가락 핀치 줌 & 팬</strong>: 두 손가락으로 화면을 벌리거나 오므려 축척을 확대/축소하고, 두 손가락으로 드래그하여 도면을 자유롭게 이동합니다.
            </p>
            <p>
              • <strong>한 손가락 드로잉</strong>: 드로잉 도구가 켜져 있을 때 한 손가락으로 측점을 탭하여 빠르게 선을 연결합니다.
            </p>
            <p>
              • <strong>진동 피드백 (Haptic)</strong>: 모바일에서 점에 스냅될 때 가벼운 햅틱 진동이 울려 정밀한 작업을 돕습니다.
            </p>
          </div>

          {/* Section 4 */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
              <FileCode className="w-4 h-4" />
              <span>4. SHP (Shapefile) & CSV 성과물 내보내기 및 누적 관리</span>
            </div>
            <p>
              • <strong>SHP (Shapefile) 내보내기</strong>: QGIS 및 ArcGIS에서 좌표계(PRJ) 오류 없이 바로 열리는 표준 <strong>.shp, .shx, .dbf, .prj</strong> 4개 파일이 포함된 ZIP으로 다운로드됩니다.
            </p>
            <p>
              • <strong>CSV 좌표 내보내기</strong>: 엑셀이나 측량기기에서 그대로 열 수 있는 측점명, X, Y, Z, 레이어 정보가 담긴 표준 CSV 파일로 저장됩니다.
            </p>
            <p>
              • <strong>작업 누적 (.cadgis)</strong>: 기존 SHP 파일이나 CSV를 불러와서 그 위에 새로운 측점이나 선을 계속 추가하거나, [프로젝트 파일 백업 (.cadgis)]으로 저장해 두면 매일 데이터 손실 없이 이어서 작업할 수 있습니다.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-sky-600/30 transition"
          >
            확인 및 시작하기
          </button>
        </div>
      </div>
    </div>
  );
};
