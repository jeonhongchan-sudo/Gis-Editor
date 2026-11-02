/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import { CADLine, CADPoint, CADPolygon, CADPolyline, Point2D } from '../types/cad';

export interface SHPParseResult {
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  layerName: string;
}

/**
 * Parse raw ESRI .shp binary buffer
 */
export function parseShpBuffer(buffer: ArrayBuffer, filename: string = 'shapefile'): SHPParseResult {
  const view = new DataView(buffer);
  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) {
    throw new Error('유효한 ESRI Shapefile (.shp) 파일이 아닙니다.');
  }

  const shapeType = view.getInt32(32, true); // 1 = Point, 3 = PolyLine, 5 = Polygon
  const fileLengthBytes = view.getInt32(24, false) * 2;

  const points: CADPoint[] = [];
  const lines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];

  const layerId = `layer-${filename.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  let offset = 100;
  let recordIndex = 1;

  while (offset < Math.min(fileLengthBytes, buffer.byteLength) - 8) {
    const recNum = view.getInt32(offset, false);
    const contentLenBytes = view.getInt32(offset + 4, false) * 2;
    const recShapeType = view.getInt32(offset + 8, true);

    if (recShapeType === 0) {
      // Null shape
      offset += 8 + contentLenBytes;
      recordIndex++;
      continue;
    }

    if (recShapeType === 1) {
      // Point
      const x = view.getFloat64(offset + 12, true);
      const y = view.getFloat64(offset + 20, true);
      points.push({
        id: `shp-pt-${Date.now()}-${recordIndex}`,
        name: `SHP_${recordIndex}`,
        x,
        y,
        layerId,
        isSurveyNode: true
      });
    } else if (recShapeType === 3) {
      // PolyLine
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
        polylines.push({
          id: `shp-pl-${Date.now()}-${recordIndex}`,
          points: polyPoints,
          isClosed: false,
          layerId,
          name: `선_${recordIndex}`
        });
      }
    } else if (recShapeType === 5) {
      // Polygon
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
        polygons.push({
          id: `shp-pg-${Date.now()}-${recordIndex}`,
          points: polyPoints,
          layerId,
          name: `구역_${recordIndex}`,
          fillOpacity: 0.15
        });
      }
    }

    offset += 8 + contentLenBytes;
    recordIndex++;
  }

  return {
    points,
    lines,
    polylines,
    polygons,
    layerName: filename.replace(/\.[^/.]+$/, '')
  };
}

/**
 * Parse Shapefile from .zip archive (containing .shp)
 */
export async function parseShapefileZip(zipBuffer: ArrayBuffer): Promise<SHPParseResult> {
  const zip = await JSZip.loadAsync(zipBuffer);
  let shpFile = Object.values(zip.files).find(f => f.name.toLowerCase().endsWith('.shp'));

  if (!shpFile) {
    throw new Error('ZIP 압축 파일 내에 .shp 파일을 찾을 수 없습니다.');
  }

  const shpBuffer = await shpFile.async('arraybuffer');
  return parseShpBuffer(shpBuffer, shpFile.name);
}
