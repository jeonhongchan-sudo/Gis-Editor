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
  ClipboardPaste,
  HardDrive,
  Languages,
  Loader2,
  TableProperties,
  Layers,
  ChevronDown,
  Info
} from 'lucide-react';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, ProjectState } from '../types/cad';
import { 
  CSVColumnMapping, 
  CSVParseResult, 
  SAMPLE_SURVEY_CSV_EPSG5186, 
  buildCADPointsFromCSV, 
  parseCSVPreview,
  analyzeTableRows 
} from '../utils/csvParser';
import { isExcelBuffer, parseExcelWorkbook } from '../utils/excelParser';
import { parseDXFAsync } from '../utils/dxfParser';
import { parseShapefileZip, parseShpBuffer, SHPParseResult } from '../utils/shpParser';
import { decodeBufferText, SupportedEncoding } from '../utils/encoding';

interface ImportModalProps {
  onImportCSVPoints: (points: CADPoint[], append: boolean) => void;
  onImportDXF: (data: {
    layers: CADLayer[];
    points: CADPoint[];
    lines: CADLine[];
    polylines: CADPolyline[];
    polygons: CADPolygon[];
    texts: CADText[];
  }, append: boolean) => void;
  onLoadProject: (state: ProjectState) => void;
  onClose: () => void;
}

export const ImportModal: React.FC<ImportModalProps> = ({
  onImportCSVPoints,
  onImportDXF,
  onLoadProject,
  onClose
}) => {
  const [activeTab, setActiveTab] = useState<'file' | 'paste' | 'sample'>('file');
  const [appendMode, setAppendMode] = useState<boolean>(true);

  // Encoding State (CP949 / EUC-KR vs UTF-8)
  const [selectedEncoding, setSelectedEncoding] = useState<SupportedEncoding>('auto');
  const [detectedEncoding, setDetectedEncoding] = useState<'utf-8' | 'euc-kr' | null>(null);

  // Progress State for large DXF
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parsingProgress, setParsingProgress] = useState<number>(0);
  const [parsingStatusMsg, setParsingStatusMsg] = useState<string>('');

  // Cached raw buffer for instant re-decoding / sheet switching
  const rawBufferRef = useRef<{ buffer: ArrayBuffer; filename: string } | null>(null);

  // Excel Specific State
  const [isExcelFile, setIsExcelFile] = useState<boolean>(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const excelWorkbookRef = useRef<any>(null);

  // CSV / Table State
  const [csvPreview, setCsvPreview] = useState<CSVParseResult | null>(null);
  const [currentRawRows, setCurrentRawRows] = useState<(string | number)[][] | null>(null);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);

  const [csvMapping, setCsvMapping] = useState<CSVColumnMapping>({
    idCol: 0,
    xCol: 1,
    yCol: 2,
    zCol: 3,
    nameCol: 4,
    swapXY: true,
    includeElevation: false
  });
  const [csvError, setCsvError] = useState<string | null>(null);

  // DXF State
  const [dxfFileName, setDxfFileName] = useState<string | null>(null);
  const [dxfStats, setDxfStats] = useState<{
    points: number;
    lines: number;
    polylines: number;
    polygons: number;
    texts: number;
    layers: number;
  } | null>(null);
  const [parsedDxfData, setParsedDxfData] = useState<any | null>(null);

  // SHP State
  const [shpStats, setShpStats] = useState<SHPParseResult | null>(null);
  const [shpFileName, setShpFileName] = useState<string | null>(null);

  // Paste Text state
  const [pasteContent, setPasteContent] = useState('');

  // Loaded format notification
  const [loadedFormat, setLoadedFormat] = useState<'csv' | 'dxf' | 'shp' | 'project' | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Update preview when raw rows or header row index changes
  const applyRowsToPreview = (rows: (string | number)[][], headerIdx: number = 0) => {
    try {
      setCsvError(null);
      setCurrentRawRows(rows);
      setHeaderRowIdx(headerIdx);
      const res = analyzeTableRows(rows, headerIdx);
      setCsvPreview(res);
      setCsvMapping(res.detectedMapping);
      setLoadedFormat('csv');
    } catch (err: any) {
      setCsvError(err.message || '표 데이터를 분석할 수 없습니다.');
      setCsvPreview(null);
    }
  };

  const processCSVText = (text: string, headerIdx: number = 0) => {
    try {
      setCsvError(null);
      const res = parseCSVPreview(text, headerIdx);
      setCsvPreview(res);
      setCsvMapping(res.detectedMapping);
      setHeaderRowIdx(res.headerRowIndex);
      setLoadedFormat('csv');
    } catch (err: any) {
      setCsvError(err.message || 'CSV 파싱 실패');
      setCsvPreview(null);
    }
  };

  const handleSelectExcelSheet = (sheetName: string) => {
    setSelectedSheet(sheetName);
    if (excelWorkbookRef.current) {
      try {
        const rows = excelWorkbookRef.current.getSheetRows(sheetName);
        applyRowsToPreview(rows, 0);
      } catch (err: any) {
        setCsvError('시트 데이터를 읽는 중 오류가 발생했습니다: ' + err.message);
      }
    }
  };

  const processBuffer = async (buffer: ArrayBuffer, filename: string, enc: SupportedEncoding) => {
    rawBufferRef.current = { buffer, filename };
    const ext = filename.split('.').pop()?.toLowerCase();

    // 1. Shapefile (.shp or .zip)
    if (ext === 'shp') {
      setIsExcelFile(false);
      try {
        const res = parseShpBuffer(buffer, filename);
        setShpStats(res);
        setShpFileName(filename);
        setLoadedFormat('shp');
      } catch (err: any) {
        alert('SHP 파일 분석 실패: ' + err.message);
      }
      return;
    }

    if (ext === 'zip') {
      // Could be shapefile zip or something else; check for shp
      try {
        const res = await parseShapefileZip(buffer);
        setShpStats(res);
        setShpFileName(filename);
        setLoadedFormat('shp');
        setIsExcelFile(false);
        return;
      } catch {
        // Not a shapefile zip; continue to check if excel
      }
    }

    // 2. Excel Workbook (.xlsx, .xls or renamed binary file)
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
        setDetectedEncoding('utf-8'); // Excel internally provides pristine Unicode
        return;
      } catch (err: any) {
        // If excel parsing fails, fall through to text decoder
        console.warn('Excel parsing failed, trying text fallback:', err);
      } finally {
        setIsParsing(false);
      }
    }

    setIsExcelFile(false);

    // 3. Text Decoding with CP949 or UTF-8
    const { text, detectedEncoding: det } = decodeBufferText(buffer, enc);
    setDetectedEncoding(det);

    // 4. Project File (.cadgis / .json)
    if (ext === 'json' || ext === 'cadgis') {
      try {
        const data = JSON.parse(text);
        if (data.points || data.layers || data.lines) {
          onLoadProject(data);
          onClose();
          return;
        }
      } catch (e) {
        // Fallback to text parsing
      }
    }

    // 5. DXF or CSV
    if (text.includes('SECTION') && text.includes('ENTITIES')) {
      // Recognized DXF ASCII format
      setIsParsing(true);
      setParsingProgress(0);
      setParsingStatusMsg('대용량 DXF 도면 파싱 및 레이어 분석 중...');
      setDxfFileName(filename);

      try {
        const result = await parseDXFAsync(text, percent => {
          setParsingProgress(percent);
          setParsingStatusMsg(`대용량 DXF 도면 파싱 중... (${percent}%)`);
        });

        setParsedDxfData(result);
        setDxfStats({
          points: result.points.length,
          lines: result.lines.length,
          polylines: result.polylines.length,
          polygons: result.polygons.length,
          texts: result.texts.length,
          layers: result.layers.length
        });
        setLoadedFormat('dxf');
      } catch (err: any) {
        alert('DXF 도면 파싱 중 오류가 발생했습니다: ' + err.message);
      } finally {
        setIsParsing(false);
      }
    } else {
      // Treat as CSV / TSV / Space-delimited coordinates
      processCSVText(text, 0);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const buffer = await file.arrayBuffer();
      processBuffer(buffer, file.name, selectedEncoding);
    }
    e.target.value = '';
  };

  // Re-decode with new encoding choice without picking file again
  const handleChangeEncoding = (newEnc: SupportedEncoding) => {
    setSelectedEncoding(newEnc);
    if (rawBufferRef.current && !isExcelFile) {
      processBuffer(rawBufferRef.current.buffer, rawBufferRef.current.filename, newEnc);
    }
  };

  const handleChangeHeaderRow = (newHeaderIdx: number) => {
    setHeaderRowIdx(newHeaderIdx);
    if (currentRawRows) {
      applyRowsToPreview(currentRawRows, newHeaderIdx);
    } else if (rawBufferRef.current && !isExcelFile) {
      const { text } = decodeBufferText(rawBufferRef.current.buffer, selectedEncoding);
      processCSVText(text, newHeaderIdx);
    }
  };

  const handleLoadSampleCSV = () => {
    setIsExcelFile(false);
    processCSVText(SAMPLE_SURVEY_CSV_EPSG5186, 0);
  };

  const handleApplyCSV = () => {
    if (!csvPreview) return;
    const points = buildCADPointsFromCSV(csvPreview.allRows, csvMapping);
    if (points.length === 0) {
      alert('유효한 좌표가 변환되지 않았습니다. 열 매핑(X, Y)을 확인하세요.');
      return;
    }
    onImportCSVPoints(points, appendMode);
    onClose();
  };

  const handleApplyDXF = () => {
    if (!parsedDxfData) return;
    onImportDXF(parsedDxfData, appendMode);
    onClose();
  };

  const handleApplySHP = () => {
    if (!shpStats) return;
    const newLayer: CADLayer = {
      id: `layer-shp-${Date.now()}`,
      name: shpStats.layerName || 'SHP_도면',
      color: '#34d399',
      visible: true,
      locked: false,
      lineWidth: 2
    };

    onImportDXF({
      layers: [newLayer],
      points: shpStats.points,
      lines: shpStats.lines,
      polylines: shpStats.polylines,
      polygons: shpStats.polygons,
      texts: []
    }, appendMode);
    onClose();
  };

  const handleParsePastedText = async () => {
    if (!pasteContent.trim()) return;
    setIsExcelFile(false);
    if (pasteContent.includes('SECTION') && pasteContent.includes('ENTITIES')) {
      setIsParsing(true);
      setParsingProgress(0);
      try {
        const result = await parseDXFAsync(pasteContent, percent => setParsingProgress(percent));
        setParsedDxfData(result);
        setDxfFileName('붙여넣은 DXF');
        setDxfStats({
          points: result.points.length,
          lines: result.lines.length,
          polylines: result.polylines.length,
          polygons: result.polygons.length,
          texts: result.texts.length,
          layers: result.layers.length
        });
        setLoadedFormat('dxf');
      } finally {
        setIsParsing(false);
      }
    } else {
      processCSVText(pasteContent, 0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-4xl max-h-[94vh] bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-slate-800 bg-slate-950/80">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
              <span>도면 & 좌표 데이터 불러오기</span>
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
              Excel (.xlsx, .xls), CSV, DXF, SHP 지원 · 한글 CP949(EUC-KR) 및 시트/항목 선택
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Top Controls: Encoding & Merge Mode */}
        <div className="px-3.5 py-2.5 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          {/* Korean Encoding Selector */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Languages className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="text-slate-400 text-[11px]">문자 인코딩:</span>
            <select
              value={selectedEncoding}
              onChange={e => handleChangeEncoding(e.target.value as SupportedEncoding)}
              disabled={isExcelFile}
              className="bg-slate-800 border border-slate-700 text-sky-300 text-xs rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium cursor-pointer disabled:opacity-50"
            >
              <option value="auto">자동 감지 (CP949 / UTF-8)</option>
              <option value="euc-kr">CP949 / EUC-KR (한국 캐드/측량 표준)</option>
              <option value="utf-8">UTF-8 (유니코드)</option>
            </select>

            {isExcelFile ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-950 border border-sky-800 text-sky-300 font-medium flex items-center gap-1">
                <FileSpreadsheet className="w-3 h-3 text-sky-400" />
                Excel 바이너리 파서 적용됨 (한글 완벽 지원)
              </span>
            ) : detectedEncoding ? (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-400 font-medium">
                {detectedEncoding.toUpperCase()} 적용됨
              </span>
            ) : null}
          </div>

          {/* Merge Mode Toggle */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-200 text-[11px]">
              <input
                type="radio"
                name="appendMode"
                checked={appendMode}
                onChange={() => setAppendMode(true)}
                className="text-sky-500 focus:ring-sky-500"
              />
              <span>기존 작업에 누적 추가</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-400 text-[11px]">
              <input
                type="radio"
                name="appendMode"
                checked={!appendMode}
                onChange={() => setAppendMode(false)}
                className="text-sky-500 focus:ring-sky-500"
              />
              <span>새로 시작</span>
            </label>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-slate-800 bg-slate-950/40 px-3 sm:px-4 pt-1.5 gap-1 overflow-x-auto">
          <button
            onClick={() => setActiveTab('file')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-xl transition whitespace-nowrap ${
              activeTab === 'file'
                ? 'border-b-2 border-sky-500 text-sky-400 bg-slate-900 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-3.5 h-3.5" />
            파일 선택 (엑셀 .xlsx, .csv, .dxf, .shp)
          </button>
          <button
            onClick={() => setActiveTab('paste')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-xl transition whitespace-nowrap ${
              activeTab === 'paste'
                ? 'border-b-2 border-sky-500 text-sky-400 bg-slate-900 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
            텍스트 직접 붙여넣기
          </button>
          <button
            onClick={() => setActiveTab('sample')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-t-xl transition whitespace-nowrap ${
              activeTab === 'sample'
                ? 'border-b-2 border-sky-500 text-sky-400 bg-slate-900 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            샘플 데이터
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-3.5 custom-scrollbar">
          {/* TAB 1: FILE PICKER */}
          {activeTab === 'file' && (
            <div className="space-y-3">
              <div className="p-3 bg-sky-950/40 border border-sky-800/80 rounded-xl text-xs text-sky-200 flex items-start gap-2.5">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div className="leading-relaxed text-[11px] sm:text-xs">
                  <strong>💡 파일 선택 & 시트 지원 안내:</strong><br />
                  • 엑셀 파일(<strong>.xlsx, .xls</strong>) 및 <strong>.csv, .txt, .dxf, .shp</strong> 모두 지원됩니다.<br />
                  • 엑셀 워크북 내 <strong>여러 시트(Sheet)</strong>가 포함되어 있으면 원하는 시트를 즉시 선택하여 변환할 수 있습니다.<br />
                  • 태블릿에서 사진 대신 파일 탐색기(<strong>[내 파일], [파일], [다운로드]</strong>)를 선택해 주세요.
                </div>
              </div>

              {/* Main File Selector Box */}
              <div
                onClick={() => !isParsing && fileInputRef.current?.click()}
                className={`border-2 border-dashed border-sky-500/60 hover:border-sky-400 bg-slate-950/60 hover:bg-slate-800/50 rounded-2xl p-5 sm:p-7 text-center cursor-pointer transition flex flex-col items-center justify-center gap-2 group ${
                  isParsing ? 'opacity-60 cursor-not-allowed' : ''
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.tsv,.txt,.dxf,.shp,.zip,*/*"
                  className="hidden"
                  onChange={handleFileInputChange}
                  disabled={isParsing}
                />

                <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 group-hover:scale-110 transition">
                  {isParsing ? <Loader2 className="w-6 h-6 animate-spin" /> : <Upload className="w-6 h-6" />}
                </div>

                <div className="text-sm font-semibold text-white">
                  {isParsing ? '도면 데이터 분석 중...' : '여기를 탭하여 기기의 도면 / 엑셀 / 측량 파일 선택'}
                </div>
                <div className="text-xs text-slate-400 max-w-md">
                  지원 형식: <strong>.xlsx, .xls, .csv, .txt, .dxf, .shp, .zip</strong>
                </div>
              </div>

              {/* Loading progress bar for large DXF */}
              {isParsing && (
                <div className="p-3.5 bg-slate-950 border border-sky-500/50 rounded-xl space-y-2 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-sky-300 font-medium flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {parsingStatusMsg}
                    </span>
                    {parsingProgress > 0 && (
                      <span className="font-mono text-white font-semibold">{parsingProgress}%</span>
                    )}
                  </div>
                  {parsingProgress > 0 && (
                    <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-sky-500 to-emerald-400 h-full transition-all duration-150"
                        style={{ width: `${parsingProgress}%` }}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: DIRECT PASTE */}
          {activeTab === 'paste' && (
            <div className="space-y-3">
              <div className="text-xs text-slate-300">
                카카오톡, 메일, 메모장에서 복사한 좌표 목록이나 DXF 텍스트를 바로 붙여넣으세요:
              </div>
              <textarea
                value={pasteContent}
                onChange={e => setPasteContent(e.target.value)}
                placeholder="예시:&#10;1, 544830.250, 201210.120, 45.20, 경계점_01, 부지경계&#10;2, 544855.100, 201235.400, 45.65, 경계점_02, 아스콘도로&#10;..."
                rows={7}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button
                type="button"
                onClick={handleParsePastedText}
                disabled={!pasteContent.trim() || isParsing}
                className="w-full py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md transition"
              >
                붙여넣은 내용 분석 및 적용
              </button>
            </div>
          )}

          {/* TAB 3: SAMPLE DATA */}
          {activeTab === 'sample' && (
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                <Sparkles className="w-4 h-4" />
                <span>현황측량 테스트용 샘플 데이터 (EPSG:5186)</span>
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                파일이 없어도 즉시 도로 및 부지경계 15개 측점을 캔버스에 올려 스냅과 연속선 기능을 시험해 보실 수 있습니다.
              </p>
              <button
                type="button"
                onClick={handleLoadSampleCSV}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-semibold rounded-xl shadow-md transition"
              >
                샘플 데이터 로드하기
              </button>
            </div>
          )}

          {/* PREVIEW: EXCEL & CSV TABLE CONFIGURATION */}
          {loadedFormat === 'csv' && csvPreview && (
            <div className="space-y-3 bg-slate-950/90 border border-slate-800 p-3.5 sm:p-4 rounded-xl animate-in fade-in shadow-lg">
              
              {/* Top Banner: Sheet Selector & Row Count & Coordinate Swap Toggle */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2 border-b border-slate-800">
                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-950/80 border border-emerald-700 rounded-lg text-emerald-300 text-xs font-semibold">
                    <Check className="w-3.5 h-3.5" />
                    <span>좌표 데이터 감지 (총 {csvPreview.totalRows.toLocaleString()}개 측점)</span>
                  </div>

                  {/* Excel Sheet Selector */}
                  {isExcelFile && excelSheets.length > 0 && (
                    <div className="flex items-center gap-1.5 bg-sky-950/70 border border-sky-700/80 px-2.5 py-1 rounded-lg">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                      <span className="text-[11px] text-sky-300 font-medium">시트(Sheet):</span>
                      <select
                        value={selectedSheet}
                        onChange={e => handleSelectExcelSheet(e.target.value)}
                        className="bg-slate-900 border border-sky-600 text-white text-xs rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-sky-400 font-semibold cursor-pointer"
                      >
                        {excelSheets.map((sh, idx) => (
                          <option key={idx} value={sh}>{sh}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Header Row Index Selector */}
                  <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-700 px-2 py-1 rounded-lg">
                    <TableProperties className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="text-[11px] text-slate-300">헤더(열이름) 행:</span>
                    <select
                      value={headerRowIdx}
                      onChange={e => handleChangeHeaderRow(Number(e.target.value))}
                      className="bg-slate-800 border border-slate-600 text-white text-xs rounded px-1.5 py-0.5 focus:outline-none"
                    >
                      <option value={0}>1행 (기본)</option>
                      <option value={1}>2행</option>
                      <option value={2}>3행</option>
                      <option value={3}>4행</option>
                      <option value={4}>5행</option>
                    </select>
                  </div>
                </div>

                {/* Swap X / Y Toggle button */}
                <button
                  type="button"
                  onClick={() => setCsvMapping(m => ({ ...m, swapXY: !m.swapXY }))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold shadow-sm transition ${
                    csvMapping.swapXY
                      ? 'bg-amber-950/80 border-amber-500 text-amber-300 hover:bg-amber-900/90'
                      : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                  }`}
                  title="측량 기기에서는 보통 X를 북(Northing), Y를 동(Easting)으로 저장하므로 CAD(X=동, Y=북)와 맞추기 위해 반전이 필요합니다."
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                  <span>{csvMapping.swapXY ? 'X ⇄ Y 좌표 반전됨 (CAD 권장)' : '반전 없음 (X=동, Y=북)'}</span>
                </button>
              </div>

              {/* Column Mapping Selectors */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5 text-sky-400" />
                    열(Column) 매핑 설정
                  </span>
                  <span className="text-[11px] text-slate-400">
                    * <strong>X, Y, 항목 레코드</strong>가 기본 적용되며, 고도(Z)는 선택사항입니다.
                  </span>
                </div>

                {/* 1. Primary Default Fields: ID, X, Y, Item Record */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
                  {/* Point ID */}
                  <div className="bg-slate-950/70 p-2.5 rounded-xl border border-purple-900/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-purple-300 font-semibold text-[11px] flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-purple-400 inline-block"></span>
                        측점 ID / 번호
                      </label>
                    </div>
                    <select
                      value={csvMapping.idCol}
                      onChange={e => setCsvMapping({ ...csvMapping, idCol: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-purple-800 text-purple-200 rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-purple-400"
                    >
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i+1})</option>
                      ))}
                    </select>
                  </div>

                  {/* CAD X (Easting) */}
                  <div className="bg-slate-950/70 p-2.5 rounded-xl border border-sky-900/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-sky-300 font-semibold text-[11px] flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-sky-400 inline-block"></span>
                        {csvMapping.swapXY ? '원본 X (→ CAD Y/북)' : 'CAD X (동향 East)'}
                      </label>
                    </div>
                    <select
                      value={csvMapping.xCol}
                      onChange={e => setCsvMapping({ ...csvMapping, xCol: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-sky-700 text-sky-300 font-mono font-medium rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-sky-400"
                    >
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i+1})</option>
                      ))}
                    </select>
                  </div>

                  {/* CAD Y (Northing) */}
                  <div className="bg-slate-950/70 p-2.5 rounded-xl border border-emerald-900/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-emerald-300 font-semibold text-[11px] flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"></span>
                        {csvMapping.swapXY ? '원본 Y (→ CAD X/동)' : 'CAD Y (북향 North)'}
                      </label>
                    </div>
                    <select
                      value={csvMapping.yCol}
                      onChange={e => setCsvMapping({ ...csvMapping, yCol: Number(e.target.value) })}
                      className="w-full bg-slate-900 border border-emerald-700 text-emerald-300 font-mono font-medium rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-emerald-400"
                    >
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i+1})</option>
                      ))}
                    </select>
                  </div>

                  {/* Item / Record / Remarks (User requested default) */}
                  <div className="bg-slate-950/70 p-2.5 rounded-xl border border-orange-900/60">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-orange-300 font-semibold text-[11px] flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-orange-400 inline-block"></span>
                        항목 레코드 / 비고 (기본)
                      </label>
                    </div>
                    <select
                      value={csvMapping.nameCol ?? -1}
                      onChange={e => setCsvMapping({ ...csvMapping, nameCol: Number(e.target.value) >= 0 ? Number(e.target.value) : undefined })}
                      className="w-full bg-slate-900 border border-orange-800 text-orange-200 rounded-lg p-1.5 text-xs focus:ring-1 focus:ring-orange-400"
                    >
                      <option value={-1}>사용 안 함</option>
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i+1})</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* 2. Optional Elevation Z (Default Excluded for 2D Drawings) */}
                <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/50 p-2.5 rounded-xl">
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-200">
                      <input
                        type="checkbox"
                        checked={csvMapping.includeElevation}
                        onChange={e => setCsvMapping(m => ({ ...m, includeElevation: e.target.checked }))}
                        className="w-4 h-4 text-sky-500 rounded bg-slate-800 border-slate-700 focus:ring-sky-500"
                      />
                      <span className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${csvMapping.includeElevation ? 'bg-amber-400' : 'bg-slate-600'}`}></span>
                        <span>3D 고도(Z / 표고) 포함하기</span>
                      </span>
                    </label>

                    {!csvMapping.includeElevation ? (
                      <span className="text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded-md font-medium">
                        ✓ 2D 평면 도면 모드 (고도 제외됨)
                      </span>
                    ) : (
                      <span className="text-[11px] text-amber-300 bg-amber-950/60 border border-amber-800 px-2 py-0.5 rounded-md font-medium">
                        3D 고도 데이터 활성화됨
                      </span>
                    )}
                  </div>

                  {csvMapping.includeElevation ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-amber-300 font-medium text-[11px]">고도(Z) 열 지정:</span>
                      <select
                        value={csvMapping.zCol ?? -1}
                        onChange={e => setCsvMapping({ ...csvMapping, zCol: Number(e.target.value) >= 0 ? Number(e.target.value) : undefined })}
                        className="bg-slate-900 border border-amber-700 text-amber-200 rounded-lg px-2 py-1 text-xs focus:ring-1 focus:ring-amber-400"
                      >
                        <option value={-1}>선택 안 함</option>
                        {csvPreview.headers.map((h, i) => (
                          <option key={i} value={i}>{h} (열 {i+1})</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <span className="text-[11px] text-slate-500">
                      * 평면 도면 작성을 위해 고도는 생략되고 X, Y, 항목 레코드만 배치됩니다.
                    </span>
                  )}
                </div>
              </div>

              {/* Data Table Live Preview with Mapped Badges */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>미리보기 테이블 (상위 {csvPreview.sampleRows.length}개 행)</span>
                  <span className="text-slate-500">열 머리글의 색상 배지로 매핑된 필드를 바로 확인하실 수 있습니다.</span>
                </div>
                
                <div className="overflow-x-auto border border-slate-800 rounded-xl max-h-48 custom-scrollbar bg-slate-950">
                  <table className="w-full text-left text-[11px] font-mono">
                    <thead className="bg-slate-900 text-slate-400 sticky top-0 border-b border-slate-800 z-10">
                      <tr>
                        {csvPreview.headers.map((h, idx) => {
                          const isId = csvMapping.idCol === idx;
                          const isX = csvMapping.xCol === idx;
                          const isY = csvMapping.yCol === idx;
                          const isZ = csvMapping.includeElevation && csvMapping.zCol === idx;
                          const isName = csvMapping.nameCol === idx;

                          return (
                            <th key={idx} className="p-2.5 whitespace-nowrap border-r border-slate-800/60">
                              <div className="flex items-center gap-1.5">
                                <span className="font-semibold text-slate-200">{h}</span>
                                {isId && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-900/90 text-purple-200 border border-purple-700">
                                    ID
                                  </span>
                                )}
                                {isX && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-900/90 text-sky-200 border border-sky-700">
                                    {csvMapping.swapXY ? 'CAD Y' : 'CAD X'}
                                  </span>
                                )}
                                {isY && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-900/90 text-emerald-200 border border-emerald-700">
                                    {csvMapping.swapXY ? 'CAD X' : 'CAD Y'}
                                  </span>
                                )}
                                {isName && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-orange-900/90 text-orange-200 border border-orange-700">
                                    항목
                                  </span>
                                )}
                                {isZ && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-900/90 text-amber-200 border border-amber-700">
                                    Z
                                  </span>
                                )}
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-slate-300">
                      {csvPreview.sampleRows.map((r, ri) => (
                        <tr key={ri} className="hover:bg-slate-800/40 transition">
                          {r.map((col, ci) => {
                            const isId = csvMapping.idCol === ci;
                            const isX = csvMapping.xCol === ci;
                            const isY = csvMapping.yCol === ci;
                            const isZ = csvMapping.includeElevation && csvMapping.zCol === ci;
                            const isName = csvMapping.nameCol === ci;

                            let cellStyle = 'p-2 border-r border-slate-800/40 whitespace-nowrap';
                            if (isId) cellStyle += ' text-purple-300 font-semibold';
                            else if (isX) cellStyle += ' text-sky-300 font-mono';
                            else if (isY) cellStyle += ' text-emerald-300 font-mono';
                            else if (isZ) cellStyle += ' text-amber-300 font-mono';
                            else if (isName) cellStyle += ' text-orange-300 font-medium';

                            return (
                              <td key={ci} className={cellStyle}>{col}</td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* PREVIEW 2: DXF PARSE PREVIEW */}
          {loadedFormat === 'dxf' && dxfStats && (
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <Check className="w-4 h-4" />
                <span>DXF 도면 파싱 성공: {dxfFileName}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">도면층 (레이어)</span>
                  <strong className="text-white text-sm">{dxfStats.layers}개</strong>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">선 (Lines)</span>
                  <strong className="text-white text-sm">{dxfStats.lines.toLocaleString()}개</strong>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">폴리라인 (Polylines)</span>
                  <strong className="text-white text-sm">{dxfStats.polylines.toLocaleString()}개</strong>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">폐합 면적 (Polygons)</span>
                  <strong className="text-white text-sm">{dxfStats.polygons.toLocaleString()}개</strong>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">측점 (Points)</span>
                  <strong className="text-white text-sm">{dxfStats.points.toLocaleString()}개</strong>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">문자 라벨 (Texts)</span>
                  <strong className="text-white text-sm">{dxfStats.texts.toLocaleString()}개</strong>
                </div>
              </div>
            </div>
          )}

          {/* PREVIEW 3: SHP PARSE PREVIEW */}
          {loadedFormat === 'shp' && shpStats && (
            <div className="p-4 bg-slate-950/80 border border-slate-800 rounded-xl space-y-3 animate-in fade-in">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                <Check className="w-4 h-4" />
                <span>Shapefile 분석 성공: {shpFileName}</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">측점 (Points)</span>
                  <strong className="text-white text-sm">{shpStats.points.length.toLocaleString()}개</strong>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">선 (Polylines)</span>
                  <strong className="text-white text-sm">{shpStats.polylines.length.toLocaleString()}개</strong>
                </div>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800">
                  <span className="text-slate-400 block text-[11px]">폐합 면적 (Polygons)</span>
                  <strong className="text-white text-sm">{shpStats.polygons.length.toLocaleString()}개</strong>
                </div>
              </div>
            </div>
          )}

          {csvError && (
            <div className="flex items-center gap-2 p-3 bg-red-950/50 border border-red-800 rounded-xl text-red-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{csvError}</span>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
          >
            취소 / 닫기
          </button>

          {loadedFormat === 'csv' && (
            <button
              onClick={handleApplyCSV}
              disabled={!csvPreview}
              className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md transition flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>측점 캔버스에 배치 ({csvPreview?.totalRows || 0}개)</span>
            </button>
          )}

          {loadedFormat === 'dxf' && (
            <button
              onClick={handleApplyDXF}
              disabled={!parsedDxfData || isParsing}
              className="px-4 py-2.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md transition flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>DXF 도면 캔버스에 추가하기</span>
            </button>
          )}

          {loadedFormat === 'shp' && (
            <button
              onClick={handleApplySHP}
              disabled={!shpStats}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-xl shadow-md transition flex items-center gap-2"
            >
              <Check className="w-4 h-4" />
              <span>SHP 레이어 캔버스에 추가하기</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
