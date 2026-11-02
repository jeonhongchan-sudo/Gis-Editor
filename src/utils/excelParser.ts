/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as XLSX from 'xlsx';

export interface WorkbookSheetData {
  sheetNames: string[];
  activeSheet: string;
  rows: (string | number)[][];
}

/**
 * Check if the raw buffer starts with Excel binary magic bytes:
 * - XLSX / ZIP: 0x50, 0x4B, 0x03, 0x04 (or 'PK')
 * - XLS (BIFF8 OLE): 0xD0, 0xCF, 0x11, 0xE0
 */
export function isExcelBuffer(buffer: ArrayBuffer, filename?: string): boolean {
  if (filename) {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm' || ext === 'xlsb') {
      return true;
    }
  }

  const bytes = new Uint8Array(buffer);
  if (bytes.length >= 4) {
    // PK\x03\x04 (ZIP container used by .xlsx)
    if (bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) {
      return true;
    }
    // OLE Compound Document (.xls BIFF8)
    if (bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) {
      return true;
    }
  }
  return false;
}

/**
 * Parse an Excel file ArrayBuffer into workbook sheets
 */
export function parseExcelWorkbook(buffer: ArrayBuffer): {
  workbook: XLSX.WorkBook;
  sheetNames: string[];
  getSheetRows: (sheetName: string) => (string | number)[][];
} {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellDates: true,
    cellNF: false,
    cellText: false
  });

  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('엑셀 파일에 유효한 시트가 없습니다.');
  }

  const getSheetRows = (sheetName: string): (string | number)[][] => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    
    // Convert to 2D array: rows x columns
    const rawRows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, {
      header: 1,
      defval: '',
      blankrows: false
    });

    // Clean up empty trailing cells and rows
    return rawRows.map(row => 
      row.map(cell => (cell === null || cell === undefined ? '' : String(cell).trim()))
    ).filter(row => row.some(cell => cell !== ''));
  };

  return {
    workbook,
    sheetNames,
    getSheetRows
  };
}
