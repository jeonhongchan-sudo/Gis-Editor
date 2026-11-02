/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { DownloadCloud, Smartphone, Share, PlusSquare, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

export const PWAInstallButton: React.FC = () => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  // If already running as an installed standalone PWA, hide button
  if (isInstalled) {
    return null;
  }

  // Chromium / Android / Desktop flow
  if (isInstallable) {
    return (
      <button
        onClick={install}
        title="앱 설치 (홈 화면에 추가하여 오프라인에서 실행)"
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium shadow-md shadow-emerald-600/30 transition animate-pulse hover:animate-none"
      >
        <DownloadCloud className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">앱 설치</span>
      </button>
    );
  }

  // iOS Safari flow (beforeinstallprompt is not supported by WebKit)
  if (isIOS) {
    return (
      <>
        <button
          onClick={() => setShowIOSGuide(true)}
          title="아이폰/아이패드 홈 화면에 설치"
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-sky-300 text-xs font-medium border border-sky-800/60 transition"
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">홈 화면 추가</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="w-full max-w-sm rounded-2xl bg-slate-900 border border-slate-700 p-5 shadow-2xl text-slate-200">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Smartphone className="w-4 h-4 text-sky-400" />
                  <span>iOS 홈 화면에 앱 추가하기</span>
                </h3>
                <button
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4 space-y-3 text-xs leading-relaxed text-slate-300">
                <div className="flex items-start gap-3 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800">
                  <Share className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                  <div>
                    <strong>1단계:</strong> 사파리(Safari) 브라우저 하단의 <strong>공유(Share)</strong> 버튼을 누릅니다.
                  </div>
                </div>

                <div className="flex items-start gap-3 p-2.5 bg-slate-950/60 rounded-xl border border-slate-800">
                  <PlusSquare className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong>2단계:</strong> 메뉴를 아래로 스크롤하여 <strong>[홈 화면에 추가]</strong>를 선택합니다.
                  </div>
                </div>

                <p className="text-[11px] text-slate-400">
                  설치 후에는 전체 화면 앱 형태로 동작하며, 인터넷이 없는 현장에서도 오프라인으로 사용할 수 있습니다.
                </p>
              </div>

              <button
                onClick={() => setShowIOSGuide(false)}
                className="mt-4 w-full rounded-xl bg-sky-600 hover:bg-sky-500 py-2 text-xs font-semibold text-white transition"
              >
                닫기
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Fallback: general info button on browsers that don't support beforeinstallprompt yet
  return (
    <button
      onClick={() => {
        alert('브라우저 주소창 우측의 [앱 설치] 아이콘 또는 브라우저 메뉴의 [홈 화면에 추가]를 선택하여 오프라인 앱으로 설치할 수 있습니다.');
      }}
      title="오프라인 PWA 앱 설치 안내"
      className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
    >
      <DownloadCloud className="w-3.5 h-3.5 text-emerald-400" />
      <span className="hidden md:inline">앱 설치</span>
    </button>
  );
};
