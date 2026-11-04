import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { Download, Info, X } from 'lucide-react';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        onClick={install}
        className="flex items-center gap-2 rounded-2xl bg-sky-600 px-5 py-3 text-sm font-bold text-white shadow-xl hover:bg-sky-500 transition active:scale-95"
      >
        <Download className="w-4 h-4" />
        앱으로 설치 (오프라인 사용)
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          className="flex items-center gap-2 rounded-2xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 px-5 py-3 text-sm font-bold text-slate-700 dark:text-white shadow-xl hover:bg-slate-200 dark:hover:bg-slate-700 transition active:scale-95"
        >
          <Info className="w-4 h-4" />
          아이폰 설치 안내
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-8 shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-start">
                <h3 className="text-xl font-bold text-slate-900 dark:text-white">아이폰/아이패드 설치</h3>
                <button onClick={() => setShowIOSGuide(false)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white"><X className="w-6 h-6" /></button>
              </div>
              <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                <p>1. 하단 툴바의 <strong>공유 버튼(사각형에 화살표)</strong>을 누르세요.</p>
                <p>2. 아래로 스크롤하여 <strong>'홈 화면에 추가'</strong>를 선택하세요.</p>
              </div>
              <button
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-2xl bg-slate-100 dark:bg-slate-800 py-3 text-sm font-bold text-slate-700 dark:text-white hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                알겠습니다
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
