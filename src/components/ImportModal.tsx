/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef } from 'react';
import { 
  X, 
  Upload, 
  FileSpreadsheet, 
  Sparkles, 
  AlertCircle, 
  ArrowLeftRight,
  Check,
  Languages,
  Loader2,
  Layers,
  Archive,
  MapPin,
  Maximize2
} from 'lucide-react';
import { CADLayer, CADPoint, ProjectState } from '../types/cad';
import { 
  CSVColumnMapping, 
  CSVParseResult, 
  buildCADPointsFromCSV, 
  parseCSVPreview,
  analyzeTableRows 
} from '../utils/csvParser';
import { isExcelBuffer, parseExcelWorkbook } from '../utils/excelParser';
import { parseShapefileZip, parseShpBuffer, SHPParseResult } from '../utils/shpParser';
import { decodeBufferText, SupportedEncoding } from '../utils/encoding';

interface ImportModalProps {
  onImportCSVPoints: (points: CADPoint[], append: boolean) => void;
  onImportSHP: (data: SHPParseResult, append: boolean) => void;
  onLoadProject: (state: ProjectState) => void;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  onImportCSVPoints,
  onImportSHP,
  onLoadProject,
  onClose
}) => {
  const [appendMode, setAppendMode] = useState<boolean>(true);

  // Encoding State
  const [selectedEncoding, setSelectedEncoding] = useState<SupportedEncoding>('auto');
  const [detectedEncoding, setDetectedEncoding] = useState<'utf-8' | 'euc-kr' | null>(null);

  // Progress State
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parsingProgress, setParsingProgress] = useState<number>(0);
  const [parsingStatusMsg, setParsingStatusMsg] = useState<string>('');

  const rawBufferRef = useRef<{ buffer: ArrayBuffer; filename: string } | null>(null);

  // CSV/Excel State
  const [csvPreview, setCsvPreview] = useState<CSVParseResult | null>(null);
  const [isExcelFile, setIsExcelFile] = useState<boolean>(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const excelWorkbookRef = useRef<any>(null);
  const [currentRawRows, setCurrentRawRows] = useState<(string | number)[][] | null>(null);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);
  const [csvMapping, setCsvMapping] = useState<CSVColumnMapping>({
    xCol: 0, yCol: 1, nameCol: 2, zCol: -1, includeElevation: false
  });

  // SHP State
  const [shpResult, setShpResult] = useState<SHPParseResult | null>(null);
  const [shpFileName, setShpFileName] = useState<string | null>(null);

  const [loadedFormat, setLoadedFormat] = useState<'csv' | 'shp' | 'project' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const applyRowsToPreview = (rows: (string | number)[][], headerIdx: number = 0) => {
    try {
      setCurrentRawRows(rows);
      setHeaderRowIdx(headerIdx);
      const res = analyzeTableRows(rows, headerIdx);
      setCsvPreview(res);
      setCsvMapping(res.detectedMapping);
      setLoadedFormat('csv');
    } catch (err: any) {
      alert('표 데이터를 분석할 수 없습니다.');
    }
  };

  const processBuffer = async (buffer: ArrayBuffer, filename: string, enc: SupportedEncoding) => {
    rawBufferRef.current = { buffer, filename };
    const ext = filename.split('.').pop()?.toLowerCase();

    // 1. Project Backup (.cadgis or .json)
    if (ext === 'cadgis' || (ext === 'json' && !filename.includes('package'))) {
      try {
        const text = new TextDecoder('utf-8').decode(buffer);
        const projectData = JSON.parse(text) as ProjectState;
        if (projectData.points || projectData.lines || projectData.polylines) {
          onLoadProject(projectData);
          onClose();
          return;
        }
      } catch (err) {
        console.warn('Not a project JSON file, continuing to text analysis', err);
      }
    }

    // 2. Shapefile Zip (.zip)
    if (ext === 'zip') {
      try {
        setIsParsing(true);
        setParsingStatusMsg('Shapefile ZIP 압축 파일 분석 중...');
        setParsingProgress(40);
        const res = await parseShapefileZip(buffer);
        setParsingProgress(100);
        setShpResult(res);
        setShpFileName(filename);
        setLoadedFormat('shp');
        return;
      } catch (err: any) {
        alert('ZIP 파일 내 Shapefile 분석 오류: ' + err.message);
        return;
      } finally {
        setIsParsing(false);
      }
    }

    // 3. Standalone .shp file
    if (ext === 'shp') {
      try {
        setIsParsing(true);
        setParsingStatusMsg('ESRI .shp 바이너리 구조 분석 중...');
        setParsingProgress(50);
        const res = parseShpBuffer(buffer, filename);
        setParsingProgress(100);
        setShpResult(res);
        setShpFileName(filename);
        setLoadedFormat('shp');
        return;
      } catch (err: any) {
        alert('SHP 파일 분석 실패: ' + err.message);
        return;
      } finally {
        setIsParsing(false);
      }
    }

    // 4. Excel (.xlsx, .xls)
    if (isExcelBuffer(buffer, filename)) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('엑셀 워크북 분석 및 시트 추출 중...');
        const parsed = parseExcelWorkbook(buffer);
        excelWorkbookRef.current = parsed;
        setIsExcelFile(true);
        setExcelSheets(parsed.sheetNames);
        const initialSheet = parsed.sheetNames[0];
        setSelectedSheet(initialSheet);
        const rows = parsed.getSheetRows(initialSheet);
        applyRowsToPreview(rows, 0);
        setDetectedEncoding('utf-8');
        return;
      } catch (err: any) {
        console.warn('Excel fallback:', err);
      } finally {
        setIsParsing(false);
      }
    }

    // 5. CSV / Text
    const { text, detectedEncoding: det } = decodeBufferText(buffer, enc);
    setDetectedEncoding(det);

    try {
      const res = parseCSVPreview(text, 0);
      setCsvPreview(res);
      setCsvMapping(res.detectedMapping);
      setLoadedFormat('csv');
    } catch {
      alert('지원하지 않는 파일 형식이거나 읽을 수 없는 텍스트입니다. CSV, XLSX, 또는 SHP(.zip/.shp) 파일을 선택해 주세요.');
    }
  };

  const handleApplySHP = () => {
    if (!shpResult) return;
    onImportSHP(shpResult, appendMode);
    onClose();
  };

  const handleApplyCSV = () => {
    if (!csvPreview) return;
    const points = buildCADPointsFromCSV(csvPreview.allRows, csvMapping);
    if (points.length === 0) {
      alert('유효한 좌표가 없습니다. 열 매핑을 확인해 주세요.');
      return;
    }
    onImportCSVPoints(points, appendMode);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[94vh] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-900 dark:text-slate-100">
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/80">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-sky-600 dark:text-sky-400" />
              <span>좌표 및 도면 불러오기 (CSV / SHP)</span>
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              인터넷 연결 없이 기기 내부의 엑셀, CSV, Shapefile(.zip / .shp) 파일을 안전하게 불러옵니다.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Encoding & Merge Mode */}
        <div className="px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-950/70 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Languages className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400 shrink-0" />
            <span className="text-slate-500 dark:text-slate-400 text-[11px]">텍스트 인코딩:</span>
            <select
              value={selectedEncoding}
              onChange={e => {
                setSelectedEncoding(e.target.value as any);
                if (rawBufferRef.current) processBuffer(rawBufferRef.current.buffer, rawBufferRef.current.filename, e.target.value as any);
              }}
              disabled={isExcelFile || loadedFormat === 'shp'}
              className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sky-700 dark:text-sky-300 text-xs rounded-lg px-2 py-1 focus:outline-none shadow-sm"
            >
              <option value="auto">자동 감지 (CP949 / UTF-8)</option>
              <option value="euc-kr">CP949 / EUC-KR (한국 지적/측량 표준)</option>
              <option value="utf-8">UTF-8 (유니코드)</option>
            </select>
            {detectedEncoding && loadedFormat === 'csv' && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400 font-medium uppercase">
                {detectedEncoding} 적용됨
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-200 text-[11px]">
              <input type="radio" checked={appendMode} onChange={() => setAppendMode(true)} className="text-sky-500" />
              <span>기존 작업에 누적 추가</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-500 dark:text-slate-400 text-[11px]">
              <input type="radio" checked={!appendMode} onChange={() => setAppendMode(false)} className="text-sky-500" />
              <span>새로 시작 (기존 데이터 교체)</span>
            </label>
          </div>
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-50/30 dark:bg-slate-900/50">
          {!loadedFormat && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-sky-300 dark:border-sky-500/40 hover:border-sky-500 dark:hover:border-sky-400 bg-white dark:bg-slate-950/40 hover:bg-sky-50 dark:hover:bg-slate-800/40 rounded-3xl p-10 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 group"
            >
              <input
                ref={fileInputRef} type="file" className="hidden"
                accept=".xlsx,.xls,.csv,.txt,.shp,.zip,.cadgis"
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (file) processBuffer(await file.arrayBuffer(), file.name, selectedEncoding);
                  e.target.value = '';
                }}
              />
              <div className="w-16 h-16 rounded-3xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400 group-hover:scale-105 transition">
                {isParsing ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">파일 선택하여 불러오기</div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                측량 좌표(<strong>CSV / XLSX</strong>), GIS 도형(<strong>SHP / ZIP</strong>), 누적 프로젝트(<strong>.cadgis</strong>)를 지원합니다.
              </p>
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-[11px] text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 shadow-sm">
                  ✓ CSV / 엑셀 좌표 (X, Y, Z)
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-[11px] text-sky-600 dark:text-sky-400 border border-slate-200 dark:border-slate-700 shadow-sm">
                  ✓ ESRI Shapefile (.shp / .zip)
                </span>
              </div>
            </div>
          )}

          {isParsing && (
            <div className="p-4 bg-white dark:bg-slate-950 border border-sky-200 dark:border-sky-500/30 rounded-2xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between text-xs">
                <span className="text-sky-600 dark:text-sky-300 font-medium">{parsingStatusMsg}</span>
                <span className="font-mono text-slate-900 dark:text-white">{parsingProgress}%</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-sky-500 h-full transition-all" style={{ width: `${parsingProgress}%` }} />
              </div>
            </div>
          )}

          {/* SHP Preview & Confirmation */}
          {loadedFormat === 'shp' && shpResult && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-white dark:bg-slate-950 border border-emerald-100 dark:border-emerald-700/60 rounded-2xl space-y-4 shadow-sm">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="flex items-center gap-2">
                    <Archive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        {shpFileName || 'Shapefile 데이터'}
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        ESRI 표준 Shapefile 도형 데이터가 정상 분석되었습니다.
                      </p>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[11px] bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold">
                    SHP 정상
                  </span>
                </div>

                {/* Geometry Stats Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-center shadow-sm">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">측점 (Point)</div>
                    <div className="text-lg font-bold text-sky-600 dark:text-sky-400 mt-0.5">{shpResult.points.length}개</div>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-center shadow-sm">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">선 (Polyline)</div>
                    <div className="text-lg font-bold text-amber-600 dark:text-amber-400 mt-0.5">{shpResult.polylines.length + shpResult.lines.length}개</div>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-center shadow-sm">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">구역 (Polygon)</div>
                    <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">{shpResult.polygons.length}개</div>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-center shadow-sm">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">생성 레이어</div>
                    <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mt-0.5">{shpResult.layers.length}개</div>
                  </div>
                </div>

                {/* Bounds / Coordinate Extents */}
                {shpResult.bounds && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-900/80 border border-slate-100 dark:border-slate-800 rounded-xl text-[11px] text-slate-700 dark:text-slate-300 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                      <Maximize2 className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                      <span>도면 영역 (좌표 범위):</span>
                    </div>
                    <span className="font-mono text-slate-900 dark:text-slate-200">
                      X: [{shpResult.bounds.minX.toFixed(3)} ~ {shpResult.bounds.maxX.toFixed(3)}] · 
                      Y: [{shpResult.bounds.minY.toFixed(3)} ~ {shpResult.bounds.maxY.toFixed(3)}]
                    </span>
                  </div>
                )}
              </div>

              <button
                onClick={handleApplySHP}
                className="w-full py-3.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl shadow-lg shadow-emerald-600/30 transition active:scale-95 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>SHP 데이터 도면에 배치하기 (화면 자동맞춤)</span>
              </button>
            </div>
          )}

          {/* CSV Mapping */}
          {loadedFormat === 'csv' && csvPreview && (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl space-y-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
                  <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-700/60 rounded-lg text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
                    <Check className="w-3.5 h-3.5" /> 측점 {csvPreview.totalRows.toLocaleString()}개 감지됨
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-500 dark:bg-sky-400 inline-block"></span>
                    <span>캐드 좌표계 기준 (X: 수평, Y: 수직) · 항목 텍스트 표시</span>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-sky-600 dark:text-sky-400 font-bold ml-1 flex items-center gap-1">
                      <span>CAD X 좌표 (수평)</span>
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={csvMapping.xCol}
                      onChange={e => setCsvMapping(m => ({ ...m, xCol: parseInt(e.target.value) }))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium shadow-sm"
                    >
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i + 1})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] text-sky-600 dark:text-sky-400 font-bold ml-1 flex items-center gap-1">
                      <span>CAD Y 좌표 (수직)</span>
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={csvPreview.headers.length > 1 ? csvMapping.yCol : 0}
                      onChange={e => setCsvMapping(m => ({ ...m, yCol: parseInt(e.target.value) }))}
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium shadow-sm"
                    >
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i + 1})</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] text-amber-600 dark:text-amber-400 font-bold ml-1 flex items-center gap-1">
                      <span>항목 (도면 표시 텍스트)</span>
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={csvMapping.nameCol ?? -1}
                      onChange={e => setCsvMapping(m => ({ ...m, nameCol: parseInt(e.target.value) }))}
                      className="w-full bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-500/40 text-amber-900 dark:text-amber-200 text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-amber-500 font-medium shadow-sm"
                    >
                      <option value={-1}>사용 안함 (기본 번호)</option>
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i + 1})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Optional Z elevation */}
                {csvPreview.headers.length > 2 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">표고(고도 Z) 속성:</span>
                      <select
                        value={csvMapping.zCol ?? -1}
                        onChange={e => {
                          const val = parseInt(e.target.value);
                          setCsvMapping(m => ({
                            ...m,
                            zCol: val,
                            includeElevation: val >= 0
                          }));
                        }}
                        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium shadow-sm"
                      >
                        <option value={-1}>사용 안함 (고도 제외)</option>
                        {csvPreview.headers.map((h, i) => (
                          <option key={i} value={i}>{h} (열 {i + 1})</option>
                        ))}
                      </select>
                    </div>
                    <span className="text-[11px] text-slate-400 dark:text-slate-400 italic">
                      * 측점표 및 SHP/CSV 내보내기 속성에만 저장됩니다.
                    </span>
                  </div>
                )}

                {/* Data Preview Table */}
                {csvPreview.sampleRows.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold flex items-center justify-between">
                      <span>데이터 미리보기 (상위 {Math.min(3, csvPreview.sampleRows.length)}행)</span>
                      <span className="text-slate-400 dark:text-slate-500">도면에는 점과 함께 항목 텍스트가 표시됩니다</span>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-[11px] shadow-inner">
                      <table className="w-full text-left font-mono">
                        <thead className="bg-slate-100 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 text-[10px]">
                          <tr>
                            <th className="py-1.5 px-3">CAD X</th>
                            <th className="py-1.5 px-3">CAD Y</th>
                            <th className="py-1.5 px-3 text-amber-700 dark:text-amber-300">항목 (텍스트)</th>
                            {csvMapping.includeElevation && <th className="py-1.5 px-3">표고(Z)</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                          {csvPreview.sampleRows.slice(0, 3).map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-white dark:hover:bg-slate-800/30">
                              <td className="py-1.5 px-3 text-sky-600 dark:text-sky-400">{row[csvMapping.xCol] || '-'}</td>
                              <td className="py-1.5 px-3 text-sky-600 dark:text-sky-400">{row[csvMapping.yCol] || '-'}</td>
                              <td className="py-1.5 px-3 font-semibold text-amber-600 dark:text-amber-300">
                                {csvMapping.nameCol !== undefined && csvMapping.nameCol >= 0 ? (row[csvMapping.nameCol] || '-') : String(rIdx + 1)}
                              </td>
                              {csvMapping.includeElevation && (
                                <td className="py-1.5 px-3 text-slate-500 dark:text-slate-400">
                                  {csvMapping.zCol !== undefined && csvMapping.zCol >= 0 ? (row[csvMapping.zCol] || '-') : '-'}
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              <button 
                onClick={handleApplyCSV} 
                className="w-full py-3.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white font-bold rounded-xl shadow-lg shadow-sky-600/30 transition active:scale-95 flex items-center justify-center gap-2"
              >
                <Check className="w-4 h-4" />
                <span>측점 데이터 도면에 배치하기 (화면 자동맞춤)</span>
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <button onClick={() => setLoadedFormat(null)} className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition">다른 파일 선택</button>
          <button onClick={onClose} className="px-6 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-white text-xs font-bold rounded-xl transition">닫기</button>
        </div>
      </div>
    </div>
  );
};
