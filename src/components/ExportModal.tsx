/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { 
  X, 
  Download, 
  FileCode, 
  Archive, 
  FileSpreadsheet, 
  Save, 
  Check, 
  Layers,
  Info
} from 'lucide-react';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, ProjectState } from '../types/cad';
import { downloadTextFile, exportToDXF } from '../utils/dxfExporter';
import { downloadBlob, exportToShapefileZip } from '../utils/shpExporter';
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
  const [includeLabels, setIncludeLabels] = useState(true);
  const [isExportingShp, setIsExportingShp] = useState(false);
  const [exportSuccessMsg, setExportSuccessMsg] = useState<string | null>(null);

  const totalLinesCount = lines.length + polylines.length;

  const showSuccess = (msg: string) => {
    setExportSuccessMsg(msg);
    setTimeout(() => setExportSuccessMsg(null), 3000);
  };

  // 1. Export DXF
  const handleExportDXF = () => {
    const dxfString = exportToDXF({
      layers,
      points,
      lines,
      polylines,
      polygons,
      texts,
      includePointLabels: includeLabels
    });
    const filename = `cad_export_${new Date().toISOString().slice(0, 10)}.dxf`;
    downloadTextFile(dxfString, filename, 'application/dxf');
    showSuccess(`${filename} 파일이 다운로드되었습니다.`);
  };

  // 2. Export Shapefile ZIP
  const handleExportSHP = async () => {
    try {
      setIsExportingShp(true);
      const blob = await exportToShapefileZip({
        points,
        lines,
        polylines,
        polygons,
        crs: 'EPSG:5186' // Defaulting to standard Korean TM as selection was removed
      });
      const filename = `gis_shapefiles_${new Date().toISOString().slice(0, 10)}.zip`;
      downloadBlob(blob, filename);
      showSuccess(`SHP 압축 파일(${filename})이 정상 생성되었습니다.`);
    } catch (err: any) {
      alert('Shapefile 생성 중 오류가 발생했습니다: ' + err.message);
    } finally {
      setIsExportingShp(false);
    }
  };

  // 3. Export Project JSON / CADGIS
  const handleExportProject = () => {
    const project: ProjectState = {
      version: '1.0.0',
      name: '도면작업_' + new Date().toISOString().slice(0, 10),
      layers,
      points,
      lines,
      polylines,
      polygons,
      texts
    };
    const jsonStr = JSON.stringify(project, null, 2);
    const filename = `cad_project_${new Date().toISOString().slice(0, 10)}.cadgis`;
    downloadTextFile(jsonStr, filename, 'application/json');
    showSuccess(`프로젝트 누적 백업 파일(${filename})이 저장되었습니다.`);
  };

  // 4. Export Points CSV
  const handleExportCSV = () => {
    const csvLines = ['번호,측점명,X(Easting),Y(Northing),고도(Z),레이어'];
    points.forEach((p, idx) => {
      csvLines.push(`${idx + 1},"${p.name}",${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z !== undefined ? p.z.toFixed(4) : ''},"${p.layerId}"`);
    });
    const filename = `survey_coordinates_${new Date().toISOString().slice(0, 10)}.csv`;
    downloadTextFile(csvLines.join('\n'), filename, 'text/csv');
    showSuccess(`${filename} 측점 CSV가 저장되었습니다.`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-2xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800">
          <div>
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <Download className="w-5 h-5 text-sky-400" />
              <span>도면 및 성과물 내보내기</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              원하는 CAD(DXF) 또는 GIS(SHP) 파일 포맷을 선택하여 즉시 다운로드합니다.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Project Summary Badge */}
        <div className="p-3 bg-slate-950/80 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-slate-300">
            <Layers className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-slate-400">데이터 구성 요약:</span>
          </div>

          <div className="flex items-center gap-3 text-slate-400">
            <span>측점: <strong className="text-white">{points.length}</strong></span>
            <span>선: <strong className="text-white">{totalLinesCount}</strong></span>
            <span>폴리곤: <strong className="text-white">{polygons.length}</strong></span>
          </div>
        </div>

        {/* Success Alert */}
        {exportSuccessMsg && (
          <div className="mx-4 mt-3 p-3 bg-emerald-950/80 border border-emerald-700 rounded-xl flex items-center gap-2 text-emerald-300 text-xs animate-in fade-in">
            <Check className="w-4 h-4 shrink-0" />
            <span>{exportSuccessMsg}</span>
          </div>
        )}

        {/* Export Options Grid */}
        <div className="p-4 space-y-3 overflow-y-auto max-h-[60vh] custom-scrollbar">
          {/* Option 1: AutoCAD DXF */}
          <div className="p-4 bg-slate-950/60 border border-slate-800 hover:border-sky-500/60 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileCode className="w-5 h-5 text-sky-400" />
                <h3 className="text-sm font-semibold text-white">AutoCAD 도면 (DXF 파일)</h3>
                <span className="text-[10px] bg-sky-950 text-sky-400 border border-sky-800 px-1.5 py-0.5 rounded">
                  추천 포맷
                </span>
              </div>
              <p className="text-xs text-slate-400">
                오토캐드, ZWCAD, 캐디안, Civil 3D 등 모든 CAD 소프트웨어에서 그대로 열리는 표준 DXF 파일입니다.
              </p>
              <label className="flex items-center gap-1.5 text-xs text-slate-300 pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeLabels}
                  onChange={e => setIncludeLabels(e.target.checked)}
                  className="rounded text-sky-500 focus:ring-sky-500"
                />
                <span>측점 번호 및 이름 텍스트 라벨 포함</span>
              </label>
            </div>

            <button
              onClick={handleExportDXF}
              className="w-full sm:w-auto px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-sky-600/30 flex items-center justify-center gap-1.5 shrink-0 transition"
            >
              <Download className="w-4 h-4" />
              DXF 다운로드
            </button>
          </div>

          {/* Option 2: ESRI Shapefile ZIP (SHP) */}
          <div className="p-4 bg-slate-950/60 border border-slate-800 hover:border-emerald-500/60 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Archive className="w-5 h-5 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">ESRI Shapefile 압축 번들 (.ZIP)</h3>
                <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800 px-1.5 py-0.5 rounded">
                  GIS 표준
                </span>
              </div>
              <p className="text-xs text-slate-400">
                QGIS, ArcGIS에서 사용하는 <strong>.shp, .shx, .dbf, .prj</strong> 4개 파일이 압축된 ZIP입니다.
                좌표계 정의(PRJ)가 포함되어 좌표 오차 없이 열립니다.
              </p>
            </div>

            <button
              onClick={handleExportSHP}
              disabled={isExportingShp}
              className="w-full sm:w-auto px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1.5 shrink-0 transition"
            >
              <Download className="w-4 h-4" />
              {isExportingShp ? '생성 중...' : 'SHP (ZIP) 다운로드'}
            </button>
          </div>

          {/* Option 3: Project Save (.cadgis) */}
          <div className="p-4 bg-slate-950/60 border border-slate-800 hover:border-purple-500/60 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Save className="w-5 h-5 text-purple-400" />
                <h3 className="text-sm font-semibold text-white">작업 누적 보관 파일 (.cadgis)</h3>
              </div>
              <p className="text-xs text-slate-400">
                전날 작업했던 레이어, 측점, 선, 면적 등을 누적 저장하여 다음 날 이어서 작업할 때 사용합니다.
              </p>
            </div>

            <button
              onClick={handleExportProject}
              className="w-full sm:w-auto px-4 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-xl shadow-md shadow-purple-600/30 flex items-center justify-center gap-1.5 shrink-0 transition"
            >
              <Download className="w-4 h-4" />
              프로젝트 파일 저장
            </button>
          </div>

          {/* Option 4: CSV Coordinates */}
          <div className="p-4 bg-slate-950/60 border border-slate-800 hover:border-slate-600 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-amber-400" />
                <h3 className="text-sm font-semibold text-white">측점 좌표 목록 CSV</h3>
              </div>
              <p className="text-xs text-slate-400">
                엑셀이나 측량 프로그램에서 열 수 있는 표준 CSV 형식 좌표 파일입니다.
              </p>
            </div>

            <button
              onClick={handleExportCSV}
              disabled={points.length === 0}
              className="w-full sm:w-auto px-4 py-2.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center justify-center gap-1.5 shrink-0 transition"
            >
              <Download className="w-4 h-4" />
              CSV 다운로드
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
