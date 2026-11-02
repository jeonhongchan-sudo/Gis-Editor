/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADLayer, CADLine, CADPoint, CADPolygon, CADPolyline, CADText } from '../types/cad';

// Map hex colors to nearest AutoCAD Color Index (ACI) 1-7
function hexToACI(hexColor?: string): number {
  if (!hexColor) return 7; // White
  const h = hexColor.toLowerCase();
  if (h.includes('red') || h === '#ef4444' || h === '#f43f5e') return 1; // Red
  if (h.includes('yellow') || h === '#eab308' || h === '#fbbf24') return 2; // Yellow
  if (h.includes('green') || h === '#22c55e' || h === '#10b981' || h === '#34d399') return 3; // Green
  if (h.includes('cyan') || h === '#06b6d4' || h === '#38bdf8') return 4; // Cyan
  if (h.includes('blue') || h === '#3b82f6' || h === '#6366f1') return 5; // Blue
  if (h.includes('magenta') || h === '#ec4899' || h === '#a855f7') return 6; // Magenta
  return 7; // White/Default
}

export interface DXFExportOptions {
  layers: CADLayer[];
  points: CADPoint[];
  lines: CADLine[];
  polylines: CADPolyline[];
  polygons: CADPolygon[];
  texts: CADText[];
  includePointLabels?: boolean;
}

export function exportToDXF(options: DXFExportOptions): string {
  const {
    layers,
    points,
    lines,
    polylines,
    polygons,
    texts,
    includePointLabels = true
  } = options;

  const dxf: string[] = [];

  const add = (code: number, val: string | number) => {
    dxf.push(`${code}\n${val}`);
  };

  // 1. HEADER SECTION
  add(0, 'SECTION');
  add(2, 'HEADER');
  add(9, '$ACADVER');
  add(1, 'AC1015'); // AutoCAD 2000 standard
  add(9, '$MEASUREMENT');
  add(70, 1); // 1 = Metric (meters/mm)
  add(9, '$ANGBASE');
  add(50, 0.0);
  add(9, '$ANGDIR');
  add(70, 0);
  add(0, 'ENDSEC');

  // 2. TABLES SECTION (LAYERS)
  add(0, 'SECTION');
  add(2, 'TABLES');

  // Layer Table
  add(0, 'TABLE');
  add(2, 'LAYER');
  add(70, layers.length + 1);

  // Default '0' layer
  add(0, 'LAYER');
  add(2, '0');
  add(70, 0);
  add(62, 7);
  add(6, 'CONTINUOUS');

  layers.forEach(layer => {
    if (layer.name === '0') return;
    add(0, 'LAYER');
    add(2, layer.name);
    add(70, 0);
    add(62, hexToACI(layer.color));
    add(6, 'CONTINUOUS');
  });

  add(0, 'ENDTAB');
  add(0, 'ENDSEC');

  // 3. ENTITIES SECTION
  add(0, 'SECTION');
  add(2, 'ENTITIES');

  const layerNameMap = new Map<string, string>();
  layers.forEach(l => layerNameMap.set(l.id, l.name));

  const getLayerName = (layerId: string) => layerNameMap.get(layerId) || '0';

  // Output Survey Points
  points.forEach(pt => {
    const lName = getLayerName(pt.layerId);
    add(0, 'POINT');
    add(8, lName);
    add(10, pt.x.toFixed(4));
    add(20, pt.y.toFixed(4));
    add(30, (pt.z || 0.0).toFixed(4));

    // Optional Point Name Text Annotation
    if (includePointLabels && pt.name) {
      add(0, 'TEXT');
      add(8, lName);
      add(10, (pt.x + 0.5).toFixed(4));
      add(20, (pt.y + 0.5).toFixed(4));
      add(30, (pt.z || 0.0).toFixed(4));
      add(40, '1.2'); // Text Height
      add(1, pt.name);
    }
  });

  // Output Lines
  lines.forEach(l => {
    add(0, 'LINE');
    add(8, getLayerName(l.layerId));
    add(10, l.start.x.toFixed(4));
    add(20, l.start.y.toFixed(4));
    add(30, (l.start.z || 0.0).toFixed(4));
    add(11, l.end.x.toFixed(4));
    add(20, l.end.y.toFixed(4));
    add(31, (l.end.z || 0.0).toFixed(4));
  });

  // Output Polylines (LWPOLYLINE)
  polylines.forEach(pl => {
    if (pl.points.length < 2) return;
    add(0, 'LWPOLYLINE');
    add(8, getLayerName(pl.layerId));
    add(90, pl.points.length);
    add(70, pl.isClosed ? 1 : 0);
    pl.points.forEach(p => {
      add(10, p.x.toFixed(4));
      add(20, p.y.toFixed(4));
    });
  });

  // Output Polygons (Closed LWPOLYLINE)
  polygons.forEach(pg => {
    if (pg.points.length < 3) return;
    add(0, 'LWPOLYLINE');
    add(8, getLayerName(pg.layerId));
    add(90, pg.points.length);
    add(70, 1); // 1 = Closed
    pg.points.forEach(p => {
      add(10, p.x.toFixed(4));
      add(20, p.y.toFixed(4));
    });
  });

  // Output Texts
  texts.forEach(txt => {
    add(0, 'TEXT');
    add(8, getLayerName(txt.layerId));
    add(10, txt.x.toFixed(4));
    add(20, txt.y.toFixed(4));
    add(30, 0.0);
    add(40, (txt.height || 2.0).toFixed(2));
    if (txt.rotation) {
      add(50, txt.rotation.toFixed(1));
    }
    add(1, txt.text);
  });

  add(0, 'ENDSEC');
  add(0, 'EOF');

  return dxf.join('\n');
}

/**
 * Trigger file download in browser
 */
export function downloadTextFile(content: string, filename: string, mimeType = 'application/dxf') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
