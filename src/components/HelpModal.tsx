/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { X, Magnet, FileCode, Layers, HelpCircle, Plus, Database, Sparkles } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
  onCreateSampleData: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ onClose, onCreateSampleData }) => {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-5 h-5 text-sky-600 dark:text-sky-400" />
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Web GIS Editor 사용 가이드</h2>
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
          {/* Sample Data Generator Section */}
          <div className="p-4 bg-gradient-to-br from-sky-50 to-indigo-50 dark:from-sky-950/40 dark:to-indigo-950/40 border border-sky-200 dark:border-sky-500/30 rounded-2xl space-y-3 shadow-inner">
            <div className="flex items-center gap-2 text-sky-700 dark:text-sky-300 font-bold text-sm">
              <Sparkles className="w-4 h-4" />
              <span>처음이신가요? 샘플 데이터를 생성해보세요</span>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400">
              측점 및 관로 데이터와 함께 <strong>속성(OD) 템플릿</strong>이 포함된 샘플 데이터를 생성하여 모든 기능을 즉시 체험해 볼 수 있습니다.
            </p>
            <button
              onClick={() => {
                onCreateSampleData();
                onClose();
              }}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl shadow-md shadow-sky-600/30 transition flex items-center justify-center gap-1.5 active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>샘플 프로젝트 및 템플릿 자동 생성</span>
            </button>
          </div>

          {/* Section 1: OD Templates */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400 font-semibold text-sm">
              <Database className="w-4 h-4" />
              <span>1. 속성(OD) 및 템플릿 시스템</span>
            </div>
            <p>
              • <strong>객체 속성(OD)</strong>: 각 측점과 선에 고유한 속성 데이터를 입력할 수 있습니다. 상단 [속성(OD)] 메뉴에서 관리하세요.
            </p>
            <p>
              • <strong>템플릿 기능</strong>: 반복되는 입력 항목을 템플릿으로 만들어 저장하세요. IndexedDB에 영구 저장되어 다른 프로젝트에서도 즉시 불러올 수 있습니다.
            </p>
            <p>
              • <strong>공유 및 이식</strong>: 작성한 템플릿을 파일로 내보내 동료와 공유하거나 다른 기기에서 불러와 작업 효율을 높일 수 있습니다.
            </p>
          </div>

          {/* Section 2: Drawing & Measurement */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
              <Magnet className="w-4 h-4" />
              <span>2. 정밀 드로잉 및 스냅(Snap)</span>
            </div>
            <p>
              • <strong>자석 스냅</strong>: 선 연결 시 측점 근처에서 녹색 원/사각형으로 자동 흡착됩니다. 모바일에서는 스냅 시 <strong>햅틱 진동</strong> 피드백이 제공됩니다.
            </p>
            <p>
              • <strong>실시간 계산</strong>: 선 작업 중 구간 길이, 총 연장, 폐합 시의 면적(㎡ 및 평 단위)이 화면 하단에 실시간으로 표시됩니다.
            </p>
            <p>
              • <strong>레이어 변경</strong>: 개체를 선택하여 레이어를 변경하거나, 여러 개체를 선택하여 일괄 삭제 및 레이어 이동이 가능합니다.
            </p>
          </div>

          {/* Section 3: Layer Management */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-purple-600 dark:text-purple-400 font-semibold text-sm">
              <Layers className="w-4 h-4" />
              <span>3. 레이어 제어 및 시인성</span>
            </div>
            <p>
              • <strong>레이어 ON/OFF</strong>: 우측 레이어 패널에서 불필요한 레이어를 숨길 수 있습니다. 숨겨진 레이어는 작업 중에도 다시 켜기 전까지는 나타나지 않습니다.
            </p>
            <p>
              • <strong>기본 레이어</strong>: 새 파일을 불러오면 기본적으로 '0' 레이어로 생성되며, 사용자가 원하는 대로 레이어 구조를 편집할 수 있습니다.
            </p>
          </div>

          {/* Section 4: Storage & Data Management */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 font-semibold text-sm">
              <Database className="w-4 h-4" />
              <span>4. 데이터 보관 및 불러오기 원칙</span>
            </div>
            <p>
              • <strong>템플릿(서식)</strong>: 작성한 OD 템플릿은 브라우저에 <strong>영구 저장</strong>되어 다른 프로젝트에서도 계속 사용할 수 있습니다.
            </p>
            <p>
              • <strong>기존 작업에 누적 추가</strong>: 현재 작업 중인 데이터(좌표 및 속성값)를 그대로 유지하면서, 새로운 파일의 내용만 덧붙여 작업합니다.
            </p>
            <p>
              • <strong>새로 시작 (기존 데이터 교체)</strong>: 이전 작업 내용을 모두 삭제하고, 새로 불러온 데이터로 깨끗하게 프로젝트를 다시 시작합니다.
            </p>
          </div>

          {/* Section 5: Export formats */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold text-sm">
              <FileCode className="w-4 h-4" />
              <span>5. 성과물 내보내기 (SHP, GeoJSON, CSV)</span>
            </div>
            <p>
              • <strong>SHP / GeoJSON</strong>: QGIS 등 GIS 소프트웨어와 호환되는 표준 포맷입니다. 입력한 모든 OD 속성 데이터가 포함됩니다.
            </p>
            <p>
              • <strong>CSV 좌표</strong>: 엑셀에서 즉시 확인 가능한 측점 리스트를 생성합니다.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-sky-600/30 transition"
          >
            가이드 닫기
          </button>
        </div>
      </div>
    </div>
  );
};
