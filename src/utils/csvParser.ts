/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADPoint } from '../types/cad';

export interface CSVColumnMapping {
  xCol: number;      // Column for CAD X (Easting / Horizontal)
  yCol: number;      // Column for CAD Y (Northing / Vertical)
  nameCol?: number;  // Column for item record / remark / description (항목)
  zCol?: number;     // Optional elevation Z
  idCol?: number;    // Deprecated / optional identifier
  includeElevation?: boolean; // Optional: whether to include Z or exclude for 2D drawings (default: false)
}

export interface CSVParseResult {
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  detectedMapping: CSVColumnMapping;
  allRows: string[][];
  headerRowIndex: number;
}

/**
 * Split line with comma, semicolon, tab, or whitespace delimiter with quote handling
 */
function splitLine(line: string): string[] {
  const tabCount = (line.match(/\t/g) || []).length;
  // Prefer tab delimiter when tabs clearly separate columns (e.g. TSV or Excel copy-paste with commas inside remarks)
  if (tabCount >= 2 || (tabCount >= 1 && !line.includes(','))) {
    return line.split('\t').map(s => {
      let clean = s.trim();
      if (clean.startsWith('"') && clean.endsWith('"')) {
        clean = clean.slice(1, -1).replace(/""/g, '"');
      }
      return clean.trim();
    });
  }

  // If line contains commas
  if (line.includes(',')) {
    // Regex for CSV with quoted strings
    const matched = line.match(/(?:^|,)("(?:[^"]|"")*"|[^,]*)/g);
    if (matched && matched.length > 0) {
      return matched.map(col => {
        let clean = col.replace(/^,/, '').trim();
        if (clean.startsWith('"') && clean.endsWith('"')) {
          clean = clean.slice(1, -1).replace(/""/g, '"');
        }
        return clean.trim();
      });
    }
    return line.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }

  // Check semicolon
  if (line.includes(';')) {
    return line.split(';').map(s => s.trim().replace(/^["']|["']$/g, ''));
  }

  // Whitespace separated
  return line.trim().split(/\s+/).map(s => s.trim());
}

/**
 * Analyze a 2D array of rows (from CSV or Excel Sheet)
 */
export function analyzeTableRows(
  rawRows: (string | number)[][],
  forcedHeaderRowIndex: number = 0,
  autoDetectHeader: boolean = true
): CSVParseResult {
  // Clean string conversion
  const rows: string[][] = rawRows
    .map(r => r.map(c => (c === null || c === undefined ? '' : String(c).trim())))
    .filter(r => r.some(c => c !== ''));

  if (rows.length === 0) {
    throw new Error('유효한 데이터 행이 없습니다.');
  }

  // Determine header row index
  let headerRowIndex = Math.min(Math.max(0, forcedHeaderRowIndex), rows.length - 1);

  // If autoDetectHeader is enabled and row 0 looks like a title row, auto-advance to row 1
  if (autoDetectHeader && forcedHeaderRowIndex === 0 && rows.length > 1) {
    const r1HasKoreanOrLetters = rows[1].some(c => /[a-zA-Z가-힣]/.test(c));
    // If row 0 looks like a single-cell title or sparse header
    if (rows[0].filter(c => c !== '').length <= 2 && r1HasKoreanOrLetters) {
      headerRowIndex = 1;
    }
  }

  const rawHeaders = rows[headerRowIndex] || [];
  const maxCols = Math.max(...rows.map(r => r.length));

  // Build clean header labels
  const headers = Array.from({ length: maxCols }, (_, i) => {
    const val = rawHeaders[i]?.trim();
    return val && val.length > 0 ? val : `열 ${i + 1}`;
  });

  const dataRows = rows.slice(headerRowIndex + 1).filter(r => {
    // Keep rows that have at least one numeric candidate
    return r.some(c => !isNaN(Number(c)) && c !== '');
  });

  // Detect column indices based on header names
  let rawXCol = -1;
  let rawYCol = -1;
  let zCol = -1;
  let nameCol = -1;

  headers.forEach((h, idx) => {
    const lower = h.toLowerCase().trim();

    // X candidate (CAD X / Easting / Horizontal)
    if (
      rawXCol === -1 && (
        ['x', 'x좌표', 'cad x', '동향', 'easting', 'east', 'x_측량', 'x(n)'].some(k => lower.includes(k)) ||
        lower === 'x'
      )
    ) {
      rawXCol = idx;
    }
    // Y candidate (CAD Y / Northing / Vertical)
    else if (
      rawYCol === -1 && (
        ['y', 'y좌표', 'cad y', '북향', 'northing', 'north', 'y_측량', 'y(e)'].some(k => lower.includes(k)) ||
        lower === 'y'
      )
    ) {
      rawYCol = idx;
    }
    // Z / Elevation
    else if (
      zCol === -1 && (
        ['z', 'z좌표', 'h', 'el', 'elev', 'elevation', '고도', '표고', '높이', 'z(h)'].some(k => lower.includes(k)) ||
        lower === 'z'
      )
    ) {
      zCol = idx;
    }
    // Item / Remark / Text to display on drawing (항목)
    else if (
      nameCol === -1 && (
        ['항목', '명칭', '지목', '비고', '코드', 'code', '측점명', '측점', '점번', '점번호', 'id', 'no', '번호', 'desc', '설명', '구분', '이름', 'name', '속성'].some(k => lower.includes(k))
      )
    ) {
      nameCol = idx;
    }
  });

  // Fallback heuristic by sample row numeric values
  const sampleData = dataRows[0] || [];
  const numIndices: number[] = [];
  sampleData.forEach((val, idx) => {
    if (!isNaN(Number(val)) && val !== '') {
      numIndices.push(idx);
    }
  });

  if (rawXCol === -1 || rawYCol === -1) {
    if (numIndices.length >= 2) {
      rawXCol = numIndices[0];
      rawYCol = numIndices[1];
      if (numIndices.length >= 3 && zCol === -1) zCol = numIndices[2];
    } else {
      rawXCol = 0;
      rawYCol = 1;
    }
  }

  // If item record column is not set, look for the first non-numeric column
  if (nameCol === -1) {
    for (let c = 0; c < headers.length; c++) {
      if (c !== rawXCol && c !== rawYCol && c !== zCol) {
        nameCol = c;
        break;
      }
    }
  }

  const mapping: CSVColumnMapping = {
    xCol: rawXCol >= 0 ? rawXCol : 0,
    yCol: rawYCol >= 0 ? rawYCol : 1,
    zCol: zCol !== -1 ? zCol : undefined,
    nameCol: nameCol !== -1 ? nameCol : undefined,
    includeElevation: false
  };

  return {
    headers,
    sampleRows: dataRows.slice(0, 10),
    totalRows: dataRows.length,
    detectedMapping: mapping,
    allRows: dataRows,
    headerRowIndex
  };
}

export function parseCSVToRows(rawText: string): string[][] {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    throw new Error('CSV 파일에 유효한 데이터가 없습니다.');
  }
  return lines.map(splitLine).filter(cols => cols.length >= 1);
}

/**
 * Parse CSV text into preview result
 */
export function parseCSVPreview(
  rawText: string,
  forcedHeaderRowIndex: number = 0,
  autoDetectHeader: boolean = true
): CSVParseResult {
  const parsedRows = parseCSVToRows(rawText);
  return analyzeTableRows(parsedRows, forcedHeaderRowIndex, autoDetectHeader);
}

/**
 * Generate CADPoints from parsed CSV or Excel rows and user-selected mapping
 */
export function buildCADPointsFromCSV(
  rows: string[][],
  mapping: CSVColumnMapping,
  layerId: string = 'layer-0'
): CADPoint[] {
  const points: CADPoint[] = [];

  rows.forEach((row, idx) => {
    const rawValX = Number(row[mapping.xCol]);
    const rawValY = Number(row[mapping.yCol]);

    if (isNaN(rawValX) || isNaN(rawValY)) {
      return; // Skip invalid row
    }

    // Direct CAD coordinates (X = Horizontal, Y = Vertical)
    let cadX = rawValX;
    let cadY = rawValY;

    // Elevation Z: Only included if includeElevation is true and zCol is specified
    let zVal: number | undefined = undefined;
    if (mapping.includeElevation && mapping.zCol !== undefined && mapping.zCol >= 0 && row[mapping.zCol]) {
      const parsedZ = Number(row[mapping.zCol]);
      if (!isNaN(parsedZ)) {
        zVal = parsedZ;
      }
    }

    // Item record text (항목)
    let nameVal = '';
    if (mapping.nameCol !== undefined && mapping.nameCol >= 0 && row[mapping.nameCol] !== undefined) {
      nameVal = row[mapping.nameCol].trim();
    } else if (mapping.idCol !== undefined && mapping.idCol >= 0 && row[mapping.idCol] !== undefined) {
      nameVal = row[mapping.idCol].trim();
    }

    if (!nameVal) {
      nameVal = String(idx + 1);
    }

    points.push({
      id: `point-${idx + 1}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: nameVal,
      x: cadX,
      y: cadY,
      z: zVal,
      layerId,
      isSurveyNode: true,
      attributes: {
        TEXTSTRING: nameVal,
        TEXTHEIGHT: 1,
        'marker-symbol': 'circle',
        'marker-size': 'medium'
      }
    });
  });

  return points;
}
