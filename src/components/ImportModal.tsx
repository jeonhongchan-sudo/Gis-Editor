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
  const [activeTab, setActiveTab] = useState<'file' | 'paste'>('file');
  const [appendMode, setAppendMode] = useState<boolean>(true);

  // Encoding State
  const [selectedEncoding, setSelectedEncoding] = useState<SupportedEncoding>('auto');
  const [detectedEncoding, setDetectedEncoding] = useState<'utf-8' | 'euc-kr' | null>(null);

  // Progress State
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parsingProgress, setParsingProgress] = useState<number>(0);
  const [parsingStatusMsg, setParsingStatusMsg] = useState<string>('');

  const rawBufferRef = useRef<{ buffer: ArrayBuffer; filename: string } | null>(null);

  // Table State
  const [csvPreview, setCsvPreview] = useState<CSVParseResult | null>(null);
  const [isExcelFile, setIsExcelFile] = useState<boolean>(false);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState<string>('');
  const excelWorkbookRef = useRef<any>(null);
  const [currentRawRows, setCurrentRawRows] = useState<(string | number)[][] | null>(null);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);
  const [csvMapping, setCsvMapping] = useState<CSVColumnMapping>({
    idCol: 0, xCol: 1, yCol: 2, zCol: 3, nameCol: 4, swapXY: true, includeElevation: false
  });

  // DXF State
  const [dxfFileName, setDxfFileName] = useState<string | null>(null);
  const [parsedDxfData, setParsedDxfData] = useState<any | null>(null);
  const [selectedDxfLayers, setSelectedDxfLayers] = useState<Set<string>>(new Set());

  // SHP State
  const [shpStats, setShpStats] = useState<SHPParseResult | null>(null);
  const [shpFileName, setShpFileName] = useState<string | null>(null);

  const [loadedFormat, setLoadedFormat] = useState<'csv' | 'dxf' | 'shp' | 'project' | null>(null);
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

    if (ext === 'shp') {
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

    const { text, detectedEncoding: det } = decodeBufferText(buffer, enc);
    setDetectedEncoding(det);

    if (text.includes('SECTION') && text.includes('ENTITIES')) {
      setIsParsing(true);
      setParsingProgress(0);
      setParsingStatusMsg('도면 레이어 및 객체 분석 중...');
      setDxfFileName(filename);
      try {
        const result = await parseDXFAsync(text, p => setParsingProgress(p));
        setParsedDxfData(result);
        setSelectedDxfLayers(new Set(result.layers.map((l: any) => l.name)));
        setLoadedFormat('dxf');
      } catch (err: any) {
        alert('DXF 파싱 오류: ' + err.message);
      } finally {
        setIsParsing(false);
      }
    } else {
      try {
        const res = parseCSVPreview(text, 0);
        setCsvPreview(res);
        setCsvMapping(res.detectedMapping);
        setLoadedFormat('csv');
      } catch {
        alert('지원하지 않는 파일 형식이거나 읽을 수 없는 텍스트입니다.');
      }
    }
  };

  const handleApplyDXF = () => {
    if (!parsedDxfData) return;
    
    // Memory-safe filtering: Only include entities from selected layers
    const layerIdMap = new Set(Array.from(selectedDxfLayers).map(name => `layer-${name}`));

    const filtered = {
      layers: parsedDxfData.layers.filter((l: CADLayer) => selectedDxfLayers.has(l.name)),
      points: parsedDxfData.points.filter((p: CADPoint) => layerIdMap.has(p.layerId)),
      lines: parsedDxfData.lines.filter((l: CADLine) => layerIdMap.has(l.layerId)),
      polylines: parsedDxfData.polylines.filter((pl: CADPolyline) => layerIdMap.has(pl.layerId)),
      polygons: parsedDxfData.polygons.filter((pg: CADPolygon) => layerIdMap.has(pg.layerId)),
      texts: parsedDxfData.texts.filter((t: CADText) => layerIdMap.has(t.layerId))
    };
    
    onImportDXF(filtered, appendMode);
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
      <div className="w-full max-w-4xl max-h-[94vh] bg-slate-900 border border-slate-700/90 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-3.5 sm:p-4 border-b border-slate-800 bg-slate-950/80">
          <div>
            <h2 className="text-sm sm:text-base font-semibold text-white flex items-center gap-2">
              <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
              <span>도면 & 좌표 데이터 불러오기</span>
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
              기기 내부의 엑셀, CSV, DXF 파일을 인터넷 연결 없이 안전하게 불러옵니다.
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Encoding & Merge Mode */}
        <div className="px-3.5 py-2.5 bg-slate-950/70 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Languages className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="text-slate-400 text-[11px]">문자 인코딩:</span>
            <select
              value={selectedEncoding}
              onChange={e => {
                setSelectedEncoding(e.target.value as any);
                if (rawBufferRef.current) processBuffer(rawBufferRef.current.buffer, rawBufferRef.current.filename, e.target.value as any);
              }}
              disabled={isExcelFile}
              className="bg-slate-800 border border-slate-700 text-sky-300 text-xs rounded-lg px-2 py-1 focus:outline-none"
            >
              <option value="auto">자동 감지 (CP949 / UTF-8)</option>
              <option value="euc-kr">CP949 / EUC-KR (한국 캐드 표준)</option>
              <option value="utf-8">UTF-8 (유니코드)</option>
            </select>
            {detectedEncoding && (
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-950 border border-emerald-800 text-emerald-400 font-medium uppercase">
                {detectedEncoding} 적용됨
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-200 text-[11px]">
              <input type="radio" checked={appendMode} onChange={() => setAppendMode(true)} className="text-sky-500" />
              <span>기존 작업에 누적 추가</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-400 text-[11px]">
              <input type="radio" checked={!appendMode} onChange={() => setAppendMode(false)} className="text-sky-500" />
              <span>새로 시작 (기존 데이터 삭제)</span>
            </label>
          </div>
        </div>

        {/* Main Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-900/50">
          {!loadedFormat && (
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-sky-500/40 hover:border-sky-400 bg-slate-950/40 hover:bg-slate-800/40 rounded-3xl p-10 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 group"
            >
              <input
                ref={fileInputRef} type="file" className="hidden"
                accept=".xlsx,.xls,.csv,.txt,.dxf,.shp"
                onChange={async e => {
                  const file = e.target.files?.[0];
                  if (file) processBuffer(await file.arrayBuffer(), file.name, selectedEncoding);
                  e.target.value = '';
                }}
              />
              <div className="w-16 h-16 rounded-3xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400 group-hover:scale-105 transition">
                {isParsing ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
              </div>
              <div className="text-lg font-bold text-white">파일 선택</div>
              <p className="text-sm text-slate-400">도면(DXF), 엑셀(XLSX), 측량값(CSV)을 지원합니다.</p>
            </div>
          )}

          {isParsing && (
            <div className="p-4 bg-slate-950 border border-sky-500/30 rounded-2xl space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-sky-300 font-medium">{parsingStatusMsg}</span>
                <span className="font-mono text-white">{parsingProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-sky-500 h-full transition-all" style={{ width: `${parsingProgress}%` }} />
              </div>
            </div>
          )}

          {/* DXF Layer Selector */}
          {loadedFormat === 'dxf' && parsedDxfData && (
            <div className="space-y-4 animate-in fade-in">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Layers className="w-4 h-4 text-sky-400" />
                  레이어 선택 ({selectedDxfLayers.size}/{parsedDxfData.layers.length})
                </h3>
                <div className="flex gap-2">
                  <button onClick={() => setSelectedDxfLayers(new Set(parsedDxfData.layers.map((l: any) => l.name)))} className="text-[10px] text-sky-400">전체 선택</button>
                  <button onClick={() => setSelectedDxfLayers(new Set())} className="text-[10px] text-slate-400">해제</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-60 overflow-y-auto p-2 bg-slate-950 rounded-xl custom-scrollbar border border-slate-800">
                {parsedDxfData.layers.map((l: CADLayer) => (
                  <label key={l.name} className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer transition ${selectedDxfLayers.has(l.name) ? 'bg-sky-500/20 border-sky-500/50' : 'bg-slate-900 border-transparent hover:border-slate-700'} border`}>
                    <input
                      type="checkbox" checked={selectedDxfLayers.has(l.name)}
                      onChange={() => {
                        const next = new Set(selectedDxfLayers);
                        if (next.has(l.name)) next.delete(l.name); else next.add(l.name);
                        setSelectedDxfLayers(next);
                      }}
                      className="hidden"
                    />
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: l.color || '#38bdf8' }} />
                    <span className="text-[11px] text-slate-200 truncate">{l.name}</span>
                  </label>
                ))}
              </div>
              <button onClick={handleApplyDXF} className="w-full py-3 bg-sky-600 hover:bg-sky-500 text-white font-bold rounded-xl shadow-lg transition active:scale-95">
                선택한 레이어 도면에 배치하기
              </button>
            </div>
          )}

          {/* CSV Mapping */}
          {loadedFormat === 'csv' && csvPreview && (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-slate-950 border border-slate-800 p-4 rounded-2xl space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 px-3 py-1 bg-emerald-950/50 border border-emerald-700/50 rounded-lg text-emerald-400 text-[11px] font-bold">
                    <Check className="w-3 h-3" /> 측점 {csvPreview.totalRows.toLocaleString()}개 감지됨
                  </div>
                  <button
                    onClick={() => setCsvMapping(m => ({ ...m, swapXY: !m.swapXY }))}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-bold transition ${csvMapping.swapXY ? 'bg-amber-950/50 border-amber-700 text-amber-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}
                  >
                    <ArrowLeftRight className="w-3 h-3" /> {csvMapping.swapXY ? 'X ⇄ Y 반전됨 (CAD 권장)' : '반전 없음'}
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {['측점 ID', 'CAD X (동향)', 'CAD Y (북향)', '항목/비고'].map((label, idx) => {
                    const fields = ['idCol', 'xCol', 'yCol', 'nameCol'] as const;
                    const field = fields[idx];
                    return (
                      <div key={field} className="space-y-1.5">
                        <label className="text-[10px] text-slate-500 font-bold ml-1">{label}</label>
                        <select
                          value={csvMapping[field] ?? -1}
                          onChange={e => setCsvMapping({ ...csvMapping, [field]: parseInt(e.target.value) })}
                          className="w-full bg-slate-900 border border-slate-700 text-white text-[11px] rounded-lg p-1.5"
                        >
                          {field === 'nameCol' && <option value={-1}>사용 안함</option>}
                          {csvPreview.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              </div>
              <button onClick={handleApplyCSV} className="w-full py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-lg transition active:scale-95">
                데이터 도면에 배치하기
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-800 flex justify-between bg-slate-950/50">
          <button onClick={() => setLoadedFormat(null)} className="px-4 py-2 text-xs text-slate-400 hover:text-white transition">뒤로가기</button>
          <button onClick={onClose} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition">닫기</button>
        </div>
      </div>
    </div>
  );
};
