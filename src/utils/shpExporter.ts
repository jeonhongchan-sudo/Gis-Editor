/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import { CADLine, CADPoint, CADPolygon, CADPolyline, Point2D } from '../types/cad';
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

interface ShpFeaturePolygon {
  points: Point2D[];
  properties: Record<string, string | number>;
}

import { encodeText, safeByteClip } from './encoding';

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
      const val = rec[f.name] !== undefined ? String(rec[f.name]) : '';
      
      // Encode and clip string based on target encoding to prevent broken multibyte sequences
      const clipped = safeByteClip(val, f.length, encoding === 'euc-kr' ? 'euc-kr' : 'utf-8');
      
      if (f.type === 'N') {
        // Numbers: pad left with spaces
        const str = val.padStart(f.length, ' ').slice(0, f.length);
        for (let i = 0; i < f.length; i++) {
          u8[offset + i] = str.charCodeAt(i);
        }
      } else {
        // Characters: pad right with spaces
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

/**
 * Generate Polygon Shapefile (.shp, .shx)
 */
function createPolygonShpAndShx(features: ShpFeaturePolygon[]) {
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

  // Ensure closed loops (last point == first point)
  const preparedFeatures = features.map(f => {
    const pts = [...f.points];
    if (pts.length > 0) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (first.x !== last.x || first.y !== last.y) {
        pts.push({ ...first });
      }
    }
    return { ...f, points: pts };
  });

  let shpLength = 100;
  preparedFeatures.forEach(f => {
    shpLength += 8 + 48 + f.points.length * 16;
  });
  const shxLength = 100 + preparedFeatures.length * 8;

  const shpBuf = new ArrayBuffer(shpLength);
  const shpView = new DataView(shpBuf);
  const shxBuf = new ArrayBuffer(shxLength);
  const shxView = new DataView(shxBuf);

  const writeHeader = (view: DataView, fileLenBytes: number) => {
    view.setInt32(0, 9994, false);
    view.setInt32(24, fileLenBytes / 2, false);
    view.setInt32(28, 1000, true);
    view.setInt32(32, 5, true); // Shape type: 5 = Polygon
    view.setFloat64(36, minX, true);
    view.setFloat64(44, minY, true);
    view.setFloat64(52, maxX, true);
    view.setFloat64(60, maxY, true);
  };

  writeHeader(shpView, shpLength);
  writeHeader(shxView, shxLength);

  let shpOffset = 100;
  let shxOffset = 100;

  preparedFeatures.forEach((f, idx) => {
    const recNum = idx + 1;
    const contentLenBytes = 48 + f.points.length * 16;
    const contentLenWords = contentLenBytes / 2;

    shxView.setInt32(shxOffset, shpOffset / 2, false);
    shxView.setInt32(shxOffset + 4, contentLenWords, false);
    shxOffset += 8;

    shpView.setInt32(shpOffset, recNum, false);
    shpView.setInt32(shpOffset + 4, contentLenWords, false);
    shpOffset += 8;

    let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity;
    f.points.forEach(p => {
      fMinX = Math.min(fMinX, p.x);
      fMinY = Math.min(fMinY, p.y);
      fMaxX = Math.max(fMaxX, p.x);
      fMaxY = Math.max(fMaxY, p.y);
    });

    shpView.setInt32(shpOffset, 5, true); // Polygon
    shpView.setFloat64(shpOffset + 4, fMinX, true);
    shpView.setFloat64(shpOffset + 12, fMinY, true);
    shpView.setFloat64(shpOffset + 20, fMaxX, true);
    shpView.setFloat64(shpOffset + 28, fMaxY, true);
    shpView.setInt32(shpOffset + 36, 1, true); // NumParts = 1
    shpView.setInt32(shpOffset + 40, f.points.length, true);
    shpView.setInt32(shpOffset + 44, 0, true);

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
  crs: string;
  encoding?: 'utf-8' | 'euc-kr';
}

/**
 * Export CAD data as complete ESRI Shapefile ZIP bundle with .shp, .shx, .dbf, and .prj
 */
export async function exportToShapefileZip(options: SHPExportBundleOptions): Promise<Blob> {
  const { points, lines, polylines, polygons, crs, encoding = 'euc-kr' } = options;
  const zip = new JSZip();

  const prjContent = COORDINATE_SYSTEMS[crs]?.wktPrj || COORDINATE_SYSTEMS['EPSG:5186'].wktPrj;
  
  // .cpg content
  const cpgContent = encoding === 'utf-8' ? 'UTF-8' : '949';

  // 1. Export Points layer if points exist
  if (points.length > 0) {
    const ptFeatures: ShpFeaturePoint[] = points.map((p, idx) => ({
      x: p.x,
      y: p.y,
      properties: {
        ID: idx + 1,
        NAME: p.name.slice(0, 20),
        LAYER: p.layerId.replace(/^layer-/, '').slice(0, 15),
        Z: p.z !== undefined ? p.z.toFixed(3) : 0
      }
    }));

    const { shp, shx } = createPointShpAndShx(ptFeatures);
    const dbf = createDbfBuffer(
      [
        { name: 'ID', type: 'N', length: 10, decimals: 0 },
        { name: 'NAME', type: 'C', length: 20, decimals: 0 },
        { name: 'LAYER', type: 'C', length: 15, decimals: 0 },
        { name: 'Z', type: 'N', length: 10, decimals: 3 }
      ],
      ptFeatures.map(f => f.properties),
      encoding
    );

    zip.file('points_layer_0.shp', shp);
    zip.file('points_layer_0.shx', shx);
    zip.file('points_layer_0.dbf', dbf);
    zip.file('points_layer_0.prj', prjContent);
    zip.file('points_layer_0.cpg', cpgContent);
  }

  // Combine single lines and polylines into polyline features with Object Data (OD)
  // Collect all unique custom attribute keys across all lines
  const standardODKeys = new Set([
    'ID', 'NAME', 'LAYER', 'LENGTH_M', 'CATEGORY', 'SPEC', 'MATERIAL',
    'DEPTH', 'SURV_DATE', 'SURVEYOR', 'STATUS', 'REMARK', 'TYPE',
    '시설구분', '규격', '재질', '매설심도', '조사일자', '조사자', '상태', '비고'
  ]);

  const customFieldKeysSet = new Set<string>();
  const collectCustomKeys = (attrs?: Record<string, string | number>) => {
    if (!attrs) return;
    Object.keys(attrs).forEach(k => {
      if (!standardODKeys.has(k) && k.trim()) {
        customFieldKeysSet.add(k.trim());
      }
    });
  };

  lines.forEach(l => collectCustomKeys(l.attributes));
  polylines.forEach(pl => collectCustomKeys(pl.attributes));

  // Limit custom keys to prevent DBF header overflow, max 10 custom keys
  const customFieldKeys = Array.from(customFieldKeysSet).slice(0, 15);

  const lineFeatures: ShpFeaturePolyline[] = [];

  lines.forEach((l, idx) => {
    const len = Math.sqrt(Math.pow(l.end.x - l.start.x, 2) + Math.pow(l.end.y - l.start.y, 2));
    const a = l.attributes || {};
    const props: Record<string, string | number> = {
      ID: idx + 1,
      NAME: (l.name || `단일선_${idx + 1}`).slice(0, 30),
      LAYER: l.layerId.replace(/^layer-/, '').slice(0, 15),
      LENGTH_M: len.toFixed(3),
      CATEGORY: (a.CATEGORY || a.시설구분 || '').toString().slice(0, 25),
      SPEC: (a.SPEC || a.규격 || '').toString().slice(0, 25),
      MATERIAL: (a.MATERIAL || a.재질 || '').toString().slice(0, 20),
      DEPTH: a.DEPTH !== undefined ? a.DEPTH : (a.매설심도 !== undefined ? a.매설심도 : 0),
      SURV_DATE: (a.SURV_DATE || a.조사일자 || '').toString().slice(0, 12),
      SURVEYOR: (a.SURVEYOR || a.조사자 || '').toString().slice(0, 20),
      STATUS: (a.STATUS || a.상태 || '').toString().slice(0, 15),
      REMARK: (a.REMARK || a.비고 || '').toString().slice(0, 40),
      TYPE: 'LINE'
    };
    customFieldKeys.forEach(k => {
      props[k] = a[k] !== undefined ? a[k] : '';
    });
    lineFeatures.push({
      points: [l.start, l.end],
      properties: props
    });
  });

  polylines.forEach((pl, idx) => {
    let len = 0;
    for (let i = 0; i < pl.points.length - 1; i++) {
      len += Math.sqrt(Math.pow(pl.points[i + 1].x - pl.points[i].x, 2) + Math.pow(pl.points[i + 1].y - pl.points[i].y, 2));
    }
    const a = pl.attributes || {};
    const props: Record<string, string | number> = {
      ID: lines.length + idx + 1,
      NAME: (pl.name || `연속선_${idx + 1}`).slice(0, 30),
      LAYER: pl.layerId.replace(/^layer-/, '').slice(0, 15),
      LENGTH_M: len.toFixed(3),
      CATEGORY: (a.CATEGORY || a.시설구분 || '').toString().slice(0, 25),
      SPEC: (a.SPEC || a.규격 || '').toString().slice(0, 25),
      MATERIAL: (a.MATERIAL || a.재질 || '').toString().slice(0, 20),
      DEPTH: a.DEPTH !== undefined ? a.DEPTH : (a.매설심도 !== undefined ? a.매설심도 : 0),
      SURV_DATE: (a.SURV_DATE || a.조사일자 || '').toString().slice(0, 12),
      SURVEYOR: (a.SURVEYOR || a.조사자 || '').toString().slice(0, 20),
      STATUS: (a.STATUS || a.상태 || '').toString().slice(0, 15),
      REMARK: (a.REMARK || a.비고 || '').toString().slice(0, 40),
      TYPE: 'POLYLINE'
    };
    customFieldKeys.forEach(k => {
      props[k] = a[k] !== undefined ? a[k] : '';
    });
    lineFeatures.push({
      points: pl.points,
      properties: props
    });
  });

  if (lineFeatures.length > 0) {
    const { shp, shx } = createPolylineShpAndShx(lineFeatures);

    const dbfFields: { name: string; type: 'C' | 'N'; length: number; decimals: number }[] = [
      { name: 'ID', type: 'N', length: 10, decimals: 0 },
      { name: 'NAME', type: 'C', length: 30, decimals: 0 },
      { name: 'LAYER', type: 'C', length: 15, decimals: 0 },
      { name: 'LENGTH_M', type: 'N', length: 12, decimals: 3 },
      { name: 'CATEGORY', type: 'C', length: 25, decimals: 0 },
      { name: 'SPEC', type: 'C', length: 25, decimals: 0 },
      { name: 'MATERIAL', type: 'C', length: 20, decimals: 0 },
      { name: 'DEPTH', type: 'N', length: 10, decimals: 3 },
      { name: 'SURV_DATE', type: 'C', length: 12, decimals: 0 },
      { name: 'SURVEYOR', type: 'C', length: 20, decimals: 0 },
      { name: 'STATUS', type: 'C', length: 15, decimals: 0 },
      { name: 'REMARK', type: 'C', length: 40, decimals: 0 },
      { name: 'TYPE', type: 'C', length: 10, decimals: 0 }
    ];

    customFieldKeys.forEach(k => {
      dbfFields.push({
        name: k.slice(0, 10),
        type: 'C',
        length: 30,
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
    zip.file('cad_lines.prj', prjContent);
    zip.file('cad_lines.cpg', cpgContent);
  }

  // 3. Export Polygons if any
  if (polygons.length > 0) {
    const polyFeatures: ShpFeaturePolygon[] = polygons.map((poly, idx) => {
      let area = 0;
      for (let i = 0; i < poly.points.length; i++) {
        const j = (i + 1) % poly.points.length;
        area += poly.points[i].x * poly.points[j].y;
        area -= poly.points[j].x * poly.points[i].y;
      }
      area = Math.abs(area) / 2.0;

      return {
        points: poly.points,
        properties: {
          ID: idx + 1,
          LAYER: poly.layerId.replace(/^layer-/, '').slice(0, 15),
          AREA_M2: area.toFixed(3),
          AREA_PY: (area / 3.305785).toFixed(3)
        }
      };
    });

    const { shp, shx } = createPolygonShpAndShx(polyFeatures);
    const dbf = createDbfBuffer(
      [
        { name: 'ID', type: 'N', length: 10, decimals: 0 },
        { name: 'LAYER', type: 'C', length: 15, decimals: 0 },
        { name: 'AREA_M2', type: 'N', length: 14, decimals: 3 },
        { name: 'AREA_PY', type: 'N', length: 12, decimals: 3 }
      ],
      polyFeatures.map(f => f.properties),
      encoding
    );

    zip.file('cad_polygons.shp', shp);
    zip.file('cad_polygons.shx', shx);
    zip.file('cad_polygons.dbf', dbf);
    zip.file('cad_polygons.prj', prjContent);
    zip.file('cad_polygons.cpg', cpgContent);
  }

  // Generate and return zip blob
  return await zip.generateAsync({ type: 'blob' });
}

export { downloadBlob, downloadTextFile } from './downloadHelper';
