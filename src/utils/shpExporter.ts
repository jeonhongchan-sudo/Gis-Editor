/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, Point2D } from '../types/cad';
import { COORDINATE_SYSTEMS } from './projections';

interface ShpFeaturePoint {
  x: number;
  y: number;
  properties: Record<string, string | number>;
}

interface ShpFeaturePolyline {
  points: Point2D[];
  properties: Record<string, string | number>;
}

import { encodeText, safeByteClip } from './encoding';

function clipStringToMaxBytes(str: string, maxBytes: number, encoding: 'utf-8' | 'euc-kr'): string {
  let result = '';
  for (const ch of str) {
    const candidate = result + ch;
    if (encodeText(candidate, encoding).length > maxBytes) {
      break;
    }
    result = candidate;
  }
  return result;
}

function makeUniqueDbfFieldName(
  rawKey: string,
  usedUpperNames: Set<string>,
  encoding: 'utf-8' | 'euc-kr'
): string {
  const clean = rawKey.trim();
  let base = clipStringToMaxBytes(clean, 10, encoding);
  if (!base) base = 'ATTR';
  if (!usedUpperNames.has(base.toUpperCase())) {
    usedUpperNames.add(base.toUpperCase());
    return base;
  }
  let counter = 1;
  while (counter < 100) {
    const suffix = `_${counter}`;
    const prefix = clipStringToMaxBytes(clean, Math.max(1, 10 - suffix.length), encoding);
    const candidate = `${prefix}${suffix}`;
    if (!usedUpperNames.has(candidate.toUpperCase())) {
      usedUpperNames.add(candidate.toUpperCase());
      return candidate;
    }
    counter++;
  }
  const fallback = `F_${usedUpperNames.size}`;
  usedUpperNames.add(fallback.toUpperCase());
  return fallback;
}

/**
 * Creates DBF file buffer from fields and records
 */
function createDbfBuffer(
  fields: { name: string; type: 'C' | 'N'; length: number; decimals: number }[],
  records: Record<string, string | number>[],
  encoding: 'utf-8' | 'euc-kr' = 'euc-kr'
): ArrayBuffer {
  const numRecords = records.length;
  const headerLength = 32 + 32 * fields.length + 1;
  const recordLength = 1 + fields.reduce((sum, f) => sum + f.length, 0);
  const totalLength = headerLength + numRecords * recordLength + 1;

  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // DBF Header
  view.setUint8(0, 0x03); // dBASE III
  const now = new Date();
  view.setUint8(1, now.getFullYear() - 1900);
  view.setUint8(2, now.getMonth() + 1);
  view.setUint8(3, now.getDate());
  view.setUint32(4, numRecords, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);

  // Field descriptors
  let offset = 32;
  fields.forEach(f => {
    // Field name in DBF must be at most 10 bytes + null terminator
    const clippedName = safeByteClip(f.name, 10, encoding === 'euc-kr' ? 'euc-kr' : 'utf-8');
    for (let i = 0; i < 11; i++) {
      u8[offset + i] = i < clippedName.length ? clippedName[i] : 0;
    }
    view.setUint8(offset + 11, f.type.charCodeAt(0));
    view.setUint8(offset + 16, f.length);
    view.setUint8(offset + 17, f.decimals);
    offset += 32;
  });

  // Header terminator
  u8[offset++] = 0x0D;

  // Records
  records.forEach(rec => {
    u8[offset++] = 0x20; // ' ' not deleted flag
    fields.forEach(f => {
      const rawVal = rec[f.name];
      const val = rawVal !== undefined && rawVal !== null ? String(rawVal) : '';

      if (f.type === 'N') {
        const trimmed = val.trim();
        const num = typeof rawVal === 'number' ? rawVal : Number(trimmed);
        if (!trimmed || !Number.isFinite(num)) {
          u8.fill(0x20, offset, offset + f.length);
        } else {
          let numStr = f.decimals > 0 ? num.toFixed(f.decimals) : String(Math.round(num));
          if (numStr.length > f.length) {
            numStr = String(Math.round(num));
          }
          if (numStr.length > f.length) {
            u8.fill(0x20, offset, offset + f.length);
          } else {
            const padded = numStr.padStart(f.length, ' ');
            for (let i = 0; i < f.length; i++) {
              u8[offset + i] = padded.charCodeAt(i);
            }
          }
        }
      } else {
        // Characters: pad right with spaces
        const clipped = safeByteClip(val, f.length, encoding === 'euc-kr' ? 'euc-kr' : 'utf-8');
        u8.fill(0x20, offset, offset + f.length);
        u8.set(clipped, offset);
      }
      offset += f.length;
    });
  });

  // EOF
  if (offset < totalLength) u8[offset] = 0x1A;

  return buffer;
}

/**
 * Generate Point Shapefile (.shp, .shx)
 */
function createPointShpAndShx(features: ShpFeaturePoint[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  features.forEach(f => {
    minX = Math.min(minX, f.x);
    minY = Math.min(minY, f.y);
    maxX = Math.max(maxX, f.x);
    maxY = Math.max(maxY, f.y);
  });
  if (features.length === 0) {
    minX = 0; minY = 0; maxX = 0; maxY = 0;
  }

  // Each point record: 8 bytes record header + 4 (shape type) + 16 (x, y) = 28 bytes
  const recordSize = 28;
  const shpLength = 100 + features.length * recordSize;
  const shxLength = 100 + features.length * 8;

  const shpBuf = new ArrayBuffer(shpLength);
  const shpView = new DataView(shpBuf);

  const shxBuf = new ArrayBuffer(shxLength);
  const shxView = new DataView(shxBuf);

  // Write headers
  const writeHeader = (view: DataView, fileLenBytes: number) => {
    view.setInt32(0, 9994, false); // File Code big-endian
    view.setInt32(24, fileLenBytes / 2, false); // File length in 16-bit words
    view.setInt32(28, 1000, true); // Version little-endian
    view.setInt32(32, 1, true); // Shape type: 1 = Point
    view.setFloat64(36, minX, true);
    view.setFloat64(44, minY, true);
    view.setFloat64(52, maxX, true);
    view.setFloat64(60, maxY, true);
  };

  writeHeader(shpView, shpLength);
  writeHeader(shxView, shxLength);

  let shpOffset = 100;
  let shxOffset = 100;

  features.forEach((f, idx) => {
    const recNum = idx + 1;
    const contentLenWords = 10; // (4 + 16) / 2

    // SHX record
    shxView.setInt32(shxOffset, shpOffset / 2, false);
    shxView.setInt32(shxOffset + 4, contentLenWords, false);
    shxOffset += 8;

    // SHP record header
    shpView.setInt32(shpOffset, recNum, false);
    shpView.setInt32(shpOffset + 4, contentLenWords, false);
    shpOffset += 8;

    // SHP record content
    shpView.setInt32(shpOffset, 1, true); // Point type
    shpView.setFloat64(shpOffset + 4, f.x, true);
    shpView.setFloat64(shpOffset + 12, f.y, true);
    shpOffset += 20;
  });

  return { shp: shpBuf, shx: shxBuf };
}

/**
 * Generate Polyline Shapefile (.shp, .shx)
 */
function createPolylineShpAndShx(features: ShpFeaturePolyline[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  features.forEach(f => {
    f.points.forEach(p => {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    });
  });
  if (features.length === 0 || minX === Infinity) {
    minX = 0; minY = 0; maxX = 0; maxY = 0;
  }

  // Calculate total shp size
  let shpLength = 100;
  features.forEach(f => {
    // 8 (header) + 4 (shape type) + 32 (box) + 4 (numParts) + 4 (numPoints) + 4 (parts[0]) + points*16
    shpLength += 8 + 48 + f.points.length * 16;
  });
  const shxLength = 100 + features.length * 8;

  const shpBuf = new ArrayBuffer(shpLength);
  const shpView = new DataView(shpBuf);
  const shxBuf = new ArrayBuffer(shxLength);
  const shxView = new DataView(shxBuf);

  const writeHeader = (view: DataView, fileLenBytes: number) => {
    view.setInt32(0, 9994, false);
    view.setInt32(24, fileLenBytes / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, 3, true); // Shape type: 3 = PolyLine
    view.setFloat64(36, minX, true);
    view.setFloat64(44, minY, true);
    view.setFloat64(52, maxX, true);
    view.setFloat64(60, maxY, true);
  };

  writeHeader(shpView, shpLength);
  writeHeader(shxView, shxLength);

  let shpOffset = 100;
  let shxOffset = 100;

  features.forEach((f, idx) => {
    const recNum = idx + 1;
    const contentLenBytes = 48 + f.points.length * 16;
    const contentLenWords = contentLenBytes / 2;

    // SHX record
    shxView.setInt32(shxOffset, shpOffset / 2, false);
    shxView.setInt32(shxOffset + 4, contentLenWords, false);
    shxOffset += 8;

    // SHP record header
    shpView.setInt32(shpOffset, recNum, false);
    shpView.setInt32(shpOffset + 4, contentLenWords, false);
    shpOffset += 8;

    // Feature Box
    let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity;
    f.points.forEach(p => {
      fMinX = Math.min(fMinX, p.x);
      fMinY = Math.min(fMinY, p.y);
      fMaxX = Math.max(fMaxX, p.x);
      fMaxY = Math.max(fMaxY, p.y);
    });

    shpView.setInt32(shpOffset, 3, true); // Polyline
    shpView.setFloat64(shpOffset + 4, fMinX, true);
    shpView.setFloat64(shpOffset + 12, fMinY, true);
    shpView.setFloat64(shpOffset + 20, fMaxX, true);
    shpView.setFloat64(shpOffset + 28, fMaxY, true);
    shpView.setInt32(shpOffset + 36, 1, true); // NumParts = 1
    shpView.setInt32(shpOffset + 40, f.points.length, true); // NumPoints
    shpView.setInt32(shpOffset + 44, 0, true); // parts[0] = 0

    let ptOffset = shpOffset + 48;
    f.points.forEach(p => {
      shpView.setFloat64(ptOffset, p.x, true);
      shpView.setFloat64(ptOffset + 8, p.y, true);
      ptOffset += 16;
    });

    shpOffset += contentLenBytes;
  });

  return { shp: shpBuf, shx: shxBuf };
}

export interface SHPExportBundleOptions {
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  layers: CADLayer[];
  encoding?: 'utf-8' | 'euc-kr';
}

/**
 * Export CAD data as complete ESRI Shapefile ZIP bundle with .shp, .shx, .dbf, and .prj
 */
export async function exportToShapefileZip(options: SHPExportBundleOptions): Promise<Blob> {
  const { points, lines, polylines, polygons, layers, encoding = 'euc-kr' } = options;
  const zip = new JSZip();

  // .cpg content
  const cpgContent = encoding === 'utf-8' ? 'UTF-8' : '949';

  const getLayerName = (id: string): string => {
    const l = layers.find(lay => lay.id === id);
    if (l) return l.name;
    if (id.startsWith('layer-')) return id.replace(/^layer-/, '');
    return id || '0';
  };

  // 1. Export Points layer if valid points exist
  const validPoints = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (validPoints.length > 0) {
    const standardPointKeysLower = new Set([
      'id', 'textstring', 'textheight', 'height', 'name', 'title',
      'layer', 'layerid', 'color', 'marker-color', 'stroke', 'stroke-width',
      'z', 'dxftype', 'issurveynode'
    ]);
    const customPtFieldRawKeysSet = new Set<string>();
    validPoints.forEach(p => {
      if (p.attributes) {
        Object.keys(p.attributes).forEach(k => {
          const trimmed = k.trim();
          if (trimmed && !standardPointKeysLower.has(trimmed.toLowerCase())) {
            customPtFieldRawKeysSet.add(trimmed);
          }
        });
      }
    });
    const customPtRawKeys = Array.from(customPtFieldRawKeysSet).slice(0, 15);

    const usedPtFieldNames = new Set<string>(['ID', 'TEXTSTRING', 'TEXTHEIGHT', 'LAYER', 'Z']);
    const customPtKeyMappings = customPtRawKeys.map(rawKey => ({
      rawKey,
      dbfName: makeUniqueDbfFieldName(rawKey, usedPtFieldNames, encoding)
    }));

    const ptFeatures: ShpFeaturePoint[] = validPoints.map((p, idx) => {
      const a = p.attributes || {};
      const textStringVal = String(
        a.TEXTSTRING ?? a.textstring ?? a.TEXT ?? a.text ?? a.STRING ?? a.string ?? p.name ?? ''
      ).trim();
      const rawH = Number(a.TEXTHEIGHT ?? a.textheight ?? a.HEIGHT ?? a.height);
      const textHeightVal = Number.isFinite(rawH) && rawH > 0 ? rawH : 1;

      const props: Record<string, string | number> = {
        ID: idx + 1,
        TEXTSTRING: textStringVal || p.name || `측점_${idx + 1}`,
        TEXTHEIGHT: textHeightVal,
        LAYER: getLayerName(p.layerId),
        Z: p.z !== undefined && Number.isFinite(p.z) ? p.z : 0
      };

      customPtKeyMappings.forEach(({ rawKey, dbfName }) => {
        const val = a[rawKey];
        props[dbfName] = val !== undefined && val !== null ? val : '';
      });

      return {
        x: p.x,
        y: p.y,
        properties: props
      };
    });

    const dbfFields: { name: string; type: 'C' | 'N'; length: number; decimals: number }[] = [
      { name: 'ID', type: 'N', length: 10, decimals: 0 },
      { name: 'TEXTSTRING', type: 'C', length: 254, decimals: 0 },
      { name: 'TEXTHEIGHT', type: 'N', length: 8, decimals: 2 },
      { name: 'LAYER', type: 'C', length: 254, decimals: 0 },
      { name: 'Z', type: 'N', length: 12, decimals: 3 }
    ];

    customPtKeyMappings.forEach(({ dbfName }) => {
      dbfFields.push({ name: dbfName, type: 'C', length: 254, decimals: 0 });
    });

    const { shp, shx } = createPointShpAndShx(ptFeatures);
    const dbf = createDbfBuffer(dbfFields, ptFeatures.map(f => f.properties), encoding);

    zip.file('cad_points.shp', shp);
    zip.file('cad_points.shx', shx);
    zip.file('cad_points.dbf', dbf);
    zip.file('cad_points.cpg', cpgContent);
  }

  // Combine single lines and polylines into polyline features with Object Data (OD)
  // Collect all unique custom attribute keys across all lines (case-insensitive exclusion of standard keys)
  const standardLineKeysLower = new Set([
    'id', 'name', 'title', 'layer', 'layerid', 'color', 'marker-color', 'stroke', 'stroke-width',
    'dxftype', 'isclosed', 'length_m', 'category', 'spec', 'material',
    'depth', 'surv_date', 'surveyor', 'status', 'remark', 'type',
    '시설구분', '규격', '재질', '매설심도', '조사일자', '조사자', '상태', '비고'
  ]);

  const customFieldRawKeysSet = new Set<string>();
  const collectCustomKeys = (attrs?: Record<string, string | number>) => {
    if (!attrs) return;
    Object.keys(attrs).forEach(k => {
      const trimmed = k.trim();
      if (trimmed && !standardLineKeysLower.has(trimmed.toLowerCase())) {
        customFieldRawKeysSet.add(trimmed);
      }
    });
  };

  lines.forEach(l => collectCustomKeys(l.attributes));
  polylines.forEach(pl => collectCustomKeys(pl.attributes));
  polygons.forEach(pg => collectCustomKeys(pg.attributes));

  const customLineRawKeys = Array.from(customFieldRawKeysSet).slice(0, 15);
  const usedLineFieldNames = new Set<string>([
    'ID', 'NAME', 'LAYER', 'LENGTH_M', 'CATEGORY', 'SPEC', 'MATERIAL',
    'DEPTH', 'SURV_DATE', 'SURVEYOR', 'STATUS', 'REMARK', 'TYPE'
  ]);
  const customLineKeyMappings = customLineRawKeys.map(rawKey => ({
    rawKey,
    dbfName: makeUniqueDbfFieldName(rawKey, usedLineFieldNames, encoding)
  }));

  const lineFeatures: ShpFeaturePolyline[] = [];

  lines.forEach((l, idx) => {
    if (
      !Number.isFinite(l.start?.x) || !Number.isFinite(l.start?.y) ||
      !Number.isFinite(l.end?.x) || !Number.isFinite(l.end?.y)
    ) {
      return;
    }
    const len = Math.sqrt(Math.pow(l.end.x - l.start.x, 2) + Math.pow(l.end.y - l.start.y, 2));
    const a = l.attributes || {};
    const props: Record<string, string | number> = {
      ID: lineFeatures.length + 1,
      NAME: l.name || `단일선_${idx + 1}`,
      LAYER: getLayerName(l.layerId),
      LENGTH_M: Number(len.toFixed(3)),
      CATEGORY: (a.CATEGORY || a.시설구분 || '').toString(),
      SPEC: (a.SPEC || a.규격 || '').toString(),
      MATERIAL: (a.MATERIAL || a.재질 || '').toString(),
      DEPTH: a.DEPTH !== undefined ? a.DEPTH : (a.매설심도 !== undefined ? a.매설심도 : 0),
      SURV_DATE: (a.SURV_DATE || a.조사일자 || '').toString(),
      SURVEYOR: (a.SURVEYOR || a.조사자 || '').toString(),
      STATUS: (a.STATUS || a.상태 || '').toString(),
      REMARK: (a.REMARK || a.비고 || '').toString(),
      TYPE: 'LINE'
    };
    customLineKeyMappings.forEach(({ rawKey, dbfName }) => {
      const val = a[rawKey];
      props[dbfName] = val !== undefined && val !== null ? val : '';
    });
    lineFeatures.push({
      points: [l.start, l.end],
      properties: props
    });
  });

  polylines.forEach((pl, idx) => {
    const cleanPts = (pl.points || []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
    if (cleanPts.length < 2) return;
    const exportPts = [...cleanPts];
    if (pl.isClosed && exportPts.length >= 2) {
      const first = exportPts[0];
      const last = exportPts[exportPts.length - 1];
      if (first.x !== last.x || first.y !== last.y) {
        exportPts.push({ ...first });
      }
    }
    let len = 0;
    for (let i = 0; i < exportPts.length - 1; i++) {
      len += Math.sqrt(Math.pow(exportPts[i + 1].x - exportPts[i].x, 2) + Math.pow(exportPts[i + 1].y - exportPts[i].y, 2));
    }
    const a = pl.attributes || {};
    const props: Record<string, string | number> = {
      ID: lineFeatures.length + 1,
      NAME: pl.name || `연속선_${idx + 1}`,
      LAYER: getLayerName(pl.layerId),
      LENGTH_M: Number(len.toFixed(3)),
      CATEGORY: (a.CATEGORY || a.시설구분 || '').toString(),
      SPEC: (a.SPEC || a.규격 || '').toString(),
      MATERIAL: (a.MATERIAL || a.재질 || '').toString(),
      DEPTH: a.DEPTH !== undefined ? a.DEPTH : (a.매설심도 !== undefined ? a.매설심도 : 0),
      SURV_DATE: (a.SURV_DATE || a.조사일자 || '').toString(),
      SURVEYOR: (a.SURVEYOR || a.조사자 || '').toString(),
      STATUS: (a.STATUS || a.상태 || '').toString(),
      REMARK: (a.REMARK || a.비고 || '').toString(),
      TYPE: 'POLYLINE'
    };
    customLineKeyMappings.forEach(({ rawKey, dbfName }) => {
      const val = a[rawKey];
      props[dbfName] = val !== undefined && val !== null ? val : '';
    });
    lineFeatures.push({
      points: exportPts,
      properties: props
    });
  });

  // 폴리곤 객체가 남아있는 경우에도 외곽선 기준 닫힌 선(PolyLine)으로 변환하여 내보내기
  polygons.forEach((pg, idx) => {
    const cleanPts = (pg.points || []).filter(p => Number.isFinite(p?.x) && Number.isFinite(p?.y));
    if (cleanPts.length < 2) return;
    const exportPts = [...cleanPts];
    const first = exportPts[0];
    const last = exportPts[exportPts.length - 1];
    if (first.x !== last.x || first.y !== last.y) {
      exportPts.push({ ...first });
    }
    let len = 0;
    for (let i = 0; i < exportPts.length - 1; i++) {
      len += Math.sqrt(Math.pow(exportPts[i + 1].x - exportPts[i].x, 2) + Math.pow(exportPts[i + 1].y - exportPts[i].y, 2));
    }
    const a = pg.attributes || {};
    const props: Record<string, string | number> = {
      ID: lineFeatures.length + 1,
      NAME: pg.name || `외곽선_${idx + 1}`,
      LAYER: getLayerName(pg.layerId),
      LENGTH_M: Number(len.toFixed(3)),
      CATEGORY: (a.CATEGORY || a.시설구분 || '').toString(),
      SPEC: (a.SPEC || a.규격 || '').toString(),
      MATERIAL: (a.MATERIAL || a.재질 || '').toString(),
      DEPTH: a.DEPTH !== undefined ? a.DEPTH : (a.매설심도 !== undefined ? a.매설심도 : 0),
      SURV_DATE: (a.SURV_DATE || a.조사일자 || '').toString(),
      SURVEYOR: (a.SURVEYOR || a.조사자 || '').toString(),
      STATUS: (a.STATUS || a.상태 || '').toString(),
      REMARK: (a.REMARK || a.비고 || '').toString(),
      TYPE: 'POLYLINE'
    };
    customLineKeyMappings.forEach(({ rawKey, dbfName }) => {
      const val = a[rawKey];
      props[dbfName] = val !== undefined && val !== null ? val : '';
    });
    lineFeatures.push({
      points: exportPts,
      properties: props
    });
  });

  if (lineFeatures.length > 0) {
    const { shp, shx } = createPolylineShpAndShx(lineFeatures);

    const dbfFields: { name: string; type: 'C' | 'N'; length: number; decimals: number }[] = [
      { name: 'ID', type: 'N', length: 10, decimals: 0 },
      { name: 'NAME', type: 'C', length: 254, decimals: 0 },
      { name: 'LAYER', type: 'C', length: 254, decimals: 0 },
      { name: 'LENGTH_M', type: 'N', length: 12, decimals: 3 },
      { name: 'CATEGORY', type: 'C', length: 254, decimals: 0 },
      { name: 'SPEC', type: 'C', length: 254, decimals: 0 },
      { name: 'MATERIAL', type: 'C', length: 254, decimals: 0 },
      { name: 'DEPTH', type: 'N', length: 10, decimals: 3 },
      { name: 'SURV_DATE', type: 'C', length: 254, decimals: 0 },
      { name: 'SURVEYOR', type: 'C', length: 254, decimals: 0 },
      { name: 'STATUS', type: 'C', length: 254, decimals: 0 },
      { name: 'REMARK', type: 'C', length: 254, decimals: 0 },
      { name: 'TYPE', type: 'C', length: 254, decimals: 0 }
    ];

    customLineKeyMappings.forEach(({ dbfName }) => {
      dbfFields.push({
        name: dbfName,
        type: 'C',
        length: 254,
        decimals: 0
      });
    });

    const dbf = createDbfBuffer(
      dbfFields,
      lineFeatures.map(f => f.properties),
      encoding
    );

    zip.file('cad_lines.shp', shp);
    zip.file('cad_lines.shx', shx);
    zip.file('cad_lines.dbf', dbf);
    zip.file('cad_lines.cpg', cpgContent);
  }

  // Generate and return zip blob (모든 선 및 외곽선은 cad_lines.shp로 통합 출력됨)

  // Generate and return zip blob
  return await zip.generateAsync({ type: 'blob' });
}

export { downloadBlob, downloadTextFile } from './downloadHelper';
