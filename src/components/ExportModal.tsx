/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  X, 
  Download, 
  Upload,
  Archive, 
  FileSpreadsheet, 
  Save, 
  Check, 
  Layers,
  Globe2,
  Info,
  FileText
} from 'lucide-react';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, ProjectState } from '../types/cad';
import { downloadBlob, downloadTextFile, exportToShapefileZip } from '../utils/shpExporter';
import { exportToGeoJson } from '../utils/geoJsonExporter';
import { COORDINATE_SYSTEMS } from '../utils/projections';

interface ExportModalProps {
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  layers,
  points,
  lines,
  polylines,
  polygons,
  texts,
  onClose
}) => {
  const [isExportingShp, setIsExportingShp] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  // Encoding states
  const [shpEncoding, setShpEncoding] = useState<'utf-8' | 'euc-kr'>('euc-kr');
  const [csvEncoding, setCsvEncoding] = useState<'utf-8' | 'euc-kr' | 'utf-8-bom'>('euc-kr');

  // Custom User Filename States
  const todayStr = new Date().toISOString().slice(0, 10);
  const [baseProjectName, setBaseProjectName] = useState<string>(() => `현장성과_${todayStr}`);
  
  // Specific filenames derived from base or editable
  const [shpFileName, setShpFileName] = useState<string>(() => `현장성과_${todayStr}`);
  const [csvFileName, setCsvFileName] = useState<string>(() => `현장성과_${todayStr}`);
  const [geoJsonFileName, setGeoJsonFileName] = useState<string>(() => `현장성과_${todayStr}`);

  const totalLinesCount = lines.length + polylines.length;
  const isProcessingRef = useRef(false);

  const showSuccess = (msg: string) => {
    setExportSuccessMsg(msg);
    setTimeout(() => setExportSuccessMsg(null), 3000);
  };

  // 0. Export GeoJSON (Recommended for Backup & Multi-device)
  const handleExportGeoJson = async () => {
    if (isProcessingRef.current) return;
    try {
      isProcessingRef.current = true;
      const geojson = exportToGeoJson({
        points,
        lines,
        polylines,
        polygons,
        texts,
        layers
      });
      const jsonStr = JSON.stringify(geojson, null, 2);
      const cleanName = (geoJsonFileName.trim() || `cad_backup_${todayStr}`).replace(/\.geojson$/i, '');
      const filename = `${cleanName}.geojson`;
      await downloadTextFile(jsonStr, filename, 'utf-8', 'application/geo+json');
      showSuccess(`기기 통합 백업 파일(${filename})이 저장되었습니다.`);
    } catch (err: any) {
      alert('GeoJSON 생성 중 오류가 발생했습니다: ' + err.message);
    } finally {
      isProcessingRef.current = false;
    }
  };

  // 1. Export Shapefile ZIP
  const handleExportSHP = async () => {
    if (isProcessingRef.current || isExportingShp) return;
    try {
      isProcessingRef.current = true;
      setIsExportingShp(true);
      const blob = await exportToShapefileZip({
        points,
        lines,
        polylines,
        polygons,
        layers,
        encoding: shpEncoding
      });
      const cleanName = (shpFileName.trim() || `gis_shapefiles_${todayStr}`).replace(/\.zip$/i, '');
      const filename = `${cleanName}.zip`;
      await downloadBlob(blob, filename);
      showSuccess(`SHP 압축 파일(${filename})이 정상 생성되었습니다.`);
    } catch (err: any) {
      alert('Shapefile 생성 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsExportingShp(false);
      isProcessingRef.current = false;
    }
  };

  // 2. Export Points CSV
  const handleExportCSV = async () => {
    if (isProcessingRef.current) return;
    try {
      isProcessingRef.current = true;
      
      // Collect all dynamic attribute keys from points
      const customPtKeysSet = new Set<string>();
      points.forEach(p => {
        if (p.attributes) {
          Object.keys(p.attributes).forEach(k => {
            if (k.trim()) customPtKeysSet.add(k.trim());
          });
        }
      });
      const customPtKeys = Array.from(customPtKeysSet);
      
      // Build CSV Header
      const headers = ['번호', '측점명', 'X(Easting)', 'Y(Northing)', '고도(Z)', '레이어', ...customPtKeys];
      const csvLines = [headers.join(',')];
      
      points.forEach((p, idx) => {
        const row = [
          idx + 1,
          `"${p.name || ''}"`,
          p.x.toFixed(3),
          p.y.toFixed(3),
          p.z !== undefined ? p.z.toFixed(3) : '',
          `"${layers.find(l => l.id === p.layerId)?.name || '0'}"`
        ];
        
        // Add dynamic attributes
        customPtKeys.forEach(k => {
          const val = p.attributes?.[k];
          row.push(val !== undefined ? `"${val}"` : '""');
        });
        
        csvLines.push(row.join(','));
      });
      
      const cleanName = (csvFileName.trim() || `survey_points_${todayStr}`).replace(/\.csv$/i, '');
      const filename = `${cleanName}.csv`;
      await downloadTextFile(csvLines.join('\n'), filename, csvEncoding, 'text/csv');
      showSuccess(`${filename} 측점 CSV가 저장되었습니다.`);
    } finally {
      isProcessingRef.current = false;
    }
  };



  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>통합 데이터 내보내기</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              기기 간 협업 및 통합 관리를 위한 <strong>GeoJSON 백업</strong> 또는 GIS 표준 데이터를 생성합니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Master Project / Base Filename Input & Summary */}
        <div className="p-3 bg-slate-50 dark:bg-slate-950/80 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 flex-1">
            <div className="flex items-center gap-1.5 text-slate-700 dark:text-slate-300 shrink-0 font-semibold">
              <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>기준 파일명:</span>
            </div>
            <div className="flex items-center flex-1 max-w-xs sm:max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl px-2.5 py-1 focus-within:ring-1 focus-within:ring-emerald-500">
              <input
                type="text"
                value={baseProjectName}
                onChange={(e) => {
                  const val = e.target.value;
                  setBaseProjectName(val);
                  const sanitized = val.trim() || `현장성과_${todayStr}`;
                  setShpFileName(sanitized);
                  setCsvFileName(sanitized);
                  setGeoJsonFileName(sanitized);
                }}
                placeholder="파일명 입력..."
                className="bg-transparent text-slate-900 dark:text-white font-bold outline-none w-full text-xs"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 text-slate-500 dark:text-slate-400 text-[11px] shrink-0">
            <span>측점: <strong className="text-sky-600 dark:text-sky-400">{points.length}</strong></span>
            <span>선: <strong className="text-amber-600 dark:text-amber-400">{totalLinesCount}</strong></span>
            <span>폴리곤: <strong className="text-emerald-600 dark:text-emerald-400">{polygons.length}</strong></span>
          </div>
        </div>

        {/* Success Alert */}
        {exportSuccessMsg && (
          <div className="mx-4 mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-700 rounded-xl flex items-center gap-2 text-emerald-700 dark:text-emerald-300 text-xs animate-in fade-in">
            <Check className="w-4 h-4 shrink-0" />
            <span>{exportSuccessMsg}</span>
          </div>
        )}

        {/* Export Options Grid */}
        <div className="p-4 space-y-3.5 overflow-y-auto max-h-[60vh] custom-scrollbar">
          
          {/* Option 0: GeoJSON Project Backup (NEW & RECOMMENDED) */}
          <div className="p-4 bg-sky-50/30 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-500/40 hover:border-sky-500 rounded-2xl flex flex-col gap-3 transition shadow-sm ring-1 ring-sky-500/10">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Globe2 className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">기기 통합 GeoJSON 백업 (.GEOJSON)</h3>
                  <span className="text-[10px] bg-sky-500 text-white px-2 py-0.5 rounded-full font-bold uppercase animate-pulse">
                    권장 (기기 간 이동용)
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Dropbox, Google Drive 등 <strong>개인 클라우드</strong>에 저장하기 가장 좋은 형식입니다.
                  레이어 정보, 측점명, 속성 데이터가 모두 포함되어 <strong>스마트폰, 태블릿, PC</strong> 어디서든 이어서 작업할 수 있습니다.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">백업 파일명:</span>
              <input
                type="text"
                value={geoJsonFileName}
                onChange={e => setGeoJsonFileName(e.target.value)}
                placeholder="GeoJSON 파일명 입력"
                className="bg-transparent text-sky-700 dark:text-sky-400 font-semibold outline-none flex-1 min-w-0"
              />
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0">.geojson</span>
            </div>

            <button
              onClick={handleExportGeoJson}
              disabled={points.length === 0 && totalLinesCount === 0 && polygons.length === 0 && texts.length === 0}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md shadow-sky-600/30 flex items-center justify-center gap-1.5 transition active:scale-98"
            >
              <Download className="w-4 h-4" />
              클라우드 공유용 GeoJSON 다운로드
            </button>
          </div>

          {/* Option 1: ESRI Shapefile ZIP (SHP) */}
          <div className="p-4 bg-slate-50/50 dark:bg-slate-950/80 border border-slate-200 dark:border-emerald-500/40 hover:border-emerald-500 rounded-2xl flex flex-col gap-3 transition shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Archive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">ESRI Shapefile 압축 번들 (.ZIP)</h3>
                  <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full font-bold uppercase">
                    GIS 표준 (PC 캐드용)
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  QGIS, ArcGIS 및 <strong>AutoCAD Map 3D</strong> 전용 형식입니다.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">압축 파일명:</span>
              <input
                type="text"
                value={shpFileName}
                onChange={e => setShpFileName(e.target.value)}
                placeholder="SHP 파일명 입력"
                className="bg-transparent text-emerald-700 dark:text-emerald-400 font-semibold outline-none flex-1 min-w-0"
              />
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0">.zip</span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <Info className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span className="text-slate-500 dark:text-slate-400">좌표계 정보(PRJ)는 포함되지 않습니다. (외부 앱에서 설정 권장)</span>
              </div>
            </div>

            <button
              onClick={handleExportSHP}
              disabled={isExportingShp || (points.length === 0 && totalLinesCount === 0 && polygons.length === 0)}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1.5 transition active:scale-98"
            >
              <Download className="w-4 h-4" />
              {isExportingShp ? 'Shapefile 생성 중...' : 'SHP 압축 번들 (.ZIP) 다운로드'}
            </button>
          </div>

          {/* Option 2: CSV Coordinates */}
          <div className="p-4 bg-slate-50/50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 hover:border-sky-500/50 rounded-2xl flex flex-col gap-3 transition shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-sky-600 dark:text-sky-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">측점 좌표 목록 CSV</h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                엑셀이나 측량 전용기용 표준 CSV 형식입니다.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex-1 flex items-center gap-1.5 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
                <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">CSV 파일명:</span>
                <input
                  type="text"
                  value={csvFileName}
                  onChange={e => setCsvFileName(e.target.value)}
                  placeholder="CSV 파일명 입력"
                  className="bg-transparent text-sky-700 dark:text-sky-400 font-semibold outline-none flex-1 min-w-0"
                />
                <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0">.csv</span>
              </div>
              
              <div className="flex items-center justify-between sm:justify-start gap-1.5 text-[11px] text-slate-500 bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-100 dark:border-slate-800">
                <span className="shrink-0">인코딩:</span>
                <select
                  value={csvEncoding}
                  onChange={e => setCsvEncoding(e.target.value as any)}
                  className="bg-transparent text-sky-700 dark:text-sky-400 outline-none font-medium"
                >
                  <option value="euc-kr">EUC-KR (CP949)</option>
                  <option value="utf-8">UTF-8</option>
                  <option value="utf-8-bom">UTF-8 with BOM (엑셀용)</option>
                </select>
              </div>
            </div>

            <button
              onClick={handleExportCSV}
              disabled={points.length === 0}
              className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md shadow-sky-600/30 flex items-center justify-center gap-1.5 transition active:scale-98"
            >
              <Download className="w-4 h-4" />
              CSV 다운로드
            </button>
          </div>


        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
