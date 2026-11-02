/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CADPoint } from '../types/cad';

export interface CSVColumnMapping {
  idCol: number;
  xCol: number;      // Column for CAD X (Easting)
  yCol: number;      // Column for CAD Y (Northing)
  zCol?: number;
  nameCol?: number;  // Column for item record / remark / description
  swapXY: boolean;   // Swap incoming X & Y
  includeElevation: boolean; // Optional: whether to include Z or exclude for 2D drawings (default: false)
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

  // Check tab
  if (line.includes('\t')) {
    return line.split('\t').map(s => s.trim().replace(/^["']|["']$/g, ''));
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
  forcedHeaderRowIndex: number = 0
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

  // If forcedHeaderRowIndex is 0 and row 0 has no text headers but row 1 does, auto-detect
  if (forcedHeaderRowIndex === 0 && rows.length > 1) {
    const r0HasKoreanOrLetters = rows[0].some(c => /[a-zA-Z가-힣]/.test(c));
    const r1HasKoreanOrLetters = rows[1].some(c => /[a-zA-Z가-힣]/.test(c));
    // If row 0 looks like a single-cell title or empty
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
  let idCol = -1;
  let rawXCol = -1;
  let rawYCol = -1;
  let zCol = -1;
  let nameCol = -1;

  headers.forEach((h, idx) => {
    const lower = h.toLowerCase().trim();

    // ID candidate
    if (
      ['no', 'id', 'num', 'number', '번호', '측점', '측점명', '점번', '점번호', 'pt', 'point', '순번'].includes(lower) ||
      /^측점\s*번호?$/.test(lower)
    ) {
      if (idCol === -1) idCol = idx;
    }
    // X candidate (Northing or Easting)
    else if (
      ['x', 'x좌표', 'northing', 'north', 'n', 'y(e)', '북향', 'x(n)', 'x_측량(n)', 'x_측량'].some(k => lower.includes(k)) ||
      lower === 'x'
    ) {
      if (rawXCol === -1) rawXCol = idx;
    }
    // Y candidate
    else if (
      ['y', 'y좌표', 'easting', 'east', 'e', 'x(n)', '동향', 'y(e)', 'y_측량(e)', 'y_측량'].some(k => lower.includes(k)) ||
      lower === 'y'
    ) {
      if (rawYCol === -1) rawYCol = idx;
    }
    // Z / Elevation
    else if (
      ['z', 'z좌표', 'h', 'el', 'elev', 'elevation', '고도', '표고', '높이', 'z(h)'].some(k => lower.includes(k)) ||
      lower === 'z'
    ) {
      if (zCol === -1) zCol = idx;
    }
    // Item / Remark / Record
    else if (
      ['항목', '레코드', '명칭', '비고', '지목', '코드', 'code', 'desc', '설명', '구분', '이름', 'name', '속성', '비고란', '메모'].some(k => lower.includes(k))
    ) {
      if (nameCol === -1) nameCol = idx;
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
      if (numIndices.length >= 3 && idCol === -1) {
        idCol = numIndices[0] === 0 ? 0 : -1;
        rawXCol = numIndices[1];
        rawYCol = numIndices[2];
        if (numIndices.length >= 4) zCol = numIndices[3];
      } else {
        rawXCol = numIndices[0];
        rawYCol = numIndices[1];
        if (numIndices.length >= 3 && zCol === -1) zCol = numIndices[2];
      }
    } else {
      rawXCol = 0;
      rawYCol = 1;
    }
  }

  if (idCol === -1) {
    // If column 0 is not X or Y, use it as ID
    idCol = rawXCol !== 0 && rawYCol !== 0 ? 0 : 0;
  }

  // If item record column is not set, look for the first non-numeric column that isn't ID
  if (nameCol === -1) {
    for (let c = 0; c < headers.length; c++) {
      if (c !== idCol && c !== rawXCol && c !== rawYCol && c !== zCol) {
        nameCol = c;
        break;
      }
    }
  }

  // Heuristic for Korean TM coordinates (EPSG:5186 / 5187):
  // Korean field survey instruments usually log: X = Northing (500,000 ~ 650,000) and Y = Easting (150,000 ~ 300,000).
  // AutoCAD canvas expects: X = Easting (Horizontal, 200k), Y = Northing (Vertical, 500k).
  // When rawX > 350,000 and rawY < 350,000, swapXY MUST be true!
  let shouldSwap = false;
  if (dataRows.length > 0) {
    const testRow = dataRows[0];
    const val1 = Number(testRow[rawXCol]);
    const val2 = Number(testRow[rawYCol]);

    if (!isNaN(val1) && !isNaN(val2)) {
      if (val1 > 350000 && val2 < 350000) {
        shouldSwap = true;
      }
    }
  }

  const mapping: CSVColumnMapping = {
    idCol: idCol >= 0 ? idCol : 0,
    xCol: rawXCol >= 0 ? rawXCol : 0,
    yCol: rawYCol >= 0 ? rawYCol : 1,
    zCol: zCol !== -1 ? zCol : undefined,
    nameCol: nameCol !== -1 ? nameCol : undefined,
    swapXY: shouldSwap,
    includeElevation: false // Default to false: 2D drawings exclude elevation unless user opts in
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

/**
 * Parse CSV text into preview result
 */
export function parseCSVPreview(rawText: string, forcedHeaderRowIndex: number = 0): CSVParseResult {
  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) {
    throw new Error('CSV 파일에 유효한 데이터가 없습니다.');
  }

  const parsedRows = lines.map(splitLine).filter(cols => cols.length >= 1);
  return analyzeTableRows(parsedRows, forcedHeaderRowIndex);
}

/**
 * Generate CADPoints from parsed CSV or Excel rows and user-selected mapping
 */
export function buildCADPointsFromCSV(
  rows: string[][],
  mapping: CSVColumnMapping,
  layerId: string = 'layer-survey-points'
): CADPoint[] {
  const points: CADPoint[] = [];

  rows.forEach((row, idx) => {
    const rawValX = Number(row[mapping.xCol]);
    const rawValY = Number(row[mapping.yCol]);

    if (isNaN(rawValX) || isNaN(rawValY)) {
      return; // Skip invalid row
    }

    // In CAD: X is Horizontal (Easting), Y is Vertical (Northing)
    let cadX = rawValX;
    let cadY = rawValY;

    if (mapping.swapXY) {
      cadX = rawValY;
      cadY = rawValX;
    }

    const idVal = mapping.idCol >= 0 && row[mapping.idCol] ? row[mapping.idCol].trim() : String(idx + 1);
    
    // Elevation Z: Only included if includeElevation is true and zCol is specified
    let zVal: number | undefined = undefined;
    if (mapping.includeElevation && mapping.zCol !== undefined && mapping.zCol >= 0 && row[mapping.zCol]) {
      const parsedZ = Number(row[mapping.zCol]);
      if (!isNaN(parsedZ)) {
        zVal = parsedZ;
      }
    }
    
    // Item record / description / remark
    let itemRecord = '';
    if (mapping.nameCol !== undefined && mapping.nameCol >= 0 && row[mapping.nameCol]) {
      itemRecord = row[mapping.nameCol].trim();
    }

    // Name formatting: If item record exists, display "ID [항목]" or "항목"
    let nameVal = `PT-${idVal}`;
    if (itemRecord) {
      if (itemRecord.toLowerCase() === idVal.toLowerCase()) {
        nameVal = idVal;
      } else {
        nameVal = `${idVal} [${itemRecord}]`;
      }
    }

    points.push({
      id: `pt-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      name: nameVal,
      x: cadX,
      y: cadY,
      z: zVal,
      layerId,
      isSurveyNode: true
    });
  });

  return points;
}

/**
 * Pre-packaged sample survey CSV datasets for instant 1-click loading
 */
export const SAMPLE_SURVEY_CSV_EPSG5186 = `번호,X_측량(N),Y_측량(E),고도(Z),측점명,비고/항목
1,544830.250,201210.120,45.20,경계점_01,부지경계
2,544855.100,201235.400,45.65,경계점_02,부지경계
3,544890.750,201280.850,46.10,도로시점_03,아스콘도로
4,544915.600,201320.300,46.50,도로변곡_04,아스콘도로
5,544940.200,201380.150,47.20,도로종점_05,아스콘도로
6,544920.800,201415.900,47.80,부지경계_06,경계펜스
7,544875.400,201440.500,48.10,부지모서리_07,콘크리트벽체
8,544820.150,201430.700,47.90,법면상단_08,사면상단
9,544780.600,201390.250,47.10,법면하단_09,사면하단
10,544760.300,201330.400,46.40,배수로_10,U형측구
11,544770.900,201260.800,45.80,구조물모서리_11,건물기초
12,544805.400,201220.600,45.30,시점접속_12,연결로
13,544860.000,201300.000,46.30,중앙기준점_13,삼각점
14,544840.500,201350.200,46.80,보조점_14,기준타겟
15,544885.100,201360.500,47.00,구역표시_15,현장말목`;
