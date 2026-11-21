/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo } from 'react';
import { 
  X, 
  Upload, 
  AlertCircle, 
  Check,
  Loader2,
  Layers,
  Archive,
  Maximize2,
  Info,
  Filter,
  Search,
  Plus
} from 'lucide-react';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D } from '../types/cad';
import { 
  CSVColumnMapping, 
  CSVParseResult, 
  buildCADPointsFromCSV, 
  parseCSVPreview,
  parseCSVToRows,
  analyzeTableRows 
} from '../utils/csvParser';
import { parseExcelWorkbook } from '../utils/excelParser';
import { parseShapefileZip, parseShpBuffer, SHPParseResult } from '../utils/shpParser';
import { decodeBufferText, SupportedEncoding } from '../utils/encoding';
import { parseGeoJson } from '../utils/geoJsonParser';
import { parseDxfBuffer } from '../utils/dxfParser';

interface ImportModalProps {
  existingLayers?: CADLayer[];
  existingPoints?: CADPoint[];
  activeLayerId?: string;
  applyZ?: boolean;
  onImportCSVPoints: (
    points: CADPoint[],
    append: boolean,
    targetLayer?: CADLayer,
    options?: { zOnlyMergeByXY?: boolean }
  ) => void;
  onImportSHP: (data: SHPParseResult, append: boolean) => void;
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

const DEFAULT_ZERO_LAYER: CADLayer = {
  id: 'layer-0',
  name: '0',
  color: '#38bdf8',
  visible: true,
  locked: false,
  lineWidth: 1.5
};

const fmtCoord3 = (val: number): string => {
  const rounded = Number(val.toFixed(3));
  return (Object.is(rounded, -0) || rounded === 0 ? 0 : rounded).toFixed(3);
};

const makeXYKey3 = (x: number, y: number): string => `${fmtCoord3(x)}|${fmtCoord3(y)}`;

export const ImportModal: React.FC<ImportModalProps> = ({
  existingLayers = [],
  existingPoints = [],
  activeLayerId,
  applyZ = false,
  onImportCSVPoints,
  onImportSHP,
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
  const rawTableRowsRef = useRef<(string | number)[][] | null>(null);
  const detectedCsvZColRef = useRef<number>(-1);
  const excelWorkbookRef = useRef<{
    sheetNames: string[];
    getSheetRows: (sheetName: string) => (string | number)[][];
  } | null>(null);

  // CSV/Excel State
  const [csvPreview, setCsvPreview] = useState<CSVParseResult | null>(null);
  const [csvFileName, setCsvFileName] = useState<string | null>(null);
  const [headerRowIdx, setHeaderRowIdx] = useState<number>(0);
  const [excelSheets, setExcelSheets] = useState<string[]>([]);
  const [selectedExcelSheet, setSelectedExcelSheet] = useState<string>('');
  const [csvMapping, setCsvMapping] = useState<CSVColumnMapping>({
    xCol: 0, yCol: 1, nameCol: 2, zCol: -1, includeElevation: false
  });
  const [zOnlyMergeByXY, setZOnlyMergeByXY] = useState<boolean>(false);

  // CSV/Excel Item Filter State (null = include all items)
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string> | null>(null);
  const [itemFilterSearch, setItemFilterSearch] = useState<string>('');

  // Target Layer Selection for CSV/Excel Import
  const availableLayers = existingLayers.length > 0 ? existingLayers : [DEFAULT_ZERO_LAYER];
  const [targetCsvLayerId, setTargetCsvLayerId] = useState<string>(() => {
    if (activeLayerId && availableLayers.some(l => l.id === activeLayerId)) return activeLayerId;
    return availableLayers[0]?.id || 'layer-0';
  });
  const [createNewLayerMode, setCreateNewLayerMode] = useState<boolean>(false);
  const [newLayerName, setNewLayerName] = useState<string>('');
  const [newLayerColor, setNewLayerColor] = useState<string>(
    () => LAYER_COLORS[availableLayers.length % LAYER_COLORS.length]
  );

  // SHP / GeoJSON / DXF Result State
  const [shpResult, setShpResult] = useState<SHPParseResult | null>(null);
  const [shpFileName, setShpFileName] = useState<string | null>(null);
  const [selectedLayerIds, setSelectedLayerIds] = useState<Set<string>>(new Set());

  const [loadedFormat, setLoadedFormat] = useState<'csv' | 'shp' | 'project' | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Valid numeric rows from CSV/Excel
  const validCsvRows = useMemo(() => {
    if (!csvPreview) return [];
    return csvPreview.allRows.filter(row => {
      const rawX = row[csvMapping.xCol];
      const rawY = row[csvMapping.yCol];
      if (rawX === undefined || rawX === '' || rawY === undefined || rawY === '') return false;
      const x = Number(rawX);
      const y = Number(rawY);
      return Number.isFinite(x) && Number.isFinite(y);
    });
  }, [csvPreview, csvMapping.xCol, csvMapping.yCol]);

  // Unique item values & counts for filtering
  const uniqueItemEntries = useMemo(() => {
    if (!csvPreview || csvMapping.nameCol === undefined || csvMapping.nameCol < 0) return [];
    const col = csvMapping.nameCol;
    const counts = new Map<string, number>();
    for (const row of validCsvRows) {
      const key = (row[col] ?? '').trim();
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([key, count]) => ({
        key,
        label: key === '' ? '(빈 값)' : key,
        count
      }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ko'));
  }, [csvPreview, validCsvRows, csvMapping.nameCol]);

  const searchedItemEntries = useMemo(() => {
    const q = itemFilterSearch.trim().toLowerCase();
    if (!q) return uniqueItemEntries;
    return uniqueItemEntries.filter(entry => entry.label.toLowerCase().includes(q));
  }, [uniqueItemEntries, itemFilterSearch]);

  const filteredCsvRows = useMemo(() => {
    if (csvMapping.nameCol === undefined || csvMapping.nameCol < 0 || selectedItemKeys === null) {
      return validCsvRows;
    }
    const col = csvMapping.nameCol;
    return validCsvRows.filter(row => selectedItemKeys.has((row[col] ?? '').trim()));
  }, [validCsvRows, csvMapping.nameCol, selectedItemKeys]);

  const isAllItemsSelected = selectedItemKeys === null;
  const selectedItemCount = selectedItemKeys === null ? uniqueItemEntries.length : selectedItemKeys.size;

  // Match stats for XY (3-decimal exact) Z-only update against existing points
  const xyZMatchStats = useMemo(() => {
    if (!appendMode || !zOnlyMergeByXY || existingPoints.length === 0) return null;

    const existingKeySet = new Set<string>();
    for (const pt of existingPoints) {
      if (Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
        existingKeySet.add(makeXYKey3(pt.x, pt.y));
      }
    }

    const csvZKeys = new Set<string>();
    let validZRowsCount = 0;
    let matchedCsvRowsCount = 0;
    let unmatchedCsvRowsCount = 0;

    if (csvMapping.zCol !== undefined && csvMapping.zCol >= 0) {
      for (const row of filteredCsvRows) {
        const x = Number(row[csvMapping.xCol]);
        const y = Number(row[csvMapping.yCol]);
        const rawZStr = row[csvMapping.zCol];
        const z = rawZStr !== undefined && String(rawZStr).trim() !== '' ? Number(rawZStr) : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;

        validZRowsCount++;
        const key = makeXYKey3(x, y);
        csvZKeys.add(key);
        if (existingKeySet.has(key)) matchedCsvRowsCount++;
        else unmatchedCsvRowsCount++;
      }
    }

    let matchedExistingCount = 0;
    for (const pt of existingPoints) {
      if (Number.isFinite(pt.x) && Number.isFinite(pt.y) && csvZKeys.has(makeXYKey3(pt.x, pt.y))) {
        matchedExistingCount++;
      }
    }

    return {
      validZRowsCount,
      matchedCsvRowsCount,
      unmatchedCsvRowsCount,
      matchedExistingCount
    };
  }, [appendMode, zOnlyMergeByXY, existingPoints, filteredCsvRows, csvMapping.xCol, csvMapping.yCol, csvMapping.zCol]);

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

  const applyRowsToPreview = (
    rows: (string | number)[][],
    headerIdx: number = 0,
    autoDetectHeader: boolean = true
  ) => {
    try {
      rawTableRowsRef.current = rows;
      const res = analyzeTableRows(rows, headerIdx, autoDetectHeader);
      const detectedZ = res.detectedMapping.zCol !== undefined && res.detectedMapping.zCol >= 0
        ? res.detectedMapping.zCol
        : -1;
      detectedCsvZColRef.current = detectedZ;
      setHeaderRowIdx(res.headerRowIndex);
      setCsvPreview(res);
      setCsvMapping({
        ...res.detectedMapping,
        zCol: zOnlyMergeByXY && detectedZ >= 0 ? detectedZ : -1,
        includeElevation: Boolean(zOnlyMergeByXY && detectedZ >= 0)
      });
      setSelectedItemKeys(null);
      setItemFilterSearch('');
      setLoadedFormat('csv');
    } catch (err: any) {
      console.warn('Failed to parse table rows:', err);
      alert('표 데이터를 분석할 수 없습니다: ' + (err?.message || err));
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
        const rows = parseCSVToRows(text);
        rawTableRowsRef.current = rows;
        const res = parseCSVPreview(text, headerRowIdx, false);
        const detectedZ = res.detectedMapping.zCol !== undefined && res.detectedMapping.zCol >= 0
          ? res.detectedMapping.zCol
          : -1;
        detectedCsvZColRef.current = detectedZ;
        setCsvPreview(res);
        setCsvMapping({
          ...res.detectedMapping,
          zCol: zOnlyMergeByXY && detectedZ >= 0 ? detectedZ : -1,
          includeElevation: Boolean(zOnlyMergeByXY && detectedZ >= 0)
        });
        setSelectedItemKeys(null);
        setItemFilterSearch('');
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

    // Case 4: Excel (.xlsx, .xls, .xlsm, .xlsb, .ods)
    const excelFile = fileArray.find(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'xlsb' || ext === 'ods';
    });
    if (excelFile) {
      try {
        setIsParsing(true);
        setParsingStatusMsg('엑셀 워크북 분석 및 시트 추출 중...');
        const buffer = await excelFile.arrayBuffer();
        rawInputRef.current = { kind: 'excel', filename: excelFile.name, buffer };
        const parsed = parseExcelWorkbook(buffer);
        excelWorkbookRef.current = parsed;
        setExcelSheets(parsed.sheetNames);
        const initialSheet = parsed.sheetNames[0];
        setSelectedExcelSheet(initialSheet);
        setCsvFileName(excelFile.name);
        const rows = parsed.getSheetRows(initialSheet);
        applyRowsToPreview(rows, 0, true);
        return;
      } catch (err: any) {
        console.warn('Excel parse failed:', err);
        alert('엑셀 파일 분석에 실패했습니다: ' + (err?.message || err));
      } finally {
        setIsParsing(false);
      }
    }

    // Case 5: CSV / Text / TSV (.csv, .txt, .tsv)
    const csvFile = fileArray.find(f => {
      const ext = f.name.split('.').pop()?.toLowerCase();
      return ext === 'csv' || ext === 'txt' || ext === 'tsv';
    });
    if (csvFile) {
      try {
        const buffer = await csvFile.arrayBuffer();
        rawInputRef.current = { kind: 'csv', filename: csvFile.name, buffer };
        excelWorkbookRef.current = null;
        setExcelSheets([]);
        setSelectedExcelSheet('');
        setCsvFileName(csvFile.name);
        const { text } = decodeBufferText(buffer, selectedEncoding);
        const rows = parseCSVToRows(text);
        applyRowsToPreview(rows, 0, true);
      } catch (err: any) {
        alert('지원하지 않는 파일 형식이거나 읽을 수 없는 텍스트입니다. CSV, Excel, GeoJSON, SHP 파일을 선택해 주세요.');
      }
      return;
    }

    // If we reached here and nothing was loaded, show a hint
    if (!loadedFormat) {
      alert('선택하신 파일 형식이 지원되지 않거나 분석에 실패했습니다. (지원: .dxf, .shp, .zip, .csv, .txt, .tsv, .xlsx, .xls, .xlsm, .xlsb, .ods, .json, .geojson)');
    }
  };

  const handleExcelSheetChange = (sheetName: string) => {
    if (!excelWorkbookRef.current) return;
    setSelectedExcelSheet(sheetName);
    const rows = excelWorkbookRef.current.getSheetRows(sheetName);
    applyRowsToPreview(rows, 0, true);
  };

  const handleHeaderRowChange = (newIdx: number) => {
    if (!rawTableRowsRef.current) return;
    applyRowsToPreview(rawTableRowsRef.current, newIdx, false);
  };

  const handleToggleItemFilter = (key: string) => {
    setSelectedItemKeys(prev => {
      const next = prev === null ? new Set(uniqueItemEntries.map(e => e.key)) : new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (next.size === uniqueItemEntries.length) return null;
      return next;
    });
  };

  const handleSelectSearchedItemsOnly = () => {
    const matched = new Set(searchedItemEntries.map(e => e.key));
    if (matched.size === uniqueItemEntries.length) {
      setSelectedItemKeys(null);
    } else {
      setSelectedItemKeys(matched);
    }
  };

  const handleApplySHP = () => {
    if (!shpResult) return;
    
    if (selectedLayerIds.size === 0) {
      alert('변환할 레이어를 최소 하나 이상 선택해 주세요.');
      return;
    }

    const filterLinearPt = (pt: Point2D): Point2D =>
      applyZ && pt.z !== undefined && Number.isFinite(pt.z)
        ? { x: pt.x, y: pt.y, z: pt.z }
        : { x: pt.x, y: pt.y };

    const filteredResult: SHPParseResult = {
      ...shpResult,
      layers: shpResult.layers.filter(l => selectedLayerIds.has(l.id)),
      points: shpResult.points.filter(p => selectedLayerIds.has(p.layerId)),
      lines: shpResult.lines
        .filter(l => selectedLayerIds.has(l.layerId))
        .map(l => ({ ...l, start: filterLinearPt(l.start), end: filterLinearPt(l.end) })),
      polylines: shpResult.polylines
        .filter(pl => selectedLayerIds.has(pl.layerId))
        .map(pl => ({ ...pl, points: pl.points.map(filterLinearPt) })),
      polygons: shpResult.polygons
        .filter(pg => selectedLayerIds.has(pg.layerId))
        .map(pg => ({ ...pg, points: pg.points.map(filterLinearPt) })),
      texts: shpResult.texts?.filter(t => selectedLayerIds.has(t.layerId))
    };

    onImportSHP(filteredResult, appendMode);
    rawInputRef.current = null;
    setShpResult(null);
    onClose();
  };

  const handleApplyCSV = () => {
    if (!csvPreview) return;
    if (filteredCsvRows.length === 0) {
      alert('가져올 측점이 없습니다. 열 매핑 또는 항목 필터를 확인해 주세요.');
      return;
    }

    if (appendMode && zOnlyMergeByXY && existingPoints.length > 0) {
      if (csvMapping.zCol === undefined || csvMapping.zCol < 0) {
        alert('기존 측점에 Z값을 추가하려면 표고(고도 Z) 열을 선택해 주세요.');
        return;
      }
      const effectiveMapping: CSVColumnMapping = { ...csvMapping, includeElevation: true };
      const parsedPoints = buildCADPointsFromCSV(filteredCsvRows, effectiveMapping, activeLayerId || 'layer-0')
        .filter(p => p.z !== undefined && Number.isFinite(p.z));
      if (parsedPoints.length === 0) {
        alert('선택한 표고(Z) 열에서 유효한 Z 좌표를 찾을 수 없습니다.');
        return;
      }
      if (!xyZMatchStats || xyZMatchStats.matchedExistingCount === 0) {
        alert('기존 측점 중 X, Y 좌표(소수점 3자리)가 일치하는 측점이 없습니다.');
        return;
      }
      onImportCSVPoints(parsedPoints, true, undefined, { zOnlyMergeByXY: true });
      rawInputRef.current = null;
      rawTableRowsRef.current = null;
      excelWorkbookRef.current = null;
      setCsvPreview(null);
      setZOnlyMergeByXY(false);
      onClose();
      return;
    }

    let chosenLayer: CADLayer = DEFAULT_ZERO_LAYER;
    if (createNewLayerMode) {
      const trimmedName = newLayerName.trim();
      if (!trimmedName) {
        alert('새 레이어 이름을 입력해 주세요.');
        return;
      }
      const existingMatch = appendMode
        ? availableLayers.find(l => l.name.trim() === trimmedName)
        : undefined;
      chosenLayer = existingMatch || {
        id: `layer-${Date.now()}`,
        name: trimmedName,
        color: newLayerColor,
        visible: true,
        locked: false,
        lineWidth: 2
      };
    } else if (appendMode) {
      chosenLayer = availableLayers.find(l => l.id === targetCsvLayerId) || availableLayers[0] || DEFAULT_ZERO_LAYER;
    }

    const points = buildCADPointsFromCSV(filteredCsvRows, csvMapping, chosenLayer.id);
    if (points.length === 0) {
      alert('유효한 좌표가 없습니다. 열 매핑을 확인해 주세요.');
      return;
    }

    onImportCSVPoints(points, appendMode, chosenLayer);
    rawInputRef.current = null;
    rawTableRowsRef.current = null;
    excelWorkbookRef.current = null;
    setCsvPreview(null);
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
              <input
                type="radio"
                checked={!appendMode}
                onChange={() => {
                  setAppendMode(false);
                  setZOnlyMergeByXY(false);
                }}
                className="text-sky-500"
              />
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
                accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.txt,.tsv,.shp,.dbf,.shx,.cpg,.zip,.geojson,.json,.dxf"
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

          {/* CSV / Excel Mapping, Filter & Target Layer */}
          {loadedFormat === 'csv' && csvPreview && (
            <div className="space-y-4 animate-in fade-in">
              <div className="bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 rounded-2xl space-y-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/80 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-100 dark:border-emerald-700/60 rounded-lg text-emerald-700 dark:text-emerald-400 text-[11px] font-bold">
                      <Check className="w-3.5 h-3.5" />
                      <span>
                        {filteredCsvRows.length !== validCsvRows.length
                          ? `필터 적용: ${filteredCsvRows.length.toLocaleString()} / ${validCsvRows.length.toLocaleString()}개`
                          : `유효 측점 ${validCsvRows.length.toLocaleString()}개 감지됨`}
                      </span>
                    </div>
                    {csvFileName && (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium truncate max-w-[200px]">
                        {csvFileName}
                      </span>
                    )}
                  </div>

                  {/* Sheet selector (Excel multi-sheet), Header row selector, and CSV encoding */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    {excelSheets.length > 1 && (
                      <label className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">시트:</span>
                        <select
                          value={selectedExcelSheet}
                          onChange={e => handleExcelSheetChange(e.target.value)}
                          className="bg-transparent text-slate-900 dark:text-white font-semibold outline-none"
                        >
                          {excelSheets.map(sheet => (
                            <option key={sheet} value={sheet}>{sheet}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {rawTableRowsRef.current && rawTableRowsRef.current.length > 1 && (
                      <label className="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-2 py-1">
                        <span className="text-slate-500 dark:text-slate-400 font-medium">제목 행:</span>
                        <select
                          value={headerRowIdx}
                          onChange={e => handleHeaderRowChange(parseInt(e.target.value, 10))}
                          className="bg-transparent text-slate-900 dark:text-white font-semibold outline-none"
                        >
                          {Array.from({ length: Math.min(8, rawTableRowsRef.current.length) }, (_, idx) => (
                            <option key={idx} value={idx}>{idx + 1}행</option>
                          ))}
                        </select>
                      </label>
                    )}

                    {rawInputRef.current?.kind === 'csv' && (
                      <div className="flex items-center gap-1 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg p-0.5">
                        <button
                          type="button"
                          onClick={() => handleReParse('auto')}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${selectedEncoding === 'auto' ? 'bg-sky-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}
                        >자동</button>
                        <button
                          type="button"
                          onClick={() => handleReParse('euc-kr')}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${selectedEncoding === 'euc-kr' ? 'bg-sky-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}
                        >CP949</button>
                        <button
                          type="button"
                          onClick={() => handleReParse('utf-8')}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition ${selectedEncoding === 'utf-8' ? 'bg-sky-600 text-white' : 'text-slate-500 dark:text-slate-400'}`}
                        >UTF-8</button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Column Mapping */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] text-sky-600 dark:text-sky-400 font-bold ml-1 flex items-center gap-1">
                      <span>CAD X 좌표 (수평)</span>
                      <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={csvMapping.xCol}
                      onChange={e => setCsvMapping(m => ({ ...m, xCol: parseInt(e.target.value, 10) }))}
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
                      onChange={e => setCsvMapping(m => ({ ...m, yCol: parseInt(e.target.value, 10) }))}
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
                      onChange={e => {
                        const val = parseInt(e.target.value, 10);
                        setCsvMapping(m => ({ ...m, nameCol: val }));
                        setSelectedItemKeys(null);
                        setItemFilterSearch('');
                      }}
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
                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-2.5 text-xs">
                    <span className="text-[11px] text-slate-600 dark:text-slate-300 font-bold">표고(Z) 열:</span>
                    <select
                      value={csvMapping.zCol ?? -1}
                      onChange={e => {
                        const val = parseInt(e.target.value, 10);
                        setCsvMapping(m => ({
                          ...m,
                          zCol: val,
                          includeElevation: val >= 0
                        }));
                      }}
                      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium shadow-sm"
                    >
                      <option value={-1}>사용 안함 (Z 제외)</option>
                      {csvPreview.headers.map((h, i) => (
                        <option key={i} value={i}>{h} (열 {i + 1})</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Item Filter (항목 필터) */}
                {csvMapping.nameCol !== undefined && csvMapping.nameCol >= 0 && uniqueItemEntries.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                        <Filter className="w-3.5 h-3.5 text-amber-500" />
                        <span>가져올 항목 필터</span>
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                          ({selectedItemCount}/{uniqueItemEntries.length}종 · {filteredCsvRows.length.toLocaleString()}개)
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[11px]">
                        {itemFilterSearch.trim() !== '' && searchedItemEntries.length > 0 && (
                          <>
                            <button
                              type="button"
                              onClick={handleSelectSearchedItemsOnly}
                              className="text-amber-600 dark:text-amber-400 hover:underline font-semibold"
                            >
                              검색 결과만 선택 ({searchedItemEntries.length})
                            </button>
                            <span className="text-slate-300 dark:text-slate-700">|</span>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelectedItemKeys(null)}
                          className="text-sky-600 dark:text-sky-400 hover:underline font-semibold"
                        >
                          전체 선택
                        </button>
                        <span className="text-slate-300 dark:text-slate-700">|</span>
                        <button
                          type="button"
                          onClick={() => setSelectedItemKeys(new Set())}
                          className="text-slate-500 dark:text-slate-400 hover:underline"
                        >
                          모두 해제
                        </button>
                      </div>
                    </div>

                    {uniqueItemEntries.length > 6 && (
                      <div className="relative">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={itemFilterSearch}
                          onChange={e => setItemFilterSearch(e.target.value)}
                          placeholder="항목명 검색 (예: 맨홀, 전주, 경계)..."
                          className="w-full pl-8 pr-7 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-900 dark:text-white outline-none focus:ring-1 focus:ring-amber-500"
                        />
                        {itemFilterSearch && (
                          <button
                            type="button"
                            onClick={() => setItemFilterSearch('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1.5 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                      {searchedItemEntries.slice(0, 150).map(entry => {
                        const checked = isAllItemsSelected || selectedItemKeys?.has(entry.key) || false;
                        return (
                          <label
                            key={entry.key || '__empty__'}
                            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[11px] cursor-pointer transition ${
                              checked
                                ? 'bg-amber-50/80 dark:bg-amber-950/40 border-amber-300 dark:border-amber-600/50 text-slate-900 dark:text-amber-100'
                                : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => handleToggleItemFilter(entry.key)}
                              className="w-3.5 h-3.5 rounded border-slate-300 text-amber-500 focus:ring-amber-500 shrink-0"
                            />
                            <span className="truncate flex-1 font-medium" title={entry.label}>
                              {entry.label}
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 shrink-0">
                              {entry.count}
                            </span>
                          </label>
                        );
                      })}
                    </div>

                    {searchedItemEntries.length > 150 && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500">
                        항목 종류가 많아 상위 150개만 표시됩니다. 위 검색창으로 항목을 좁혀 선택할 수 있습니다.
                      </p>
                    )}

                    {filteredCsvRows.length === 0 && (
                      <div className="flex items-center gap-1.5 p-2 bg-amber-50 dark:bg-amber-950/40 rounded-lg border border-amber-200 dark:border-amber-900/50 text-amber-700 dark:text-amber-400 text-[11px]">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>선택된 항목이 없습니다. 가져올 항목을 하나 이상 선택해 주세요.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* Existing Points XY 3-decimal Z-only Merge Mode */}
                {appendMode && existingPoints.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                    <label
                      className={`flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition select-none ${
                        zOnlyMergeByXY
                          ? 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-700/70'
                          : 'bg-slate-50 dark:bg-slate-900/70 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={zOnlyMergeByXY}
                          onChange={e => {
                            const checked = e.target.checked;
                            setZOnlyMergeByXY(checked);
                            if (checked) {
                              setCsvMapping(m => {
                                const nextZCol = (m.zCol !== undefined && m.zCol >= 0) ? m.zCol : detectedCsvZColRef.current;
                                return {
                                  ...m,
                                  zCol: nextZCol,
                                  includeElevation: nextZCol >= 0
                                };
                              });
                            }
                          }}
                          className="w-4 h-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 shrink-0"
                        />
                        <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                          동일 X·Y(소수점 3자리) 기존 측점에 Z값만 추가
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0 hidden sm:inline">
                        측점명 무관 · 새 측점 미추가
                      </span>
                    </label>

                    {zOnlyMergeByXY && (
                      <div className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/70 text-[11px]">
                        {csvMapping.zCol === undefined || csvMapping.zCol < 0 ? (
                          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>위에서 &apos;표고(Z) 열&apos;을 선택해 주세요.</span>
                          </div>
                        ) : xyZMatchStats && xyZMatchStats.matchedExistingCount > 0 ? (
                          <div className="flex flex-wrap items-center justify-between gap-2 text-emerald-700 dark:text-emerald-300 font-semibold">
                            <span>
                              기존 측점 {xyZMatchStats.matchedExistingCount.toLocaleString()}개 일치 (Z 업데이트)
                            </span>
                            <span className="text-[10px] text-slate-500 dark:text-slate-400 font-normal">
                              미일치 {xyZMatchStats.unmatchedCsvRowsCount.toLocaleString()}개 제외
                            </span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 font-semibold">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>일치하는 기존 측점이 없습니다. (유효 Z행 {xyZMatchStats?.validZRowsCount || 0}개)</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Target Layer Selection (배치할 레이어 선택 - disabled when Z-only merge is active) */}
                {!(appendMode && zOnlyMergeByXY && existingPoints.length > 0) && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
                      <Layers className="w-3.5 h-3.5 text-sky-500" />
                      <span>배치할 레이어 일괄 지정</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCreateNewLayerMode(v => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline"
                    >
                      <Plus className="w-3 h-3" />
                      <span>{createNewLayerMode ? '기존 레이어에서 선택' : '새 레이어 직접 만들기'}</span>
                    </button>
                  </div>

                  {createNewLayerMode ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="color"
                        value={newLayerColor}
                        onChange={e => setNewLayerColor(e.target.value)}
                        title="새 레이어 색상"
                        className="w-9 h-9 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 cursor-pointer shrink-0"
                      />
                      <input
                        type="text"
                        value={newLayerName}
                        onChange={e => setNewLayerName(e.target.value)}
                        placeholder="새 레이어 이름 입력 (예: 측량_맨홀, 경계측점)"
                        className="flex-1 min-w-[180px] bg-white dark:bg-slate-900 border border-sky-300 dark:border-sky-600 text-slate-900 dark:text-white text-xs rounded-xl px-3 py-2 outline-none focus:ring-1 focus:ring-sky-500 font-medium"
                      />
                    </div>
                  ) : appendMode ? (
                    <div className="space-y-1">
                      <select
                        value={availableLayers.some(l => l.id === targetCsvLayerId) ? targetCsvLayerId : (availableLayers[0]?.id || 'layer-0')}
                        onChange={e => setTargetCsvLayerId(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white text-xs rounded-xl p-2.5 focus:outline-none focus:ring-1 focus:ring-sky-500 font-medium shadow-sm"
                      >
                        {availableLayers.map(layer => (
                          <option key={layer.id} value={layer.id}>
                            {layer.name}
                          </option>
                        ))}
                      </select>
                      {availableLayers.length <= 1 && (
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 ml-1">
                          현재 도면에 기본(0) 레이어만 있습니다. 오른쪽 위 &apos;새 레이어 직접 만들기&apos; 또는 레이어 패널에서 미리 추가해 분류할 수 있습니다.
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-600 dark:text-slate-300">
                      <span>새로 시작 모드에서는 기본 <strong className="text-slate-900 dark:text-white">0</strong> 레이어에 배치됩니다.</span>
                      <span className="text-[10px] text-slate-400">(또는 새 레이어 만들기 선택)</span>
                    </div>
                  )}
                </div>
                )}

                {/* Data Preview Table */}
                {filteredCsvRows.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold flex items-center justify-between">
                      <span>가져올 데이터 미리보기 (상위 {Math.min(5, filteredCsvRows.length)}행)</span>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 text-[11px] shadow-inner">
                      <table className="w-full text-left font-mono">
                        <thead className="bg-slate-100 dark:bg-slate-950/80 text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 text-[10px]">
                          <tr>
                            <th className="py-1.5 px-3">CAD X</th>
                            <th className="py-1.5 px-3">CAD Y</th>
                            <th className="py-1.5 px-3 text-amber-700 dark:text-amber-300">항목 (텍스트)</th>
                            {(csvMapping.includeElevation || (appendMode && zOnlyMergeByXY)) && <th className="py-1.5 px-3">표고(Z)</th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-slate-700 dark:text-slate-300">
                          {filteredCsvRows.slice(0, 5).map((row, rIdx) => (
                            <tr key={rIdx} className="hover:bg-white dark:hover:bg-slate-800/30">
                              <td className="py-1.5 px-3 text-sky-600 dark:text-sky-400">{row[csvMapping.xCol] || '-'}</td>
                              <td className="py-1.5 px-3 text-sky-600 dark:text-sky-400">{row[csvMapping.yCol] || '-'}</td>
                              <td className="py-1.5 px-3 font-semibold text-amber-600 dark:text-amber-300">
                                {csvMapping.nameCol !== undefined && csvMapping.nameCol >= 0 ? (row[csvMapping.nameCol] || '-') : String(rIdx + 1)}
                              </td>
                              {(csvMapping.includeElevation || (appendMode && zOnlyMergeByXY)) && (
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
                disabled={
                  filteredCsvRows.length === 0 ||
                  (appendMode &&
                    zOnlyMergeByXY &&
                    existingPoints.length > 0 &&
                    (csvMapping.zCol === undefined ||
                      csvMapping.zCol < 0 ||
                      !xyZMatchStats ||
                      xyZMatchStats.matchedExistingCount === 0))
                }
                className={`w-full py-3.5 ${
                  appendMode && zOnlyMergeByXY && existingPoints.length > 0
                    ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 shadow-emerald-600/30'
                    : 'bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 shadow-sky-600/30'
                } disabled:opacity-50 text-white font-bold rounded-xl shadow-lg transition active:scale-95 flex items-center justify-center gap-2`}
              >
                <Check className="w-4 h-4" />
                <span>
                  {appendMode && zOnlyMergeByXY && existingPoints.length > 0
                    ? `동일 좌표 ${(xyZMatchStats?.matchedExistingCount || 0).toLocaleString()}개 측점에 Z값만 추가하기`
                    : `선택한 측점 ${filteredCsvRows.length.toLocaleString()}개 도면에 배치하기`}
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex justify-between bg-slate-50/50 dark:bg-slate-950/50">
          <button 
            onClick={() => {
              setLoadedFormat(null);
              setShpResult(null);
              setCsvPreview(null);
              setCsvFileName(null);
              setExcelSheets([]);
              setSelectedExcelSheet('');
              setSelectedItemKeys(null);
              setItemFilterSearch('');
              setZOnlyMergeByXY(false);
              detectedCsvZColRef.current = -1;
              rawInputRef.current = null;
              rawTableRowsRef.current = null;
              excelWorkbookRef.current = null;
            }} 
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
