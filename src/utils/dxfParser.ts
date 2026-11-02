/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText, Point2D } from '../types/cad';

// AutoCAD Color Index (ACI) to Hex mapping for common colors
const ACI_COLORS: Record<number, string> = {
  1: '#ef4444', // Red
  2: '#eab308', // Yellow
  3: '#22c55e', // Green
  4: '#06b6d4', // Cyan
  5: '#3b82f6', // Blue
  6: '#ec4899', // Magenta
  7: '#ffffff', // White / Black
  8: '#64748b', // Dark Gray
  9: '#94a3b8', // Light Gray
};

export interface DXFParseResult {
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
}

/**
 * Cleans AutoCAD text, decoding escape codes, unicode escapes, and stripping MTEXT formatting
 */
export function cleanDxfText(raw: string): string {
  if (!raw) return '';
  let str = raw;

  // AutoCAD special symbols: %%d (deg), %%p (plus/minus), %%c (diameter)
  str = str.replace(/%%d/gi, '°');
  str = str.replace(/%%p/gi, '±');
  str = str.replace(/%%c/gi, '∅');
  str = str.replace(/%%u/gi, '');
  str = str.replace(/%%o/gi, '');

  // Convert AutoCAD \U+XXXX unicode escapes (e.g. \U+AC00 -> '가')
  str = str.replace(/\\U\+([0-9A-Fa-f]{4})/gi, (_, hex) => {
    try {
      return String.fromCharCode(parseInt(hex, 16));
    } catch {
      return '';
    }
  });

  // Convert \M+1XXXX escapes
  str = str.replace(/\\M\+[0-9A-Fa-f]{5}/gi, '');

  // Convert \P and ^J to newline
  str = str.replace(/\\P/gi, '\n');
  str = str.replace(/\^J/gi, '\n');

  // Strip AutoCAD MTEXT formatting tags:
  // e.g. \A1;, \fGulim|b0|i0|c129|p34;, \H1.5x;, \C1;, \W0.8;, \Q15;, \S...^...;
  str = str.replace(/\\[A-Za-z][^;]*;/g, '');

  // Remove curly braces used for grouping in MTEXT: { ... }
  str = str.replace(/[{}]/g, '');

  // Remove \~ (AutoCAD non-breaking space)
  str = str.replace(/\\~/g, ' ');

  return str.trim();
}

/**
 * High-performance, streaming-style DXF Parser.
 * Avoids huge split() memory overhead and supports progress reporting.
 */
export async function parseDXFAsync(
  dxfText: string,
  onProgress?: (percent: number) => void
): Promise<DXFParseResult> {
  const layersMap = new Map<string, CADLayer>();
  const points: CADPoint[] = [];
  const cadLines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];
  const texts: CADText[] = [];

  const textLen = dxfText.length;
  let cursor = 0;

  // Read next line without allocating entire file into memory array
  const readNextLine = (): string | null => {
    if (cursor >= textLen) return null;
    let nextNewline = dxfText.indexOf('\n', cursor);
    if (nextNewline === -1) {
      nextNewline = textLen;
    }
    let line = dxfText.slice(cursor, nextNewline);
    cursor = nextNewline + 1;
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }
    return line.trim();
  };

  const nextPair = (): { code: number; value: string } | null => {
    while (cursor < textLen) {
      const codeStr = readNextLine();
      if (codeStr === null || codeStr === '') continue;
      const code = parseInt(codeStr, 10);
      if (isNaN(code)) continue;
      const valStr = readNextLine();
      return { code, value: valStr !== null ? valStr : '' };
    }
    return null;
  };

  let inEntitiesSection = false;
  let inTablesSection = false;

  let pair = nextPair();
  let iter = 0;
  const yieldInterval = 12000; // Yield to browser every 12,000 pairs

  while (pair) {
    iter++;
    if (iter % yieldInterval === 0) {
      if (onProgress) {
        onProgress(Math.min(99, Math.round((cursor / textLen) * 100)));
      }
      // Non-blocking yield to allow browser UI repaint
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    if (pair.code === 0 && pair.value === 'SECTION') {
      pair = nextPair();
      if (pair && pair.code === 2) {
        if (pair.value === 'ENTITIES') {
          inEntitiesSection = true;
          inTablesSection = false;
        } else if (pair.value === 'TABLES') {
          inTablesSection = true;
          inEntitiesSection = false;
        } else {
          inEntitiesSection = false;
          inTablesSection = false;
        }
      }
    } else if (pair.code === 0 && pair.value === 'ENDSEC') {
      inEntitiesSection = false;
      inTablesSection = false;
    } else if (inTablesSection && pair.code === 0 && pair.value === 'LAYER') {
      let layerName = '0';
      let layerColor = '#3b82f6';
      while ((pair = nextPair()) && pair.code !== 0) {
        if (pair.code === 2) {
          layerName = cleanDxfText(pair.value) || '0';
        } else if (pair.code === 62) {
          const colorCode = Math.abs(parseInt(pair.value, 10));
          layerColor = ACI_COLORS[colorCode] || '#38bdf8';
        }
      }
      if (!layersMap.has(layerName)) {
        layersMap.set(layerName, {
          id: `layer-${layerName}`,
          name: layerName,
          color: layerColor,
          visible: true,
          locked: false,
          lineWidth: 2
        });
      }
      continue;
    } else if (inEntitiesSection && pair.code === 0) {
      const entityType = pair.value;

      if (entityType === 'POINT') {
        let x = 0, y = 0, z = 0;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) x = parseFloat(pair.value);
          else if (pair.code === 20) y = parseFloat(pair.value);
          else if (pair.code === 30) z = parseFloat(pair.value);
          else if (pair.code === 8) layer = pair.value;
        }
        if (!isNaN(x) && !isNaN(y)) {
          points.push({
            id: `dxf-pt-${points.length}`,
            name: `P-${points.length + 1}`,
            x,
            y,
            z: isNaN(z) ? undefined : z,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'LINE') {
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) x1 = parseFloat(pair.value);
          else if (pair.code === 20) y1 = parseFloat(pair.value);
          else if (pair.code === 11) x2 = parseFloat(pair.value);
          else if (pair.code === 21) y2 = parseFloat(pair.value);
          else if (pair.code === 8) layer = pair.value;
        }
        if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
          cadLines.push({
            id: `dxf-line-${cadLines.length}`,
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'LWPOLYLINE') {
        const polyPoints: Point2D[] = [];
        let isClosed = false;
        let layer = '0';
        let currentX: number | null = null;
        let currentY: number | null = null;

        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 70) {
            isClosed = (parseInt(pair.value, 10) & 1) === 1;
          } else if (pair.code === 8) {
            layer = pair.value;
          } else if (pair.code === 10) {
            if (currentX !== null && currentY !== null) {
              polyPoints.push({ x: currentX, y: currentY });
              currentY = null;
            }
            currentX = parseFloat(pair.value);
          } else if (pair.code === 20) {
            currentY = parseFloat(pair.value);
            if (currentX !== null) {
              polyPoints.push({ x: currentX, y: currentY });
              currentX = null;
              currentY = null;
            }
          }
        }
        if (currentX !== null && currentY !== null) {
          polyPoints.push({ x: currentX, y: currentY });
        }

        if (polyPoints.length >= 2) {
          if (isClosed && polyPoints.length >= 3) {
            polygons.push({
              id: `dxf-poly-${polygons.length}`,
              points: polyPoints,
              layerId: `layer-${layer}`,
              fillOpacity: 0.15
            });
          } else {
            polylines.push({
              id: `dxf-pl-${polylines.length}`,
              points: polyPoints,
              isClosed,
              layerId: `layer-${layer}`
            });
          }
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'POLYLINE') {
        // Old style 2D/3D polyline with VERTEX entities
        const polyPoints: Point2D[] = [];
        let isClosed = false;
        let layer = '0';

        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 70) isClosed = (parseInt(pair.value, 10) & 1) === 1;
          else if (pair.code === 8) layer = pair.value;
        }

        // Read subsequent VERTEX entities until SEQEND
        while (pair && pair.value === 'VERTEX') {
          let vx = 0, vy = 0;
          while ((pair = nextPair()) && pair.code !== 0) {
            if (pair.code === 10) vx = parseFloat(pair.value);
            else if (pair.code === 20) vy = parseFloat(pair.value);
          }
          if (!isNaN(vx) && !isNaN(vy)) {
            polyPoints.push({ x: vx, y: vy });
          }
        }

        if (polyPoints.length >= 2) {
          if (isClosed && polyPoints.length >= 3) {
            polygons.push({
              id: `dxf-poly-${polygons.length}`,
              points: polyPoints,
              layerId: `layer-${layer}`,
              fillOpacity: 0.15
            });
          } else {
            polylines.push({
              id: `dxf-pl-${polylines.length}`,
              points: polyPoints,
              isClosed,
              layerId: `layer-${layer}`
            });
          }
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'CIRCLE') {
        let cx = 0, cy = 0, r = 0;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) cx = parseFloat(pair.value);
          else if (pair.code === 20) cy = parseFloat(pair.value);
          else if (pair.code === 40) r = parseFloat(pair.value);
          else if (pair.code === 8) layer = cleanDxfText(pair.value) || '0';
        }
        if (!isNaN(cx) && !isNaN(cy) && r > 0) {
          const circlePts: Point2D[] = [];
          const segs = 32;
          for (let s = 0; s < segs; s++) {
            const angle = (s / segs) * Math.PI * 2;
            circlePts.push({
              x: cx + r * Math.cos(angle),
              y: cy + r * Math.sin(angle)
            });
          }
          polylines.push({
            id: `dxf-circle-${polylines.length}`,
            points: circlePts,
            isClosed: true,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'ARC') {
        let cx = 0, cy = 0, r = 0, startAng = 0, endAng = 360;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) cx = parseFloat(pair.value);
          else if (pair.code === 20) cy = parseFloat(pair.value);
          else if (pair.code === 40) r = parseFloat(pair.value);
          else if (pair.code === 50) startAng = parseFloat(pair.value);
          else if (pair.code === 51) endAng = parseFloat(pair.value);
          else if (pair.code === 8) layer = cleanDxfText(pair.value) || '0';
        }
        if (!isNaN(cx) && !isNaN(cy) && r > 0) {
          let sRad = (startAng * Math.PI) / 180;
          let eRad = (endAng * Math.PI) / 180;
          if (eRad < sRad) eRad += Math.PI * 2;
          const arcPts: Point2D[] = [];
          const segs = 16;
          for (let s = 0; s <= segs; s++) {
            const angle = sRad + (s / segs) * (eRad - sRad);
            arcPts.push({
              x: cx + r * Math.cos(angle),
              y: cy + r * Math.sin(angle)
            });
          }
          polylines.push({
            id: `dxf-arc-${polylines.length}`,
            points: arcPts,
            isClosed: false,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'TEXT' || entityType === 'MTEXT') {
        let x = 0, y = 0, height = 2.0;
        const textParts: string[] = [];
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) x = parseFloat(pair.value);
          else if (pair.code === 20) y = parseFloat(pair.value);
          else if (pair.code === 40) height = parseFloat(pair.value);
          else if (pair.code === 3) textParts.push(pair.value);
          else if (pair.code === 1) textParts.push(pair.value);
          else if (pair.code === 8) layer = cleanDxfText(pair.value) || '0';
        }
        const textContent = cleanDxfText(textParts.join(''));
        if (textContent) {
          texts.push({
            id: `dxf-txt-${texts.length}`,
            x,
            y,
            height: isNaN(height) || height <= 0 ? 2.5 : height,
            text: textContent,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      }
    }
    pair = nextPair();
  }

  // Ensure default layer exists
  if (layersMap.size === 0) {
    layersMap.set('0', {
      id: 'layer-0',
      name: '기본도면 (0)',
      color: '#38bdf8',
      visible: true,
      locked: false,
      lineWidth: 2
    });
  }

  if (onProgress) onProgress(100);

  return {
    layers: Array.from(layersMap.values()),
    points,
    lines: cadLines,
    polylines,
    polygons,
    texts
  };
}

export function parseDXF(dxfText: string): DXFParseResult {
  // Synchronous wrapper for smaller files
  const layersMap = new Map<string, CADLayer>();
  const points: CADPoint[] = [];
  const cadLines: CADLine[] = [];
  const polylines: CADPolyline[] = [];
  const polygons: CADPolygon[] = [];
  const texts: CADText[] = [];

  const textLen = dxfText.length;
  let cursor = 0;

  const readNextLine = (): string | null => {
    if (cursor >= textLen) return null;
    let nextNewline = dxfText.indexOf('\n', cursor);
    if (nextNewline === -1) nextNewline = textLen;
    let line = dxfText.slice(cursor, nextNewline);
    cursor = nextNewline + 1;
    if (line.endsWith('\r')) line = line.slice(0, -1);
    return line.trim();
  };

  const nextPair = (): { code: number; value: string } | null => {
    while (cursor < textLen) {
      const codeStr = readNextLine();
      if (codeStr === null || codeStr === '') continue;
      const code = parseInt(codeStr, 10);
      if (isNaN(code)) continue;
      const valStr = readNextLine();
      return { code, value: valStr !== null ? valStr : '' };
    }
    return null;
  };

  let inEntitiesSection = false;
  let inTablesSection = false;

  let pair = nextPair();
  while (pair) {
    if (pair.code === 0 && pair.value === 'SECTION') {
      pair = nextPair();
      if (pair && pair.code === 2) {
        if (pair.value === 'ENTITIES') {
          inEntitiesSection = true;
          inTablesSection = false;
        } else if (pair.value === 'TABLES') {
          inTablesSection = true;
          inEntitiesSection = false;
        } else {
          inEntitiesSection = false;
          inTablesSection = false;
        }
      }
    } else if (pair.code === 0 && pair.value === 'ENDSEC') {
      inEntitiesSection = false;
      inTablesSection = false;
    } else if (inTablesSection && pair.code === 0 && pair.value === 'LAYER') {
      let layerName = '0';
      let layerColor = '#3b82f6';
      while ((pair = nextPair()) && pair.code !== 0) {
        if (pair.code === 2) layerName = cleanDxfText(pair.value) || '0';
        else if (pair.code === 62) {
          const colorCode = Math.abs(parseInt(pair.value, 10));
          layerColor = ACI_COLORS[colorCode] || '#38bdf8';
        }
      }
      if (!layersMap.has(layerName)) {
        layersMap.set(layerName, {
          id: `layer-${layerName}`,
          name: layerName,
          color: layerColor,
          visible: true,
          locked: false,
          lineWidth: 2
        });
      }
      continue;
    } else if (inEntitiesSection && pair.code === 0) {
      const entityType = pair.value;
      if (entityType === 'POINT') {
        let x = 0, y = 0, z = 0;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) x = parseFloat(pair.value);
          else if (pair.code === 20) y = parseFloat(pair.value);
          else if (pair.code === 30) z = parseFloat(pair.value);
          else if (pair.code === 8) layer = pair.value;
        }
        if (!isNaN(x) && !isNaN(y)) {
          points.push({
            id: `dxf-pt-${points.length}`,
            name: `P-${points.length + 1}`,
            x,
            y,
            z: isNaN(z) ? undefined : z,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'LINE') {
        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) x1 = parseFloat(pair.value);
          else if (pair.code === 20) y1 = parseFloat(pair.value);
          else if (pair.code === 11) x2 = parseFloat(pair.value);
          else if (pair.code === 21) y2 = parseFloat(pair.value);
          else if (pair.code === 8) layer = pair.value;
        }
        if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)) {
          cadLines.push({
            id: `dxf-line-${cadLines.length}`,
            start: { x: x1, y: y1 },
            end: { x: x2, y: y2 },
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'LWPOLYLINE') {
        const polyPoints: Point2D[] = [];
        let isClosed = false;
        let layer = '0';
        let currentX: number | null = null;
        let currentY: number | null = null;

        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 70) isClosed = (parseInt(pair.value, 10) & 1) === 1;
          else if (pair.code === 8) layer = pair.value;
          else if (pair.code === 10) {
            if (currentX !== null && currentY !== null) {
              polyPoints.push({ x: currentX, y: currentY });
              currentY = null;
            }
            currentX = parseFloat(pair.value);
          } else if (pair.code === 20) {
            currentY = parseFloat(pair.value);
            if (currentX !== null) {
              polyPoints.push({ x: currentX, y: currentY });
              currentX = null;
              currentY = null;
            }
          }
        }
        if (currentX !== null && currentY !== null) {
          polyPoints.push({ x: currentX, y: currentY });
        }

        if (polyPoints.length >= 2) {
          if (isClosed && polyPoints.length >= 3) {
            polygons.push({
              id: `dxf-poly-${polygons.length}`,
              points: polyPoints,
              layerId: `layer-${layer}`,
              fillOpacity: 0.15
            });
          } else {
            polylines.push({
              id: `dxf-pl-${polylines.length}`,
              points: polyPoints,
              isClosed,
              layerId: `layer-${layer}`
            });
          }
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'CIRCLE') {
        let cx = 0, cy = 0, r = 0;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) cx = parseFloat(pair.value);
          else if (pair.code === 20) cy = parseFloat(pair.value);
          else if (pair.code === 40) r = parseFloat(pair.value);
          else if (pair.code === 8) layer = cleanDxfText(pair.value) || '0';
        }
        if (!isNaN(cx) && !isNaN(cy) && r > 0) {
          const circlePts: Point2D[] = [];
          const segs = 32;
          for (let s = 0; s < segs; s++) {
            const angle = (s / segs) * Math.PI * 2;
            circlePts.push({
              x: cx + r * Math.cos(angle),
              y: cy + r * Math.sin(angle)
            });
          }
          polylines.push({
            id: `dxf-circle-${polylines.length}`,
            points: circlePts,
            isClosed: true,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'ARC') {
        let cx = 0, cy = 0, r = 0, startAng = 0, endAng = 360;
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) cx = parseFloat(pair.value);
          else if (pair.code === 20) cy = parseFloat(pair.value);
          else if (pair.code === 40) r = parseFloat(pair.value);
          else if (pair.code === 50) startAng = parseFloat(pair.value);
          else if (pair.code === 51) endAng = parseFloat(pair.value);
          else if (pair.code === 8) layer = cleanDxfText(pair.value) || '0';
        }
        if (!isNaN(cx) && !isNaN(cy) && r > 0) {
          let sRad = (startAng * Math.PI) / 180;
          let eRad = (endAng * Math.PI) / 180;
          if (eRad < sRad) eRad += Math.PI * 2;
          const arcPts: Point2D[] = [];
          const segs = 16;
          for (let s = 0; s <= segs; s++) {
            const angle = sRad + (s / segs) * (eRad - sRad);
            arcPts.push({
              x: cx + r * Math.cos(angle),
              y: cy + r * Math.sin(angle)
            });
          }
          polylines.push({
            id: `dxf-arc-${polylines.length}`,
            points: arcPts,
            isClosed: false,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      } else if (entityType === 'TEXT' || entityType === 'MTEXT') {
        let x = 0, y = 0, height = 2.0;
        const textParts: string[] = [];
        let layer = '0';
        while ((pair = nextPair()) && pair.code !== 0) {
          if (pair.code === 10) x = parseFloat(pair.value);
          else if (pair.code === 20) y = parseFloat(pair.value);
          else if (pair.code === 40) height = parseFloat(pair.value);
          else if (pair.code === 3) textParts.push(pair.value);
          else if (pair.code === 1) textParts.push(pair.value);
          else if (pair.code === 8) layer = cleanDxfText(pair.value) || '0';
        }
        const textContent = cleanDxfText(textParts.join(''));
        if (textContent) {
          texts.push({
            id: `dxf-txt-${texts.length}`,
            x,
            y,
            height: isNaN(height) || height <= 0 ? 2.5 : height,
            text: textContent,
            layerId: `layer-${layer}`
          });
          ensureLayer(layersMap, layer);
        }
        continue;
      }
    }
    pair = nextPair();
  }

  if (layersMap.size === 0) {
    layersMap.set('0', {
      id: 'layer-0',
      name: '기본도면 (0)',
      color: '#38bdf8',
      visible: true,
      locked: false,
      lineWidth: 2
    });
  }

  return {
    layers: Array.from(layersMap.values()),
    points,
    lines: cadLines,
    polylines,
    polygons,
    texts
  };
}

function ensureLayer(layersMap: Map<string, CADLayer>, layerName: string) {
  if (!layersMap.has(layerName)) {
    const colors = ['#38bdf8', '#34d399', '#f43f5e', '#fbbf24', '#a855f7', '#fb923c', '#e879f9', '#4ade80', '#60a5fa'];
    let hash = 0;
    for (let i = 0; i < layerName.length; i++) {
      hash = (hash << 5) - hash + layerName.charCodeAt(i);
    }
    const color = colors[Math.abs(hash) % colors.length];

    layersMap.set(layerName, {
      id: `layer-${layerName}`,
      name: layerName,
      color,
      visible: true,
      locked: false,
      lineWidth: 2
    });
  }
}
