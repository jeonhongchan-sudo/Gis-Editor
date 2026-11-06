/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import iconv from 'iconv-lite';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D, UnifiedCADData } from '../types/cad';
import { detectKoreanEncoding, smartDecodeKoreanBytes } from './encoding';

export interface DbfField {
  name: string;
  type: string;
  length: number;
  decimals: number;
}

export type DbfRecord = Record<string, string | number>;

export interface DbfParseResult {
  fields: DbfField[];
  records: DbfRecord[];
  detectedEncoding: 'utf-8' | 'euc-kr';
}

export type SHPParseResult = UnifiedCADData;

const LAYER_COLORS = ['#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', '#60a5fa', '#f97316'];

/**
 * Attempts to repair Latin-1 mojibake from CP949 Korean characters
 */
export function tryRepairMojibake(str: string): string {
  if (!str) return str;
  try {
    const raw = Buffer.from(str, 'latin1');
    const repaired = iconv.decode(raw, 'cp949');
    if (/[\uAC00-\uD7AF]/.test(repaired) && !repaired.includes('\uFFFD')) {
      return repaired;
    }
  } catch {}
  return str;
}

/**
 * Parse dBASE III / IV (.dbf) binary buffer with auto encoding detection (CP949 vs UTF-8)
 */
export function parseDbfBuffer(
  buffer: ArrayBuffer,
  forcedEncoding?: 'utf-8' | 'euc-kr'
): DbfParseResult {
  if (buffer.byteLength < 32) {
    return { fields: [], records: [], detectedEncoding: 'euc-kr' };
  }

  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);
  const numRecords = view.getUint32(4, true);
  const headerLength = view.getUint16(8, true);
  const recordLength = view.getUint16(10, true);

  // Field descriptors (each 32 bytes starting at offset 32)
  const rawFields: { nameBytes: Uint8Array; type: string; length: number; decimals: number }[] = [];
  let offset = 32;
  while (offset < headerLength - 1) {
    if (u8[offset] === 0x0D) break; // Header end
    let nameBytes = u8.subarray(offset, offset + 11);
    const nullIdx = nameBytes.indexOf(0);
    if (nullIdx >= 0) {
      nameBytes = nameBytes.subarray(0, nullIdx);
    }
    const type = String.fromCharCode(u8[offset + 11]);
    const length = u8[offset + 16];
    const decimals = u8[offset + 17];
    rawFields.push({ nameBytes, type, length, decimals });
    offset += 32;
  }

  // Detect encoding
  let enc: 'utf-8' | 'euc-kr' = forcedEncoding || 'euc-kr';
  if (!forcedEncoding) {
    // Check byte 29 (Language driver ID): 0x4D = CP949, 0x57 = ANSI 949 (Korean Windows), 0x96 = CP949
    const langDriver = u8[29];
    if (langDriver === 0x4D || langDriver === 0x57 || langDriver === 0x96) {
      enc = 'euc-kr';
    } else {
      // Sample both field descriptors and record contents to detect CP949 vs UTF-8
      const sampleChunks: Uint8Array[] = [];
      for (const rf of rawFields) {
        sampleChunks.push(rf.nameBytes);
      }
      let rOffset = headerLength;
      for (let r = 0; r < Math.min(numRecords, 100); r++) {
        if (rOffset + recordLength <= buffer.byteLength && u8[rOffset] !== 0x2A) {
          sampleChunks.push(u8.subarray(rOffset + 1, rOffset + recordLength));
        }
        rOffset += recordLength;
      }
      const totalSampleLen = sampleChunks.reduce((acc, c) => acc + c.length, 0);
      const sampleBuf = new Uint8Array(totalSampleLen);
      let sPos = 0;
      for (const chunk of sampleChunks) {
        sampleBuf.set(chunk, sPos);
        sPos += chunk.length;
      }

      enc = detectKoreanEncoding(sampleBuf.buffer);
    }
  }

  const decodeBytes = (bytes: Uint8Array): string => {
    if (forcedEncoding === 'utf-8') {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes).replace(/\0/g, '').trim();
    }
    if (forcedEncoding === 'euc-kr') {
      return iconv.decode(Buffer.from(bytes), 'cp949').replace(/\0/g, '').trim();
    }
    // Auto: try smartDecodeKoreanBytes first (prioritizes Korean syllable detection)
    const decoded = smartDecodeKoreanBytes(bytes).replace(/\0/g, '').trim();
    return tryRepairMojibake(decoded);
  };

  // Decode field names
  const fields: DbfField[] = rawFields.map(f => {
    const name = decodeBytes(f.nameBytes);
    return { name, type: f.type, length: f.length, decimals: f.decimals };
  });

  // Decode records
  const records: DbfRecord[] = [];
  let recOffset = headerLength;
  for (let r = 0; r < numRecords; r++) {
    if (recOffset + recordLength > buffer.byteLength) break;
    const isDeleted = u8[recOffset] === 0x2A; // 0x2A is deleted record marker
    if (!isDeleted) {
      let fOffset = recOffset + 1;
      const rec: DbfRecord = {};
      for (const f of fields) {
        const raw = u8.subarray(fOffset, fOffset + f.length);
        const valStr = decodeBytes(raw);

        if (f.type === 'N' || f.type === 'F') {
          const num = Number(valStr);
          rec[f.name] = !isNaN(num) && valStr !== '' ? num : valStr;
        } else {
          rec[f.name] = valStr;
        }
        fOffset += f.length;
      }
      records.push(rec);
    }
    recOffset += recordLength;
  }

  return { fields, records, detectedEncoding: enc };
}

/**
 * Parse raw ESRI .shp binary buffer with optional companion .dbf buffer
 */
export function parseShpBuffer(
  buffer: ArrayBuffer,
  filename: string = 'shapefile',
  dbfBuffer?: ArrayBuffer,
  fileIndex: number = 0,
  forcedEncoding?: 'utf-8' | 'euc-kr'
): SHPParseResult {
  const view = new DataView(buffer);
  if (buffer.byteLength < 100) {
    throw new Error('유효한 ESRI Shapefile 헤더 크기보다 작습니다.');
  }

  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) {
    throw new Error('유효한 ESRI Shapefile (.shp) 파일이 아닙니다.');
  }

  // Parse DBF if available
  let dbfResult: DbfParseResult | null = null;
  if (dbfBuffer && dbfBuffer.byteLength > 32) {
    try {
      dbfResult = parseDbfBuffer(dbfBuffer, forcedEncoding);
    } catch (err) {
      console.warn('Failed to parse companion DBF:', err);
    }
  }

  const fileLengthBytes = view.getInt32(24, false) * 2;
  let cleanName = filename.replace(/\.[^/.]+$/, '').trim() || 'shapefile';
  cleanName = tryRepairMojibake(cleanName);
  const layerId = `layer-${cleanName.replace(/[\s\.]/g, '_')}`;

  const minXHeader = view.getFloat64(36, true);
  const minYHeader = view.getFloat64(44, true);
  const maxXHeader = view.getFloat64(52, true);
  const maxYHeader = view.getFloat64(60, true);

  const points: CADPoint[] = [];
  const lines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];
  const texts: CADText[] = [];

  let offset = 100;
  let recordIndex = 1;

  // Candidate fields for point names / labels (case-insensitive, prioritizing QGIS and CAD DXF conversion fields)
  const NAME_KEYS = [
    'text', 'textstring', 'text_string', 'txt', 'txtmemo', 'string', 'label', 'name',
    '측점명', '명칭', 'pt_name', 'point_name', 'entity', 'descr', 'description', 'descriptio',
    'content', 'annotation', 'val', 'value', 'code', '항목', '비고', 'id', 'no', 'number',
    'feature', 'title', 'refname', 'blockname', 'field_1'
  ];
  const ELEV_KEYS = ['z', 'elev', 'elevation', '고도', '표고', 'height', 'depth', '심도'];
  const LAYER_KEYS = ['layer', '도면층', '레이어', 'layername', 'cadlayer'];

  const now = Date.now();

  while (offset < Math.min(fileLengthBytes, buffer.byteLength) - 8) {
    const contentLenBytes = view.getInt32(offset + 4, false) * 2;
    const recShapeType = view.getInt32(offset + 8, true);

    if (recShapeType === 0) {
      // Null shape
      offset += 8 + contentLenBytes;
      recordIndex++;
      continue;
    }

    const dbfRec = dbfResult?.records[recordIndex - 1];

    // Helper to find field value
    const findDbfValue = (candidates: string[]): string | undefined => {
      if (!dbfRec) return undefined;
      for (const k of candidates) {
        for (const [rk, rv] of Object.entries(dbfRec)) {
          if (rk.toLowerCase() === k.toLowerCase() && rv !== undefined && String(rv).trim() !== '') {
            return String(rv).trim();
          }
        }
      }
      return undefined;
    };

    // Helper to find elevation Z
    const findDbfElev = (): number | undefined => {
      if (!dbfRec) return undefined;
      for (const k of ELEV_KEYS) {
        for (const [rk, rv] of Object.entries(dbfRec)) {
          if (rk.toLowerCase() === k.toLowerCase() && rv !== undefined && !isNaN(Number(rv)) && String(rv).trim() !== '') {
            return Number(rv);
          }
        }
      }
      return undefined;
    };

    // Determine target layer from DBF or default
    const dbfLayer = findDbfValue(LAYER_KEYS);
    const effectiveLayerId = dbfLayer ? `layer-${dbfLayer.trim().replace(/[\s\.]/g, '_')}` : layerId;

    // 1. Points: Point (1), PointZ (11), PointM (21) - Crucial for QGIS DXF converted text/points!
    if (recShapeType === 1 || recShapeType === 11 || recShapeType === 21) {
      const x = view.getFloat64(offset + 12, true);
      const y = view.getFloat64(offset + 20, true);

      // In PointZ (11), elevation is stored directly as a double at offset + 28
      let zVal: number | undefined = undefined;
      if (recShapeType === 11 && offset + 36 <= buffer.byteLength) {
        const binaryZ = view.getFloat64(offset + 28, true);
        if (!isNaN(binaryZ) && binaryZ > -1e30) {
          zVal = binaryZ;
        }
      }
      if (zVal === undefined) {
        zVal = findDbfElev();
      }

      // Extract point name from DBF (supports QGIS Text, Label, Name, etc.)
      let ptName = findDbfValue(NAME_KEYS);
      if (!ptName && dbfRec) {
        // Fallback: search any non-empty string attribute that isn't a technical CAD code
        for (const [k, v] of Object.entries(dbfRec)) {
          const lk = k.toLowerCase();
          if (
            typeof v === 'string' && 
            v.trim() !== '' && 
            !lk.includes('color') && 
            !lk.includes('linetype') && 
            !lk.includes('thickness') && 
            !lk.includes('handle')
          ) {
            ptName = v.trim();
            break;
          }
        }
      }
      if (!ptName) {
        ptName = `${cleanName}_${recordIndex}`;
      }

      points.push({
        id: `shp-pt-${now}-${fileIndex}-${recordIndex}`,
        name: ptName,
        x,
        y,
        z: zVal,
        layerId: effectiveLayerId,
        isSurveyNode: true
      });
    } 
    // 2. MultiPoints: MultiPoint (8), MultiPointZ (18), MultiPointM (28)
    else if (recShapeType === 8 || recShapeType === 18 || recShapeType === 28) {
      const numPoints = view.getInt32(offset + 44, true);
      const ptsStart = offset + 48;
      const ptName = findDbfValue(NAME_KEYS) || `${cleanName}_${recordIndex}`;
      for (let p = 0; p < numPoints; p++) {
        const px = view.getFloat64(ptsStart + p * 16, true);
        const py = view.getFloat64(ptsStart + p * 16 + 8, true);
        points.push({
          id: `shp-mpt-${now}-${fileIndex}-${recordIndex}-${p + 1}`,
          name: `${ptName}_${p + 1}`,
          x: px,
          y: py,
          layerId: effectiveLayerId,
          isSurveyNode: true
        });
      }
    }
    // 3. PolyLines: PolyLine (3), PolyLineZ (13), PolyLineM (23)
    else if (recShapeType === 3 || recShapeType === 13 || recShapeType === 23) {
      const numParts = view.getInt32(offset + 44, true);
      const numPoints = view.getInt32(offset + 48, true);
      const partsStart = offset + 52;
      const pointsStart = partsStart + numParts * 4;

      const polyPoints: Point2D[] = [];
      for (let p = 0; p < numPoints; p++) {
        const px = view.getFloat64(pointsStart + p * 16, true);
        const py = view.getFloat64(pointsStart + p * 16 + 8, true);
        polyPoints.push({ x: px, y: py });
      }

      if (polyPoints.length >= 2) {
        let lineName = findDbfValue(NAME_KEYS) || `${cleanName}_선_${recordIndex}`;
        polylines.push({
          id: `shp-pl-${Date.now()}-${recordIndex}`,
          points: polyPoints,
          isClosed: false,
          layerId: effectiveLayerId,
          name: lineName,
          attributes: dbfRec ? { ...dbfRec } : undefined
        });
      }
    } 
    // 4. Polygons: Polygon (5), PolygonZ (15), PolygonM (25)
    else if (recShapeType === 5 || recShapeType === 15 || recShapeType === 25) {
      const numParts = view.getInt32(offset + 44, true);
      const numPoints = view.getInt32(offset + 48, true);
      const partsStart = offset + 52;
      const pointsStart = partsStart + numParts * 4;

      const polyPoints: Point2D[] = [];
      for (let p = 0; p < numPoints; p++) {
        const px = view.getFloat64(pointsStart + p * 16, true);
        const py = view.getFloat64(pointsStart + p * 16 + 8, true);
        polyPoints.push({ x: px, y: py });
      }

      if (polyPoints.length >= 3) {
        let polyName = findDbfValue(NAME_KEYS) || `${cleanName}_구역_${recordIndex}`;
        polygons.push({
          id: `shp-pg-${Date.now()}-${recordIndex}`,
          points: polyPoints,
          layerId: effectiveLayerId,
          name: polyName,
          fillOpacity: 0.15
        });
      }
    }

    offset += 8 + contentLenBytes;
    recordIndex++;
  }

  // Build layers list
  const layerIds = Array.from(new Set([
    layerId,
    ...points.map(p => p.layerId),
    ...polylines.map(pl => pl.layerId),
    ...polygons.map(pg => pg.layerId),
    ...texts.map(t => t.layerId)
  ]));

  const layers: CADLayer[] = layerIds.map((lid, idx) => ({
    id: lid,
    name: lid === layerId ? cleanName : lid.replace(/^layer-/, ''),
    color: LAYER_COLORS[idx % LAYER_COLORS.length],
    visible: true,
    locked: false,
    lineWidth: 2
  }));

  return {
    points,
    lines,
    polylines,
    polygons,
    texts,
    layers,
    layerName: cleanName,
    detectedEncoding: dbfResult?.detectedEncoding,
    dbfFields: dbfResult?.fields.map(f => f.name),
    bounds: {
      minX: minXHeader,
      minY: minYHeader,
      maxX: maxXHeader,
      maxY: maxYHeader
    }
  };
}

/**
 * Parse Shapefile package from .zip archive (extracting .shp, .dbf, .cpg with CP949/UTF-8 detection)
 */
export async function parseShapefileZip(
  zipBuffer: ArrayBuffer,
  forcedEncoding?: 'utf-8' | 'euc-kr'
): Promise<SHPParseResult> {
  // 1. Load zip with smart CP949/UTF-8 filename decoder
  const zip = await JSZip.loadAsync(zipBuffer, {
    decodeFileName: smartDecodeKoreanBytes
  });

  const allFiles = Object.values(zip.files).filter(f => !f.dir && !f.name.startsWith('__MACOSX'));

  // 2. Check for .cpg file specifying code page (e.g. 949, CP949, EUC-KR, UTF-8)
  let cpgEncoding: 'utf-8' | 'euc-kr' | undefined = forcedEncoding;
  const cpgEntry = allFiles.find(f => f.name.toLowerCase().endsWith('.cpg'));
  if (!cpgEncoding && cpgEntry) {
    try {
      const cpgText = (await cpgEntry.async('text')).toUpperCase().trim();
      if (cpgText.includes('949') || cpgText.includes('EUC-KR') || cpgText.includes('ANSI') || cpgText.includes('KOREAN')) {
        cpgEncoding = 'euc-kr';
      } else if (cpgText.includes('UTF-8') || cpgText.includes('UTF8') || cpgText.includes('65001')) {
        cpgEncoding = 'utf-8';
      }
    } catch (err) {
      console.warn('Failed to parse .cpg file:', err);
    }
  }

  // 3. Find all .shp files
  const shpEntries = allFiles.filter(f => f.name.toLowerCase().endsWith('.shp'));
  if (shpEntries.length === 0) {
    throw new Error('ZIP 압축 파일 내에 .shp 파일을 찾을 수 없습니다.');
  }

  const combinedPoints: CADPoint[] = [];
  const combinedLines: CADLine[] = [];
  const combinedPolylines: CADPolyline[] = [];
  const combinedPolygons: CADPolygon[] = [];
  const combinedTexts: CADText[] = [];
  const combinedLayers: CADLayer[] = [];
  const combinedDbfFields = new Set<string>();
  let detectedEncoding: 'utf-8' | 'euc-kr' = forcedEncoding || cpgEncoding || 'euc-kr';

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < shpEntries.length; i++) {
    const shpEntry = shpEntries[i];
    const shpBuffer = await shpEntry.async('arraybuffer');

    // Find matching .dbf file (matching name without extension or matching filename)
    const baseShpPath = shpEntry.name.replace(/\.shp$/i, '');
    const shpFileNameOnly = (shpEntry.name.split('/').pop() || '').replace(/\.shp$/i, '').toLowerCase();

    let dbfEntry = allFiles.find(f => {
      const baseDbfPath = f.name.replace(/\.dbf$/i, '');
      return baseDbfPath.toLowerCase() === baseShpPath.toLowerCase() && f.name.toLowerCase().endsWith('.dbf');
    });

    if (!dbfEntry) {
      dbfEntry = allFiles.find(f => {
        const dbfFileNameOnly = (f.name.split('/').pop() || '').replace(/\.dbf$/i, '').toLowerCase();
        return dbfFileNameOnly === shpFileNameOnly && f.name.toLowerCase().endsWith('.dbf');
      });
    }

    if (!dbfEntry && allFiles.filter(f => f.name.toLowerCase().endsWith('.dbf')).length === 1) {
      dbfEntry = allFiles.find(f => f.name.toLowerCase().endsWith('.dbf'));
    }

    let dbfBuffer: ArrayBuffer | undefined = undefined;
    if (dbfEntry) {
      dbfBuffer = await dbfEntry.async('arraybuffer');
    }

    const displayName = shpEntry.name.split('/').pop() || shpEntry.name;
    const effectiveEnc = forcedEncoding || cpgEncoding;
    const result = parseShpBuffer(shpBuffer, displayName, dbfBuffer, i, effectiveEnc);

    if (result.detectedEncoding) {
      detectedEncoding = result.detectedEncoding;
    }
    if (result.dbfFields) {
      result.dbfFields.forEach(f => combinedDbfFields.add(f));
    }

    // Merge layers
    result.layers.forEach(nl => {
      if (!combinedLayers.some(l => l.id === nl.id)) {
        nl.color = LAYER_COLORS[combinedLayers.length % LAYER_COLORS.length];
        combinedLayers.push(nl);
      }
    });

    combinedPoints.push(...result.points);
    combinedLines.push(...result.lines);
    combinedPolylines.push(...result.polylines);
    combinedPolygons.push(...result.polygons);
    if (result.texts) {
      combinedTexts.push(...result.texts);
    }

    if (result.bounds) {
      minX = Math.min(minX, result.bounds.minX);
      minY = Math.min(minY, result.bounds.minY);
      maxX = Math.max(maxX, result.bounds.maxX);
      maxY = Math.max(maxY, result.bounds.maxY);
    }
  }

  const primaryName = shpEntries.length === 1 
    ? tryRepairMojibake(shpEntries[0].name.split('/').pop()?.replace(/\.[^/.]+$/, '') || 'SHP 도면')
    : 'SHP 압축 도면';

  return {
    points: combinedPoints,
    lines: combinedLines,
    polylines: combinedPolylines,
    polygons: combinedPolygons,
    texts: combinedTexts,
    layers: combinedLayers,
    layerName: primaryName,
    detectedEncoding,
    dbfFields: Array.from(combinedDbfFields),
    bounds: minX !== Infinity ? { minX, minY, maxX, maxY } : undefined
  };
}
