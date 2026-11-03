/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import JSZip from 'jszip';
import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, Point2D } from '../types/cad';

export interface SHPParseResult {
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  layers: CADLayer[];
  layerName: string;
  bounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
}

const LAYER_COLORS = ['#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', '#60a5fa', '#f97316'];

/**
 * Parse raw ESRI .shp binary buffer
 */
export function parseShpBuffer(buffer: ArrayBuffer, filename: string = 'shapefile'): SHPParseResult {
  const view = new DataView(buffer);
  if (buffer.byteLength < 100) {
    throw new Error('유효한 ESRI Shapefile 헤더 크기보다 작습니다.');
  }

  const fileCode = view.getInt32(0, false);
  if (fileCode !== 9994) {
    throw new Error('유효한 ESRI Shapefile (.shp) 파일이 아닙니다.');
  }

  const fileLengthBytes = view.getInt32(24, false) * 2;
  const cleanName = filename.replace(/\.[^/.]+$/, '').trim() || 'shapefile';
  const layerId = `layer-${cleanName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  const minXHeader = view.getFloat64(36, true);
  const minYHeader = view.getFloat64(44, true);
  const maxXHeader = view.getFloat64(52, true);
  const maxYHeader = view.getFloat64(60, true);

  const points: CADPoint[] = [];
  const lines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];

  let offset = 100;
  let recordIndex = 1;

  while (offset < Math.min(fileLengthBytes, buffer.byteLength) - 8) {
    const contentLenBytes = view.getInt32(offset + 4, false) * 2;
    const recShapeType = view.getInt32(offset + 8, true);

    if (recShapeType === 0) {
      // Null shape
      offset += 8 + contentLenBytes;
      recordIndex++;
      continue;
    }

    if (recShapeType === 1) {
      // Point (shape type 1)
      const x = view.getFloat64(offset + 12, true);
      const y = view.getFloat64(offset + 20, true);
      points.push({
        id: `shp-pt-${Date.now()}-${recordIndex}`,
        name: `${cleanName}_${recordIndex}`,
        x,
        y,
        layerId,
        isSurveyNode: true
      });
    } else if (recShapeType === 3) {
      // PolyLine (shape type 3)
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
          name: `${cleanName}_선_${recordIndex}`
        });
      }
    } else if (recShapeType === 5) {
      // Polygon (shape type 5)
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
          name: `${cleanName}_구역_${recordIndex}`,
          fillOpacity: 0.15
        });
      }
    }

    offset += 8 + contentLenBytes;
    recordIndex++;
  }

  const defaultLayer: CADLayer = {
    id: layerId,
    name: cleanName,
    color: LAYER_COLORS[Math.floor(Math.random() * LAYER_COLORS.length)],
    visible: true,
    locked: false,
    lineWidth: 2
  };

  return {
    points,
    lines,
    polylines,
    polygons,
    layers: [defaultLayer],
    layerName: cleanName,
    bounds: {
      minX: minXHeader,
      minY: minYHeader,
      maxX: maxXHeader,
      maxY: maxYHeader
    }
  };
}

/**
 * Parse Shapefile from .zip archive (extracting and parsing all .shp files inside)
 */
export async function parseShapefileZip(zipBuffer: ArrayBuffer): Promise<SHPParseResult> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const shpEntries = Object.values(zip.files).filter(
    f => !f.dir && f.name.toLowerCase().endsWith('.shp') && !f.name.startsWith('__MACOSX')
  );

  if (shpEntries.length === 0) {
    throw new Error('ZIP 압축 파일 내에 .shp 파일을 찾을 수 없습니다.');
  }

  const combinedPoints: CADPoint[] = [];
  const combinedLines: CADLine[] = [];
  const combinedPolylines: CADPolyline[] = [];
  const combinedPolygons: CADPolygon[] = [];
  const combinedLayers: CADLayer[] = [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (let i = 0; i < shpEntries.length; i++) {
    const entry = shpEntries[i];
    const shpBuffer = await entry.async('arraybuffer');
    const result = parseShpBuffer(shpBuffer, entry.name.split('/').pop() || entry.name);

    // Color distinct layers
    if (result.layers.length > 0) {
      result.layers[0].color = LAYER_COLORS[i % LAYER_COLORS.length];
      combinedLayers.push(...result.layers);
    }

    combinedPoints.push(...result.points);
    combinedLines.push(...result.lines);
    combinedPolylines.push(...result.polylines);
    combinedPolygons.push(...result.polygons);

    if (result.bounds) {
      minX = Math.min(minX, result.bounds.minX);
      minY = Math.min(minY, result.bounds.minY);
      maxX = Math.max(maxX, result.bounds.maxX);
      maxY = Math.max(maxY, result.bounds.maxY);
    }
  }

  return {
    points: combinedPoints,
    lines: combinedLines,
    polylines: combinedPolylines,
    polygons: combinedPolygons,
    layers: combinedLayers,
    layerName: shpEntries.length === 1 ? shpEntries[0].name.replace(/\.[^/.]+$/, '') : 'SHP 압축도면',
    bounds: minX !== Infinity ? { minX, minY, maxX, maxY } : undefined
  };
}
