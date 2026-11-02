/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div className="fixed top-14 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-xl bg-amber-500/95 backdrop-blur-md px-3.5 py-1.5 text-xs font-medium text-slate-950 shadow-xl border border-amber-300 animate-in fade-in slide-in-from-top-2 duration-200">
      <WifiOff className="w-4 h-4 animate-bounce text-slate-900" />
      <span>오프라인 현장 모드 — 인터넷 없이 모든 CAD/GIS 드로잉 및 DXF/SHP 연산이 정상 작동합니다.</span>
    </div>
  );
};
