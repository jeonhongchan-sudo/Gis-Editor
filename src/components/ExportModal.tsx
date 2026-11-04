/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  X, 
  Download, 
  Archive, 
  FileSpreadsheet, 
  Save, 
  Check, 
  Layers,
  Globe2,
  Info,
  FileText,
  Edit3
} from 'lucide-react';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, ProjectState } from '../types/cad';
import { downloadBlob, downloadTextFile, exportToShapefileZip } from '../utils/shpExporter';
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
  const [selectedCrs, setSelectedCrs] = useState<string>('EPSG:5186');
  const [isExportingShp, setIsExportingShp] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  // Encoding states
  const [shpEncoding, setShpEncoding] = useState<'utf-8' | 'euc-kr'>('euc-kr');
  const [csvEncoding, setCsvEncoding] = useState<'utf-8' | 'euc-kr' | 'utf-8-bom'>('euc-kr');

  // Custom User Filename States
  const todayStr = new Date().toISOString().slice(0, 10);
  const [baseProjectName, setBaseProjectName] = useState<string>(() => `현장성과_${new Date().toISOString().slice(0, 10)}`);
  const [shpFileName, setShpFileName] = useState<string>(() => `gis_shapefiles_${new Date().toISOString().slice(0, 10)}`);
  const [csvFileName, setCsvFileName] = useState<string>(() => `survey_coordinates_${new Date().toISOString().slice(0, 10)}`);
  const [projectFileName, setProjectFileName] = useState<string>(() => `cad_project_${new Date().toISOString().slice(0, 10)}`);

  const totalLinesCount = lines.length + polylines.length;

  const showSuccess = (msg: string) => {
    setExportSuccessMsg(msg);
    setTimeout(() => setExportSuccessMsg(null), 3000);
  };

  // 1. Export Shapefile ZIP
  const handleExportSHP = async () => {
    try {
      setIsExportingShp(true);
      const blob = await exportToShapefileZip({
        points,
        lines,
        polylines,
        polygons,
        crs: selectedCrs,
        encoding: shpEncoding
      });
      const cleanName = (shpFileName.trim() || `gis_shapefiles_${todayStr}`).replace(/\.zip$/i, '');
      const filename = `${cleanName}.zip`;
      downloadBlob(blob, filename);
      showSuccess(`SHP 압축 파일(${filename})이 정상 생성되었습니다.`);
    } catch (err: any) {
      alert('Shapefile 생성 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsExportingShp(false);
    }
  };

  // 2. Export Points CSV
  const handleExportCSV = () => {
    const csvLines = ['번호,측점명,X(Easting),Y(Northing),고도(Z),레이어'];
    points.forEach((p, idx) => {
      csvLines.push(`${idx + 1},"${p.name}",${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z !== undefined ? p.z.toFixed(3) : ''},"${p.layerId}"`);
    });
    const cleanName = (csvFileName.trim() || `survey_coordinates_${todayStr}`).replace(/\.csv$/i, '');
    const filename = `${cleanName}.csv`;
    downloadTextFile(csvLines.join('\n'), filename, csvEncoding, 'text/csv');
    showSuccess(`${filename} 측점 CSV가 저장되었습니다.`);
  };

  // 3. Export Project JSON / CADGIS
  const handleExportProject = () => {
    const cleanName = (projectFileName.trim() || `cad_project_${todayStr}`).replace(/\.cadgis$/i, '');
    const project: ProjectState = {
      version: '1.0.0',
      name: cleanName,
      layers,
      points,
      lines,
      polylines,
      polygons,
      texts
    };
    const jsonStr = JSON.stringify(project, null, 2);
    const filename = `${cleanName}.cadgis`;
    downloadTextFile(jsonStr, filename, 'utf-8', 'application/json');
    showSuccess(`프로젝트 누적 백업 파일(${filename})이 저장되었습니다.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>성과물 내보내기 (SHP / CSV)</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              GIS 표준 Shapefile(.zip) 또는 좌표 CSV 파일로 데이터를 즉시 내보냅니다.
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
                  const sanitized = val.trim();
                  setShpFileName(`${sanitized || 'gis_shapefiles'}_shp`);
                  setCsvFileName(`${sanitized || 'survey_coordinates'}_pts`);
                  setProjectFileName(`${sanitized || 'cad_project'}`);
                }}
                placeholder="예: 261104_현장측량성과"
                className="bg-transparent text-slate-900 dark:text-white font-medium outline-none w-full text-xs"
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
          {/* Option 1: ESRI Shapefile ZIP (SHP) */}
          <div className="p-4 bg-slate-50/50 dark:bg-slate-950/80 border border-slate-200 dark:border-emerald-500/40 hover:border-emerald-500 rounded-2xl flex flex-col gap-3 transition shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Archive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">ESRI Shapefile 압축 번들 (.ZIP)</h3>
                  <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-0.5 rounded-full font-bold uppercase">
                    GIS 표준 권장
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  QGIS, ArcGIS 및 <strong>AutoCAD Map 3D(MAPIMPORT)</strong>에서 <strong>객체 데이터(OD Table)</strong>로 즉시 연동되는 <strong>.shp, .shx, .dbf, .prj</strong> 파일 패키지입니다.
                  선/폴리라인에 기록된 시설구분, 규격, 매설심도, 상태 등의 현장 OD 속성이 DBF 테이블로 완전 보존됩니다.
                </p>
              </div>
            </div>

            {/* Direct Filename Input */}
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

            {/* Coordinate System Selector for .PRJ */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <Globe2 className="w-4 h-4 text-sky-600 dark:text-sky-400" />
                <span className="text-slate-500 dark:text-slate-400">좌표계 정의(PRJ):</span>
              </div>
              <select
                value={selectedCrs}
                onChange={e => setSelectedCrs(e.target.value)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sky-700 dark:text-sky-300 text-xs rounded-lg px-2.5 py-1 focus:outline-none shadow-sm"
              >
                {Object.entries(COORDINATE_SYSTEMS).map(([code, def]) => (
                  <option key={code} value={code}>
                    {def.name} ({code})
                  </option>
                ))}
              </select>
            </div>

            {/* Encoding Selector for DBF */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs mt-1">
              <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300">
                <span className="text-slate-500 dark:text-slate-400">속성 인코딩 (DBF):</span>
              </div>
              <select
                value={shpEncoding}
                onChange={e => setShpEncoding(e.target.value as any)}
                className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sky-700 dark:text-sky-300 text-xs rounded-lg px-2.5 py-1 focus:outline-none shadow-sm"
              >
                <option value="euc-kr">EUC-KR / CP949 (한국 캐드 표준)</option>
                <option value="utf-8">UTF-8 (유니코드 / 최신 QGIS)</option>
              </select>
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
                엑셀이나 측량 전용기에서 열어볼 수 있는 표준 CSV 형식 좌표 파일입니다.
              </p>
            </div>

            {/* Direct Filename Input & Encoding */}
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

          {/* Option 3: Project Save (.cadgis) */}
          <div className="p-4 bg-slate-50/50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 hover:border-purple-500/50 rounded-2xl flex flex-col gap-3 transition shadow-sm">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Save className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-white">작업 누적 보관 파일 (.cadgis)</h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                작업했던 레이어, 측점, 선, 폴리곤 및 텍스트를 누적 저장하여 다음에 이어서 작업할 때 사용합니다.
              </p>
            </div>

            {/* Direct Filename Input */}
            <div className="flex items-center gap-1.5 p-2 bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 text-xs">
              <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">백업 파일명:</span>
              <input
                type="text"
                value={projectFileName}
                onChange={e => setProjectFileName(e.target.value)}
                placeholder="프로젝트 파일명 입력"
                className="bg-transparent text-purple-700 dark:text-purple-400 font-semibold outline-none flex-1 min-w-0"
              />
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500 shrink-0">.cadgis</span>
            </div>

            <button
              onClick={handleExportProject}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-purple-600/30 flex items-center justify-center gap-1.5 transition active:scale-98"
            >
              <Download className="w-4 h-4" />
              프로젝트 파일 백업 (.cadgis)
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
