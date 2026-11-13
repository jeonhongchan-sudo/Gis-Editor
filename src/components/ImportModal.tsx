/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { 
  X, 
  Upload, 
  Download,
  FileSpreadsheet, 
  Sparkles, 
  AlertCircle, 
  ArrowLeftRight,
  Check,
  Loader2,
  Layers,
  Archive,
  MapPin,
  Maximize2,
  Database,
  Globe2,
  Info
} from 'lucide-react';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, ProjectState, CADText } from '../types/cad';
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
import { parseGeoJson } from '../utils/geoJsonParser';
import { parseDxfBuffer } from '../utils/dxfParser';
import { COORDINATE_SYSTEMS } from '../utils/projections';

interface ImportModalProps {
  onImportCSVPoints: (points: CADPoint[], append: boolean) => void;
  onImportSHP: (data: SHPParseResult, append: boolean) => void;
  onLoadProject: (state: ProjectState) => Promise<void>;
  onClose: () => void;
}

interface StoredRawInput {
  kind: 'zip' | 'shp-multi' | 'csv' | 'excel' | 'geojson' | 'dxf';
  filename: string;
  buffer?: ArrayBuffer;
  json?: any;
  shpFiles?: { name: string; shpBuffer: ArrayBuffer; dbfBuffer?: ArrayBuffer }[];
}

const LAYER_COLORS = ['#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', '#60a5fa', '#f97316'];

export const ImportModal: React.FC<ImportModalProps> = ({
  onImportCSVPoints,
  onImportSHP,
  onLoadProject,
  onClose
}) => {
  const [appendMode, setAppendMode] = useState<boolean>(true);

  // Encoding State
  const [selectedEncoding, setSelectedEncoding] = useState<SupportedEncoding>('auto');

  // Progress State
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [parsingProgress, setParsingProgress] = useState<number>(0);
  const [parsingStatusMsg, setParsingStatusMsg] = useState<string>('');

  const rawInputRef = useRef<StoredRawInput | null>(null);

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

  // SHP / GeoJSON Result State
  const [shpResult, setShpResult] = useState<SHPParseResult | null>(null);
  const [shpFileName, setShpFileName] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());

  const [loadedFormat, setLoadedFormat] = useState<'csv' | 'shp' | 'project' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Pre-calculate layer counts to prevent O(N*M) lag in render loop
  const layerStats = React.useMemo(() => {
    if (!shpResult) return new Map<string, { pt: number, line: number, poly: number }>();
    const stats = new Map<string, { pt: number, line: number, poly: number }>();
    
    shpResult.layers.forEach(l => stats.set(l.id, { pt: 0, line: 0, poly: 0 }));
    shpResult.points.forEach(p => { const s = stats.get(p.layerId); if (s) s.pt++; });
    shpResult.lines.forEach(l => { const s = stats.get(l.layerId); if (s) s.line++; });
    shpResult.polylines.forEach(pl => { const s = stats.get(pl.layerId); if (s) s.line++; });
    shpResult.polygons.forEach(pg => { const s = stats.get(pg.layerId); if (s) s.poly++; });
    
    return stats;
  }, [shpResult]);

  const applyRowsToPreview = (rows: (string | number)[][], headerIdx: number = 0) => {
    try {
      setCurrentRawRows(rows);
      setHeaderRowIdx(headerIdx);
      const res = analyzeTableRows(rows, headerIdx);
      setCsvPreview(res);
      setCsvMapping(res.detectedMapping);
      setLoadedFormat('csv');
    } catch (err: any) {
      console.warn('Failed to parse table rows:', err);
    }
  };

  /**
   * Re-parse data when the user overrides encoding or CRS
   */
  const handleReParse = async (newEnc?: SupportedEncoding) => {
    const enc = newEnc || selectedEncoding;
    
    if (newEnc) setSelectedEncoding(newEnc);

    const raw = rawInputRef.current;
    if (!raw) return;

    const forced = enc === 'auto' ? undefined : (enc as 'utf-8' | 'euc-kr');

    if (raw.kind === 'zip' && raw.buffer) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('Shapefile 압축 파일 재분석 중...');
        setParsingProgress(50);
        const res = await parseShapefileZip(raw.buffer, forced);
        setParsingProgress(100);
        setShpResult(res);
        setSelectedLayerIds(new Set(res.layers.map(l => l.id))); // Default all checked for SHP
      } catch (err: any) {
        console.error('Re-parse zip failed:', err);
      } finally {
        setIsParsing(false);
      }
    } else if (raw.kind === 'geojson' && raw.json) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('GeoJSON 데이터 분석 중...');
        const res = parseGeoJson(raw.json, 'LOCAL', 'LOCAL');
        setShpResult(res);
        setSelectedLayerIds(new Set(res.layers.map(l => l.id))); // Default all checked for GeoJSON
      } catch (err: any) {
        console.error('Re-parse geojson failed:', err);
      } finally {
        setIsParsing(false);
      }
    } else if (raw.kind === 'csv' && raw.buffer) {
      const { text } = decodeBufferText(raw.buffer, enc);
      try {
        const res = parseCSVPreview(text, headerRowIdx);
        setCsvPreview(res);
        setCsvMapping(res.detectedMapping);
      } catch {}
    } else if (raw.kind === 'dxf' && raw.buffer) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('DXF 도면 데이터 재분석 중...');
        const res = parseDxfBuffer(raw.buffer, raw.filename, forced);
        setShpResult(res);
        setSelectedLayerIds(new Set(res.layers.map(l => l.id)));
      } catch (err: any) {
        console.error('Re-parse dxf failed:', err);
      } finally {
        setIsParsing(false);
      }
    }
  };

  /**
   * Process multiple or single selected files
   */
  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const fileArray = Array.from(files);

    // Case 1: .cadgis, .json, or .geojson backup project or GIS file
    const potentialJsonFiles = fileArray.filter(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'json' || ext === 'geojson';
    });

    if (potentialJsonFiles.length > 0) {
      for (const jsonFile of potentialJsonFiles) {
        try {
          const buf = await jsonFile.arrayBuffer();
          const text = new TextDecoder('utf-8').decode(buf).trim();
          if (!text) continue;
          const parsed = JSON.parse(text);

          // Check if it's a ProjectState (our internal format)
          if (parsed.version || parsed.layers || parsed.points || (parsed.texts && Array.isArray(parsed.texts))) {
            const convertedPolyLines: CADPolyline[] = (parsed.polygons || []).map((pg: CADPolygon, i: number) => {
              const pts = [...(pg.points || [])];
              if (pts.length >= 2) {
                const first = pts[0];
                const last = pts[pts.length - 1];
                if (first.x !== last.x || first.y !== last.y) {
                  pts.push({ ...first });
                }
              }
              return {
                id: pg.id || `imp-pgline-${Date.now()}-${i}`,
                name: pg.name || `외곽선_${i + 1}`,
                points: pts,
                isClosed: true,
                layerId: pg.layerId,
                color: pg.color,
                attributes: pg.attributes
              };
            });
            const unified: SHPParseResult = {
              points: parsed.points || [],
              lines: parsed.lines || [],
              polylines: [...(parsed.polylines || []), ...convertedPolyLines],
              polygons: [],
              texts: parsed.texts || [],
              layers: parsed.layers || [],
              layerName: parsed.name || jsonFile.name
            };
            setShpResult(unified);
            setSelectedLayerIds(new Set(unified.layers.map(l => l.id)));
            setShpFileName(jsonFile.name);
            setLoadedFormat('shp');
            return;
          }

          // Check if it's GeoJSON
          if (parsed.type === 'FeatureCollection' || parsed.type === 'Feature') {
            setIsParsing(true);
            setParsingStatusMsg('GeoJSON 데이터 분석 중...');
            
            rawInputRef.current = { kind: 'geojson', filename: jsonFile.name, json: parsed };
            
            const res = parseGeoJson(parsed, 'LOCAL', 'LOCAL');
            setShpResult(res);
            // SHP/GeoJSON are usually pre-filtered, so default to "Select All"
            setSelectedLayerIds(new Set(res.layers.map(l => l.id)));
            setShpFileName(jsonFile.name);
            setLoadedFormat('shp');
            setIsParsing(false);
            return;
          }
        } catch (err) {
          console.warn('JSON parsing failed or not a recognized format:', err);
        }
      }
    }

    // Case 2: Zip archive containing Shapefile
    const zipFile = fileArray.find(f => f.name.toLowerCase().endsWith('.zip'));
    if (zipFile) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('Shapefile ZIP 압축 파일 분석 중...');
        setParsingProgress(40);
        const buffer = await zipFile.arrayBuffer();
        rawInputRef.current = { kind: 'zip', filename: zipFile.name, buffer };

        const forced = selectedEncoding === 'auto' ? undefined : (selectedEncoding as 'utf-8' | 'euc-kr');
        const res = await parseShapefileZip(buffer, forced);
        setParsingProgress(100);
        setShpResult(res);
        // SHP is usually pre-filtered, so default to "Select All"
        setSelectedLayerIds(new Set(res.layers.map(l => l.id)));
        setShpFileName(zipFile.name);
        setLoadedFormat('shp');
        return;
      } catch (err: any) {
        alert('ZIP 파일 내 Shapefile 분석 오류: ' + (err.message || err));
        return;
      } finally {
        setIsParsing(false);
      }
    }

    // Case 3: Loose .shp file(s) (with optional companion .dbf)
    const shpFiles = fileArray.filter(f => f.name.toLowerCase().endsWith('.shp'));
    if (shpFiles.length > 0) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('ESRI .shp 및 속성 .dbf 분석 중...');
        setParsingProgress(30);

        const shpItems: { name: string; shpBuffer: ArrayBuffer; dbfBuffer?: ArrayBuffer }[] = [];

        for (const shpFile of shpFiles) {
          const shpBuf = await shpFile.arrayBuffer();
          const baseName = shpFile.name.replace(/\.shp$/i, '').toLowerCase();

          // Find companion .dbf
          const companionDbf = fileArray.find(f => {
            const fBase = f.name.replace(/\.dbf$/i, '').toLowerCase();
            return fBase === baseName && f.name.toLowerCase().endsWith('.dbf');
          }) || (fileArray.filter(f => f.name.toLowerCase().endsWith('.dbf')).length === 1 
            ? fileArray.find(f => f.name.toLowerCase().endsWith('.dbf')) 
            : undefined);

          let dbfBuf: ArrayBuffer | undefined = undefined;
          if (companionDbf) {
            dbfBuf = await companionDbf.arrayBuffer();
          }

          shpItems.push({
            name: shpFile.name,
            shpBuffer: shpBuf,
            dbfBuffer: dbfBuf
          });
        }

        rawInputRef.current = {
          kind: 'shp-multi',
          filename: shpFiles[0].name,
          shpFiles: shpItems
        };

        const forced = selectedEncoding === 'auto' ? undefined : (selectedEncoding as 'utf-8' | 'euc-kr');
        const combinedPoints: CADPoint[] = [];
        const combinedLines: CADLine[] = [];
        const combinedPolylines: CADPolyline[] = [];
        const combinedPolygons: CADPolygon[] = [];
        const combinedTexts: CADText[] = [];
        const combinedLayers: CADLayer[] = [];
        const combinedDbfFields = new Set<string>();
        let detectedEnc: 'utf-8' | 'euc-kr' = forced || 'euc-kr';
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

        for (let i = 0; i < shpItems.length; i++) {
          const item = shpItems[i];
          const res = parseShpBuffer(item.shpBuffer, item.name, item.dbfBuffer, i, forced);
          if (res.detectedEncoding) detectedEnc = res.detectedEncoding;
          if (res.dbfFields) res.dbfFields.forEach(f => combinedDbfFields.add(f));

          res.layers.forEach(nl => {
            if (!combinedLayers.some(l => l.id === nl.id)) {
              nl.color = LAYER_COLORS[combinedLayers.length % LAYER_COLORS.length];
              combinedLayers.push(nl);
            }
          });

          combinedPoints.push(...res.points);
          combinedLines.push(...res.lines);
          combinedPolylines.push(...res.polylines);
          combinedPolygons.push(...res.polygons);
          if (res.texts) combinedTexts.push(...res.texts);

          if (res.bounds) {
            minX = Math.min(minX, res.bounds.minX);
            minY = Math.min(minY, res.bounds.minY);
            maxX = Math.max(maxX, res.bounds.maxX);
            maxY = Math.max(maxY, res.bounds.maxY);
          }
        }

        setParsingProgress(100);
        const res: SHPParseResult = {
          points: combinedPoints,
          lines: combinedLines,
          polylines: combinedPolylines,
          polygons: combinedPolygons,
          texts: combinedTexts,
          layers: combinedLayers,
          layerName: shpFiles[0].name.replace(/\.[^/.]+$/, ''),
          detectedEncoding: detectedEnc,
          dbfFields: Array.from(combinedDbfFields),
          bounds: minX !== Infinity ? { minX, minY, maxX, maxY } : undefined
        };
        setShpResult(res);
        // Multi-SHP is also usually pre-filtered, default to "Select All"
        setSelectedLayerIds(new Set(res.layers.map(l => l.id)));
        setShpFileName(shpFiles.length === 1 ? shpFiles[0].name : `${shpFiles.length}개 Shapefile`);
        setLoadedFormat('shp');
        return;
      } catch (err: any) {
        alert('SHP 파일 분석 실패: ' + (err.message || err));
        return;
      } finally {
        setIsParsing(false);
      }
    }

    // Case 3.5: DXF file
    const dxfFile = fileArray.find(f => f.name.toLowerCase().endsWith('.dxf'));
    if (dxfFile) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('AutoCAD DXF 도면 분석 중...');
        const buffer = await dxfFile.arrayBuffer();
        rawInputRef.current = { kind: 'dxf', filename: dxfFile.name, buffer };

        const forced = selectedEncoding === 'auto' ? undefined : (selectedEncoding as 'utf-8' | 'euc-kr');
        const res = parseDxfBuffer(buffer, dxfFile.name, forced);
        
        setShpResult(res);
        setSelectedLayerIds(new Set(res.layers.map(l => l.id)));
        setShpFileName(dxfFile.name);
        setLoadedFormat('shp');
        return;
      } catch (err: any) {
        alert('DXF 파일 분석 실패: ' + (err.message || err));
        return;
      } finally {
        setIsParsing(false);
      }
    }

    // Case 4: Excel (.xlsx, .xls)
    const excelFile = fileArray.find(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'xlsx' || ext === 'xls';
    });
    if (excelFile) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('엑셀 워크북 분석 및 시트 추출 중...');
        const buffer = await excelFile.arrayBuffer();
        rawInputRef.current = { kind: 'excel', filename: excelFile.name, buffer };
        const parsed = parseExcelWorkbook(buffer);
        excelWorkbookRef.current = parsed;
        setIsExcelFile(true);
        setExcelSheets(parsed.sheetNames);
        const initialSheet = parsed.sheetNames[0];
        setSelectedSheet(initialSheet);
        const rows = parsed.getSheetRows(initialSheet);
        applyRowsToPreview(rows, 0);
        return;
      } catch (err: any) {
        console.warn('Excel parse failed:', err);
      } finally {
        setIsParsing(false);
      }
    }

    // Case 5: CSV / Text (.csv, .txt)
    const csvFile = fileArray.find(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'csv' || ext === 'txt';
    });
    if (csvFile) {
      try {
        const buffer = await csvFile.arrayBuffer();
        rawInputRef.current = { kind: 'csv', filename: csvFile.name, buffer };
        const { text, detectedEncoding } = decodeBufferText(buffer, selectedEncoding);
        const res = parseCSVPreview(text, 0);
        setCsvPreview(res);
        setCsvMapping(res.detectedMapping);
        setLoadedFormat('csv');
      } catch (err: any) {
        alert('지원하지 않는 파일 형식이거나 읽을 수 없는 텍스트입니다. CSV, GeoJSON, SHP 파일을 선택해 주세요.');
      }
      return;
    }

    // If we reached here and nothing was loaded, show a hint
    if (!loadedFormat) {
      alert('선택하신 파일 형식이 지원되지 않거나 분석에 실패했습니다. (지원: .dxf, .shp, .zip, .csv, .xlsx, .json, .geojson)');
    }
  };

  const handleApplySHP = () => {
    if (!shpResult) return;
    
    if (selectedLayerIds.size === 0) {
      alert('변환할 레이어를 최소 하나 이상 선택해 주세요.');
      return;
    }

    // Filter results based on selected layers
    const filteredResult: SHPParseResult = {
      ...shpResult,
      layers: shpResult.layers.filter(l => selectedLayerIds.has(l.id)),
      points: shpResult.points.filter(p => selectedLayerIds.has(p.layerId)),
      lines: shpResult.lines.filter(l => selectedLayerIds.has(l.layerId)),
      polylines: shpResult.polylines.filter(pl => selectedLayerIds.has(pl.layerId)),
      polygons: shpResult.polygons.filter(pg => selectedLayerIds.has(pg.layerId)),
      texts: shpResult.texts?.filter(t => selectedLayerIds.has(t.layerId))
    };

    onImportSHP(filteredResult, appendMode);
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
              <span>외부 데이터 및 통합 백업 불러오기</span>
            </h2>
            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              도면(SHP, DXF), 측점(CSV, Excel), 통합 백업(.geojson) 파일을 안전하게 불러옵니다.
            </p>
          </div>
          <button 
            onClick={onClose} 
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Merge Mode */}
        <div className="px-3.5 py-2.5 bg-slate-50/70 dark:bg-slate-950/70 border-b border-slate-100 dark:border-slate-800 flex items-center justify-end gap-2 text-xs">
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
                ref={fileInputRef} 
                type="file" 
                className="hidden"
                multiple
                accept=".xlsx,.xls,.csv,.txt,.shp,.dbf,.shx,.cpg,.zip,.geojson,.json,.dxf"
                onChange={async e => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    await handleFilesSelected(files);
                  }
                  e.target.value = '';
                }}
              />
              <div className="w-16 h-16 rounded-3xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-600 dark:text-sky-400 group-hover:scale-105 transition">
                {isParsing ? <Loader2 className="w-8 h-8 animate-spin" /> : <Upload className="w-8 h-8" />}
              </div>
              <div className="text-lg font-bold text-slate-900 dark:text-white">파일 선택하여 불러오기</div>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-lg">
                <strong>SHP (ZIP)</strong>, <strong>GeoJSON</strong>, <strong>CSV</strong>, <strong>Excel</strong> 및 프로젝트 백업을 지원합니다.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-[11px] text-emerald-600 dark:text-emerald-400 border border-slate-200 dark:border-slate-700 shadow-sm">
                  ✓ SHP / GeoJSON 좌표계 변환 지원
                </span>

                <span className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-[11px] text-purple-600 dark:text-purple-400 border border-slate-200 dark:border-slate-700 shadow-sm">
                  ✓ 통합 백업용 GeoJSON 지원
                </span>
              </div>
            </div>
          )}

          {isParsing && (
            <div className="p-4 bg-white dark:bg-slate-950 border border-sky-200 dark:border-sky-500/30 rounded-2xl space-y-3 shadow-sm">
              <div className="flex items-center justify-between text-xs">
                <span className="text-sky-600 dark:text-sky-300 font-medium flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {parsingStatusMsg}
                </span>
                <span className="font-mono text-slate-900 dark:text-white">{parsingProgress}%</span>
              </div>
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden">
                <div className="bg-sky-500 h-full transition-all" style={{ width: `${parsingProgress}%` }} />
              </div>
            </div>
          )}

          {/* SHP / GeoJSON Preview & Confirmation */}
          {loadedFormat === 'shp' && shpResult && (
            <div className="space-y-4 animate-in fade-in">
              <div className="p-4 bg-white dark:bg-slate-950 border border-emerald-100 dark:border-emerald-700/60 rounded-2xl space-y-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 gap-2">
                  <div className="flex items-center gap-2">
                    <Archive className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                        {rawInputRef.current?.kind === 'geojson' ? 'GeoJSON' : 'Shapefile'} 데이터 감지됨
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        {shpFileName || 'GIS 도면 데이터'}
                      </p>
                    </div>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[11px] bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span>분석 완료</span>
                  </span>
                </div>

                {/* Encoding & CRS Control Bar */}
                <div className="p-3 bg-slate-50 dark:bg-slate-900/80 border border-slate-100 dark:border-slate-800 rounded-xl space-y-3">
                  {/* Encoding (Only for SHP) */}
                  {rawInputRef.current?.kind !== 'geojson' && (
                    <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-slate-700 dark:text-slate-300">텍스트 인코딩:</span>
                        <span className="px-2 py-0.5 rounded text-[11px] bg-sky-50 dark:bg-sky-950 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 font-bold">
                          {shpResult.detectedEncoding === 'euc-kr' 
                            ? 'CP949 / EUC-KR (한글 감지)' 
                            : 'UTF-8 (유니코드)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleReParse('auto')}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition ${selectedEncoding === 'auto' ? 'bg-sky-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                        >
                          자동
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReParse('euc-kr')}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition ${selectedEncoding === 'euc-kr' ? 'bg-sky-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                        >
                          CP949
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReParse('utf-8')}
                          className={`px-2 py-1 rounded-lg text-[11px] font-semibold transition ${selectedEncoding === 'utf-8' ? 'bg-sky-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                        >
                          UTF-8
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex items-start gap-2 p-2 bg-sky-50 dark:bg-sky-950/40 rounded-lg border border-sky-100 dark:border-sky-900/50">
                    <Info className="w-3.5 h-3.5 text-sky-600 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-sky-700 dark:text-sky-300 leading-normal">
                      데이터를 불러올 때 좌표 변환을 수행하지 않습니다. 원본 파일의 좌표값이 그대로 도면에 유지됩니다.
                    </p>
                  </div>
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
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">텍스트 (Text)</div>
                    <div className="text-lg font-bold text-fuchsia-600 dark:text-fuchsia-400 mt-0.5">{(shpResult.texts || []).length}개</div>
                  </div>
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-center shadow-sm">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400">전체 레이어</div>
                    <div className="text-lg font-bold text-purple-600 dark:text-purple-400 mt-0.5">{shpResult.layers.length}개</div>
                  </div>
                </div>

                {/* Layer Selection Checklist */}
                <div className="p-3 bg-white dark:bg-slate-950 border border-purple-100 dark:border-purple-800/40 rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-4 h-4 text-purple-500" />
                      <span className="text-xs font-bold text-slate-700 dark:text-slate-200">변환할 레이어 선택 (지형도 등 제외 권장)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => setSelectedLayerIds(new Set(shpResult.layers.map(l => l.id)))}
                        className="text-[10px] text-sky-600 hover:underline"
                      >
                        전체 선택
                      </button>
                      <span className="text-slate-300">|</span>
                      <button 
                        onClick={() => setSelectedLayerIds(new Set())}
                        className="text-[10px] text-slate-500 hover:underline"
                      >
                        모두 해제
                      </button>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                    {shpResult.layers.map(layer => {
                      const isChecked = selectedLayerIds.has(layer.id);
                      const stats = layerStats.get(layer.id) || { pt: 0, line: 0, poly: 0 };
                      const totalEnts = stats.pt + stats.line + stats.poly;
                      
                      if (totalEnts === 0) return null; // Skip empty layers if any

                      return (
                        <label 
                          key={layer.id} 
                          className={`flex items-center gap-2.5 p-2 rounded-lg border transition cursor-pointer ${
                            isChecked 
                              ? 'bg-purple-50 dark:bg-purple-900/30 border-purple-200 dark:border-purple-700/50' 
                              : 'bg-slate-50 dark:bg-slate-900 border-slate-100 dark:border-slate-800'
                          }`}
                        >
                          <input 
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              const next = new Set(selectedLayerIds);
                              if (next.has(layer.id)) next.delete(layer.id);
                              else next.add(layer.id);
                              setSelectedLayerIds(next);
                            }}
                            className="w-3.5 h-3.5 rounded border-slate-300 text-purple-600 focus:ring-purple-500"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: layer.color }} />
                              <span className="text-[11px] font-medium text-slate-700 dark:text-slate-200 truncate">{layer.name}</span>
                            </div>
                            <div className="text-[9px] text-slate-400 dark:text-slate-500 flex gap-1.5 mt-0.5 ml-3.5">
                              {stats.pt > 0 && <span>점 {stats.pt}</span>}
                              {stats.line > 0 && <span>선 {stats.line}</span>}
                              {stats.poly > 0 && <span>면 {stats.poly}</span>}
                            </div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  
                  {selectedLayerIds.size === 0 && (
                    <div className="flex items-center gap-1.5 p-2 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-100 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 text-[10px]">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>변환할 레이어를 하나 이상 선택해야 도면에 추가할 수 있습니다.</span>
                    </div>
                  )}
                </div>

                {/* Sample Point Text Preview */}
                {shpResult.points.length > 0 && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                        데이터 미리보기 (측점 ID/명칭 {Math.min(10, shpResult.points.length)}개)
                      </div>
                      <span className="text-[10px] text-slate-400">데이터가 정상인지 확인 후 하단 버튼을 눌러주세요.</span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-[11px]">
                      <table className="w-full text-left font-mono">
                        <thead className="bg-slate-100 dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 text-[10px]">
                          <tr>
                            <th className="py-1.5 px-3">측점명 / ID (TextString)</th>
                            <th className="py-1.5 px-3">CAD X (Easting)</th>
                            <th className="py-1.5 px-3">CAD Y (Northing)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                          {shpResult.points
                            // Prioritize showing points that look like actual station IDs (longer or containing dashes)
                            .slice()
                            .sort((a, b) => {
                              const aIsGeneric = a.name.startsWith('PT_') || a.name.startsWith('TEXT_') || a.name.startsWith('BLOCK_');
                              const bIsGeneric = b.name.startsWith('PT_') || b.name.startsWith('TEXT_') || b.name.startsWith('BLOCK_');
                              if (aIsGeneric && !bIsGeneric) return 1;
                              if (!aIsGeneric && bIsGeneric) return -1;
                              return b.name.length - a.name.length;
                            })
                            .slice(0, 10).map((pt) => (
                              <tr key={pt.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/50 transition">
                                <td className="py-1.5 px-3 font-bold text-amber-600 truncate max-w-[180px]">{pt.name}</td>
                                <td className="py-1.5 px-3 text-sky-600">{pt.x.toFixed(3)}</td>
                                <td className="py-1.5 px-3 text-sky-600">{pt.y.toFixed(3)}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

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
                <span>도면에 데이터 배치하기 (화면 자동맞춤)</span>
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
                  </div>
                )}

                {/* Data Preview Table */}
                {csvPreview.sampleRows.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold flex items-center justify-between">
                      <span>데이터 미리보기 (상위 {Math.min(3, csvPreview.sampleRows.length)}행)</span>
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
          <button 
            onClick={() => { setLoadedFormat(null); setShpResult(null); rawInputRef.current = null; }} 
            className="px-4 py-2 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition"
          >
            다른 파일 선택
          </button>
          <button 
            onClick={onClose} 
            className="px-6 py-2 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-white text-xs font-bold rounded-xl transition"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
};
